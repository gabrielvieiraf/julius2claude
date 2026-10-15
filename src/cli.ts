import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type Config, type Profile, type Provider, NAME_RE, PAID, UserError,
  getProfile, loadConfig, mutateConfig, ordered, saveConfig,
} from "./config.js";
import { runHook } from "./hooks.js";
import { cancelLogin, loginEnv, loginWorker, recordLogin, startLogin, submitCode } from "./login.js";
import { paths, defaultClaudeDir, defaultClaudeJson } from "./paths.js";
import { claudeBin, claudeVersion, versionAtLeast } from "./proc.js";
import { ensureProfileDir, groupStore, loginState, readCredentials, readIdentity } from "./profiles.js";
import { bindingFor, pickNext, usable } from "./router.js";
import { interruptedSessions, liveRuns, loadRun, mutateRun, alive } from "./runs.js";
import { installSlashCommands, commandsDir } from "./slash.js";
import { runStatusline } from "./statusline.js";
import { type WindowStats, computeStats, fmtDuration, fmtTokens, sum } from "./stats.js";
import { AUTH_ENV_KEYS, supervise } from "./supervisor.js";
import { livePct, loadUsage, mutateUsage, activeBlocks } from "./usage.js";

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
export const SCHEMA_VERSION = 1;

const HELP = `julius2claude (j2c) ${VERSION}: multi-account routing and usage-limit failover for Claude Code.

Run Claude Code across your own accounts (Pro/Max, Team/Enterprise, Bedrock, Vertex, Foundry,
API key) and move a session to the next account when one hits its limit — at the end of a turn,
without losing the conversation.

Usage:
  j2c [claude args...]            start Claude Code on the right account (same args as \`claude\`)
  j2c -P <profile> [claude args]  start on a specific profile

Setup:
  j2c setup                       first-time setup (adopts your current login as "main")
  j2c add <name> [options]        add a profile and log in
      --bedrock [--aws-profile P] [--region R]   Amazon Bedrock (pay per token)
      --vertex --project ID [--region R]          Google Vertex AI (pay per token)
      --foundry --resource NAME                   Microsoft Foundry (pay per token)
      --api-key-helper "<cmd>"                    Anthropic API key printed by a command
      --env KEY=VALUE                             extra env (repeatable; never put secrets here)
      --group <name>                              data boundary (e.g. "work": its own history)
      --no-login                                  don't open the login now
  j2c login <name>                log a profile in (or back in)
      --start / --code <code> / --cancel          two-step login for AI agents and scripts
  j2c remove <name> [--purge]     forget a profile (--purge also deletes its folder)

Every day:
  j2c list | status [--json]      accounts, limits, reset times
  j2c use <name>                  set the default account (inside Claude: /j2c:use <name>)
  j2c next                        inside Claude: /j2c:next
  j2c order <a> <b> ...           failover order
  j2c bind <name> [dir] [--strict]  always use <name> in dir (strict: never any other)
  j2c unbind [dir]
  j2c auto on|off [--paid] [--5h N] [--weekly N] [--dwell MIN]
  j2c stats [--days N] [--json]   tokens per account and how long each took to reach its limits
  j2c recover [n]                 resume sessions cut off by a crash / WSL restart
  j2c doctor                      check everything that commonly goes wrong

Docs: https://github.com/gabrielvieiraf/julius2claude`;

interface Parsed {
  _: string[];
  flags: Record<string, string | boolean | string[]>;
}

function parse(argv: string[], valueFlags: string[] = []): Parsed {
  const out: Parsed = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
      let v: string | boolean = true;
      if (inline !== undefined) v = inline;
      else if (valueFlags.includes(k) && i + 1 < argv.length) v = argv[++i];
      const prev = out.flags[k];
      if (k === "env") out.flags[k] = [...((prev as string[]) ?? []), String(v)];
      else out.flags[k] = v;
    } else out._.push(a);
  }
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function requireSetup(): Config {
  if (!fs.existsSync(paths.config())) throw new UserError("julius2claude is not set up yet. Run `j2c setup` first.");
  return loadConfig();
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "hook": {
      const p = parse(rest, ["run"]);
      await runHook(p._[0], str(p.flags.run));
      return 0;
    }
    case "statusline": {
      const p = parse(rest, ["run", "wrap-b64"]);
      const wrap = str(p.flags["wrap-b64"]);
      const out = await runStatusline(str(p.flags.run), wrap ? Buffer.from(wrap, "base64").toString("utf8") : undefined);
      if (out) process.stdout.write(out + "\n");
      return 0;
    }
    case "-h":
    case "--help":
    case "help":
      console.log(HELP);
      return 0;
    case "-v":
    case "--version":
    case "version":
      console.log(VERSION);
      return 0;
    case "setup":
      return setup();
    case "add":
      return add(rest);
    case "login":
      return login(rest);
    case "__login-worker": {
      const p = parse(rest, ["email"]);
      await loginWorker(p._[0], str(p.flags.email));
      return 0;
    }
    case "remove":
    case "rm":
      return remove(rest);
    case "list":
    case "ls":
    case "status":
      return status(rest);
    case "use":
      return use(rest);
    case "next":
      return next(rest);
    case "order":
      return order(rest);
    case "bind":
      return bind(rest);
    case "unbind":
      return unbind(rest);
    case "auto":
      return auto(rest);
    case "recover":
      return recover(rest);
    case "doctor":
      return doctor();
    case "stats":
      return stats(rest);
    case "run":
      return launch(rest);
    default:
      return launch(argv);
  }
}

async function launch(argv: string[]): Promise<number> {
  requireSetup();
  let profile: string | undefined;
  let keepEnv = false;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-P" || argv[i] === "--profile") profile = argv[++i];
    else if (argv[i] === "--keep-env") keepEnv = true;
    else args.push(argv[i]);
  }
  return supervise({ profile, args, cwd: process.cwd(), keepEnv });
}

function setup(): number {
  const existed = fs.existsSync(paths.config());
  const cfg = loadConfig();
  const mainP = cfg.profiles.find((p) => p.isMain);
  if (mainP) {
    const id = readIdentity(mainP);
    if (id.uuid) mainP.account = { email: id.email, org: id.org, plan: id.plan, uuid: id.uuid };
  }
  saveConfig(cfg);
  const files = installSlashCommands();
  const v = claudeVersion();
  console.log(existed ? "julius2claude is already set up; refreshed." : "julius2claude is set up.");
  console.log(`  config:   ${paths.config()}`);
  console.log(`  commands: /j2c:use, /j2c:next, /j2c:status (${path.dirname(files[0])})`);
  if (mainP?.account?.email) console.log(`  main:     ${mainP.account.email}${mainP.account.org ? ` (${mainP.account.org})` : ""}`);
  if (!v) console.log("  ⚠ `claude` was not found on PATH. Install Claude Code: https://code.claude.com");
  else if (!versionAtLeast(v, "2.1.152")) console.log(`  ⚠ Claude Code ${v} is old; run \`claude update\`.`);
  console.log(`
Next:
  j2c add work              # log in a second account (e.g. your company's)
  j2c add aws --bedrock     # or a pay-per-token Amazon Bedrock profile
  j2c                       # start Claude Code through julius2claude (same args as \`claude\`)

Tip: alias claude=j2c  — if you want every session supervised.`);
  if (!process.stdin.isTTY) console.log("\nAI agents: follow docs/AGENT-SETUP.md (https://github.com/gabrielvieiraf/julius2claude/blob/main/docs/AGENT-SETUP.md).");
  return 0;
}

function add(argv: string[]): number {
  const cfg0 = requireSetup();
  const p = parse(argv, ["aws-profile", "region", "project", "resource", "api-key-helper", "env", "group", "model", "email"]);
  const name = p._[0];
  if (!name || !NAME_RE.test(name)) throw new UserError("usage: j2c add <name> [options]  (name: lowercase letters, digits, - or _)");
  if (cfg0.profiles.some((x) => x.name === name)) throw new UserError(`profile "${name}" already exists.`);
  const f = p.flags;
  let provider: Provider = "claude";
  const env: Record<string, string> = {};
  if (f.bedrock) {
    provider = "bedrock";
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    if (str(f["aws-profile"])) env.AWS_PROFILE = str(f["aws-profile"])!;
    if (str(f.region)) env.AWS_REGION = str(f.region)!;
  } else if (f.vertex) {
    provider = "vertex";
    env.CLAUDE_CODE_USE_VERTEX = "1";
    if (!str(f.project)) throw new UserError("--vertex needs --project <gcp-project-id>");
    env.ANTHROPIC_VERTEX_PROJECT_ID = str(f.project)!;
    env.CLOUD_ML_REGION = str(f.region) ?? "global";
  } else if (f.foundry) {
    provider = "foundry";
    env.CLAUDE_CODE_USE_FOUNDRY = "1";
    if (!str(f.resource)) throw new UserError("--foundry needs --resource <name>");
    env.ANTHROPIC_FOUNDRY_RESOURCE = str(f.resource)!;
  } else if (f["api-key-helper"]) {
    provider = "apikey";
  }
  if (str(f.model)) env.ANTHROPIC_MODEL = str(f.model)!;
  for (const kv of (f.env as string[]) ?? []) {
    const i = kv.indexOf("=");
    if (i < 1) throw new UserError(`--env expects KEY=VALUE, got "${kv}"`);
    const k = kv.slice(0, i);
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k) && k !== "AWS_PROFILE")
      throw new UserError(`refusing to store ${k} in plain text. Use --api-key-helper "<command that prints it>" or your AWS/GCP credential chain.`);
    env[k] = kv.slice(i + 1);
  }
  const group = str(f.group);
  if (group && !NAME_RE.test(group)) throw new UserError("--group: lowercase letters, digits, - or _");
  const profile: Profile = {
    name,
    provider,
    configDir: paths.profileDir(name),
    ...(Object.keys(env).length ? { env } : {}),
    ...(group && group !== "default" ? { group } : {}),
  };
  mutateConfig((cfg) => {
    cfg.profiles.push(profile);
    if (!cfg.order.includes(name)) cfg.order.push(name);
  });
  ensureProfileDir(profile);
  if (provider === "apikey") {
    const file = path.join(profile.configDir, "settings.json");
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    s.apiKeyHelper = str(f["api-key-helper"]);
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  }
  console.log(`Added profile "${name}" (${provider}${group ? `, group ${group}` : ""}).`);
  if (PAID.has(provider)) {
    console.log("  Pay-per-token profile: auto-switch only falls back to it after `j2c auto on --paid`.");
    if (provider === "bedrock" && !env.AWS_PROFILE && !process.env.AWS_PROFILE)
      console.log("  Tip: set --aws-profile, or run `j2c -P " + name + "` and then /setup-bedrock inside Claude Code.");
    return 0;
  }
  if (f["no-login"]) {
    console.log(`  Log in later with: j2c login ${name}`);
    return 0;
  }
  return login([name, ...(str(f.email) ? ["--email", str(f.email)!] : []), ...(f.json ? ["--json"] : [])]);
}

function login(argv: string[]): number {
  requireSetup();
  const p = parse(argv, ["code", "email"]);
  const name = p._[0];
  if (!name) throw new UserError("usage: j2c login <profile> [--start | --code <code>] [--email <email>] [--json]");
  const json = !!p.flags.json;
  if (p.flags.cancel) return cancelLogin(name);
  if (p.flags.start) return startLogin(name, str(p.flags.email), json);
  if (str(p.flags.code)) return submitCode(name, str(p.flags.code)!, json);
  if (!process.stdin.isTTY) return startLogin(name, str(p.flags.email), json);
  const prof = getProfile(loadConfig(), name);
  if (prof.provider !== "claude") throw new UserError(`"${name}" is a ${prof.provider} profile; it uses your ${prof.provider} credentials, not a Claude login.`);
  ensureProfileDir(prof);
  const before = readIdentity(prof);
  console.log(`Logging "${name}" in. Sign in with the account you want for this profile.`);
  const r = spawnSync(claudeBin(), ["auth", "login", ...(str(p.flags.email) ? ["--email", str(p.flags.email)!] : [])], { stdio: "inherit", env: loginEnv(prof) });
  if (r.status !== 0) throw new UserError("login did not complete.");
  const res = recordLogin(name, before);
  console.log(`✓ ${name}: ${res.email ?? "logged in"}${res.org ? ` (${res.org})` : ""}`);
  for (const w of res.warnings) console.log(`! ${w}`);
  return 0;
}

function remove(argv: string[]): number {
  const cfg = requireSetup();
  const p = parse(argv);
  const name = p._[0];
  const prof = getProfile(cfg, name);
  if (prof.isMain) throw new UserError("the main profile is your normal ~/.claude; it can't be removed.");
  if (liveRuns().some((r) => r.profile === name)) throw new UserError(`"${name}" is in use by a running session.`);
  mutateConfig((c) => {
    c.profiles = c.profiles.filter((x) => x.name !== name);
    c.order = c.order.filter((x) => x !== name);
    c.bindings = c.bindings.filter((b) => b.profile !== name);
    if (c.active === name) c.active = "main";
  });
  if (p.flags.purge) {
    for (const e of fs.readdirSync(prof.configDir, { withFileTypes: true })) if (e.isSymbolicLink()) fs.unlinkSync(path.join(prof.configDir, e.name));
    fs.rmSync(prof.configDir, { recursive: true, force: true });
    console.log(`Removed "${name}" and its folder. Its login was not revoked; sign out at claude.ai if you want that.`);
  } else console.log(`Removed "${name}". Its folder is kept at ${prof.configDir}.`);
  return 0;
}

function fmtReset(epoch: number | undefined): string {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function status(argv: string[]): number {
  const cfg = requireSetup();
  const usage = loadUsage();
  const runs = liveRuns();
  const here = bindingFor(cfg, process.cwd());
  const current = process.env.J2C_RUN_ID ? loadRun(process.env.J2C_RUN_ID) : undefined;
  const rows = ordered(cfg).map((p) => {
    const u = usage[p.name];
    const v = usable(cfg, usage, p);
    return {
      name: p.name,
      provider: p.provider,
      group: p.group ?? "default",
      account: p.account?.email ?? null,
      org: p.account?.org ?? null,
      login: loginState(p),
      fiveHour: p.provider === "claude" ? livePct(u?.fiveHour) ?? null : null,
      fiveHourResetsAt: u?.fiveHour?.resetsAt ?? null,
      weekly: p.provider === "claude" ? livePct(u?.sevenDay) ?? null : null,
      weeklyResetsAt: u?.sevenDay?.resetsAt ?? null,
      usable: v.ok,
      reason: v.reason ?? null,
      availableAt: v.availableAt ?? null,
      sessions: runs.filter((r) => r.profile === p.name).length,
      default: cfg.active === p.name,
      thisSession: current?.profile === p.name,
    };
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, autoSwitch: cfg.autoSwitch, binding: here ?? null, profiles: rows }, null, 2));
    return 0;
  }
  const pct = (n: number | null) => (n === null ? "  —" : `${String(Math.round(n)).padStart(3)}%`);
  console.log(`auto-switch: ${cfg.autoSwitch.enabled ? `on (5h ≥${cfg.autoSwitch.fiveHourPct}%, weekly ≥${cfg.autoSwitch.weeklyPct}%${cfg.autoSwitch.allowPaid ? ", may use paid profiles" : ""})` : "off (j2c auto on)"}`);
  if (here) console.log(`this folder → ${here.profile}${here.strict ? " (strict)" : ""}`);
  console.log("");
  for (const r of rows) {
    const mark = r.thisSession ? "▶" : r.default ? "*" : " ";
    const who = r.account ? `${r.account}${r.org ? ` · ${r.org}` : ""}` : r.provider === "claude" ? "(not logged in)" : r.provider;
    const limits = r.provider === "claude" ? `5h ${pct(r.fiveHour)}  7d ${pct(r.weekly)}` : "pay-per-token ";
    const state = r.usable ? "ready" : `${r.reason}${r.availableAt ? ` · back ${fmtReset(r.availableAt)}` : ""}`;
    console.log(`${mark} ${r.name.padEnd(12)} ${limits}  ${state.padEnd(28)} ${who}${r.sessions ? ` · ${r.sessions} running` : ""}`);
  }
  console.log("\n▶ this session   * default for new sessions");
  return 0;
}

function requestSwitch(to: string | undefined, reason: string): string {
  const id = process.env.J2C_RUN_ID;
  const run = id ? loadRun(id) : undefined;
  if (!run || !alive(run.pid)) return "";
  mutateRun(run.id, (r) => void (r.pendingSwitch = { to, reason, requestedAt: Date.now(), hard: false }));
  return run.profile;
}

function use(argv: string[]): number {
  const cfg = requireSetup();
  const p = parse(argv);
  const name = p._[0];
  if (!name) throw new UserError("usage: j2c use <profile>");
  const target = getProfile(cfg, name);
  if (p.flags["from-session"]) {
    const run = process.env.J2C_RUN_ID ? loadRun(process.env.J2C_RUN_ID) : undefined;
    if (!run) {
      mutateConfig((c) => void (c.active = name));
      console.log(`julius2claude: this session was not started with j2c, so it can't move. "${name}" is now the default; start the next session with \`j2c\`.`);
      return 0;
    }
    if (run.profile === name) {
      console.log(`julius2claude: this session is already on "${name}".`);
      return 0;
    }
    if ((target.group ?? "default") !== (getProfile(cfg, run.profile).group ?? "default")) {
      console.log(`julius2claude: "${name}" is in a different data group; a session can't move across groups. Start a new session with \`j2c -P ${name}\`.`);
      return 0;
    }
    const v = usable(cfg, loadUsage(), target);
    requestSwitch(name, "you asked");
    console.log(`julius2claude: moving this session to "${name}" when this reply ends.${v.ok ? "" : ` Note: ${name} reports ${v.reason}.`}`);
    return 0;
  }
  mutateConfig((c) => void (c.active = name));
  console.log(`"${name}" is now the default for new sessions.`);
  return 0;
}

function next(argv: string[]): number {
  const cfg = requireSetup();
  const run = process.env.J2C_RUN_ID ? loadRun(process.env.J2C_RUN_ID) : undefined;
  const from = run ? getProfile(cfg, run.profile) : getProfile(cfg, cfg.active);
  const pick = pickNext({ ...cfg, autoSwitch: { ...cfg.autoSwitch, allowPaid: cfg.autoSwitch.allowPaid || argv.includes("--paid") } }, loadUsage(), from, run?.cwd ?? process.cwd());
  if (!pick.profile) {
    console.log(`julius2claude: no other account to move to (${pick.reason})${pick.waitUntil ? `; the next one frees up at ${fmtReset(pick.waitUntil)}` : ""}.`);
    return 0;
  }
  if (argv.includes("--from-session") && run) {
    requestSwitch(pick.profile.name, "you asked");
    console.log(`julius2claude: moving this session to "${pick.profile.name}" when this reply ends.`);
  } else {
    mutateConfig((c) => void (c.active = pick.profile!.name));
    console.log(`"${pick.profile.name}" is now the default for new sessions.`);
  }
  return 0;
}

function order(argv: string[]): number {
  const cfg = requireSetup();
  for (const n of argv) getProfile(cfg, n);
  mutateConfig((c) => void (c.order = [...argv, ...c.order.filter((n) => !argv.includes(n))]));
  console.log(`Failover order: ${ordered(loadConfig()).map((p) => p.name).join(" → ")}`);
  return 0;
}

function bind(argv: string[]): number {
  const cfg = requireSetup();
  const p = parse(argv);
  const [name, dirArg] = p._;
  if (!name) throw new UserError("usage: j2c bind <profile> [dir] [--strict]");
  getProfile(cfg, name);
  const dir = fs.realpathSync(path.resolve(dirArg ?? "."));
  mutateConfig((c) => {
    c.bindings = c.bindings.filter((b) => b.dir !== dir);
    c.bindings.push({ dir, profile: name, ...(p.flags.strict ? { strict: true } : {}) });
  });
  console.log(`${dir} → ${name}${p.flags.strict ? " (strict: no other account can run here)" : ""}`);
  return 0;
}

function unbind(argv: string[]): number {
  requireSetup();
  const dir = fs.realpathSync(path.resolve(argv[0] ?? "."));
  mutateConfig((c) => void (c.bindings = c.bindings.filter((b) => b.dir !== dir)));
  console.log(`${dir} is no longer bound.`);
  return 0;
}

function auto(argv: string[]): number {
  requireSetup();
  const p = parse(argv, ["5h", "weekly", "dwell"]);
  const mode = p._[0];
  if (mode !== "on" && mode !== "off") throw new UserError("usage: j2c auto on|off [--paid] [--5h N] [--weekly N] [--dwell MIN]");
  const num = (k: string, lo: number, hi: number) => {
    const v = str(p.flags[k]);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new UserError(`--${k} must be between ${lo} and ${hi}`);
    return n;
  };
  const cfg = mutateConfig((c) => {
    c.autoSwitch.enabled = mode === "on";
    if (p.flags.paid !== undefined) c.autoSwitch.allowPaid = !!p.flags.paid;
    c.autoSwitch.fiveHourPct = num("5h", 50, 100) ?? c.autoSwitch.fiveHourPct;
    c.autoSwitch.weeklyPct = num("weekly", 50, 100) ?? c.autoSwitch.weeklyPct;
    c.autoSwitch.minDwellMin = num("dwell", 0, 600) ?? c.autoSwitch.minDwellMin;
  });
  if (mode === "off") console.log("Auto-switch is off. Claude Code's own wait-at-limit behaviour is back.");
  else {
    console.log(`Auto-switch is on: sessions move at the end of a turn when 5h ≥ ${cfg.autoSwitch.fiveHourPct}% or weekly ≥ ${cfg.autoSwitch.weeklyPct}%, or when an account refuses.`);
    console.log(cfg.autoSwitch.allowPaid ? "Paid profiles (Bedrock, API key…) may be used as a fallback." : "Paid profiles are never used automatically (add --paid to allow).");
    console.log("Use only your own accounts. See the README section on Anthropic's terms.");
  }
  return 0;
}

async function recover(argv: string[]): Promise<number> {
  const cfg = requireSetup();
  const list = interruptedSessions().filter((s) => fs.existsSync(s.cwd));
  if (!list.length) {
    console.log("No interrupted sessions. 🎉");
    return 0;
  }
  const n = argv[0] ? Number(argv[0]) : undefined;
  if (n === undefined) {
    console.log("Sessions that were mid-reply when they died:\n");
    list.slice(0, 20).forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. ${new Date(s.updatedAt).toLocaleString()}  ${s.profile.padEnd(10)} ${s.cwd}  (${s.sessionId.slice(0, 8)})`));
    console.log("\nResume one with: j2c recover <number>");
    return 0;
  }
  const s = list[n - 1];
  if (!s) throw new UserError(`no session #${n}`);
  const prof = cfg.profiles.find((p) => p.name === s.profile);
  if (!prof) throw new UserError(`profile "${s.profile}" no longer exists; resume it by hand: claude --resume ${s.sessionId}`);
  const usage = loadUsage();
  const onProfile = usable(cfg, usage, prof).ok ? prof : (pickNext(cfg, usage, prof, s.cwd).profile ?? prof);
  process.chdir(s.cwd);
  return supervise({
    profile: onProfile.name,
    args: ["--resume", s.sessionId, "[julius2claude] This session was interrupted (the machine, WSL or terminal died) in the middle of a reply. Check what the last tool call actually did, redo anything incomplete, then continue the task."],
    cwd: s.cwd,
  });
}

const WINDOW_LABEL: Record<string, string> = {
  five_hour: "5-hour limit",
  seven_day: "weekly limit",
  seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit",
};

function stats(argv: string[]): number {
  const cfg = requireSetup();
  const p = parse(argv, ["days"]);
  const days = str(p.flags.days) ? Number(str(p.flags.days)) : undefined;
  if (days !== undefined && (!Number.isFinite(days) || days <= 0)) throw new UserError("--days must be a positive number");
  const since = days ? Math.floor(Date.now() / 1000) - days * 86400 : 0;
  const rows = computeStats(ordered(cfg).map((x) => x.name), since);
  if (p.flags.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, sinceEpochSec: since || null, profiles: rows }, null, 2));
    return 0;
  }
  const describe = (w: string, s: WindowStats, verb: string) =>
    `${WINDOW_LABEL[w] ?? w}: ${verb} ${s.count} time${s.count === 1 ? "" : "s"}` +
    (s.avgElapsedSec !== undefined ? `, after ${fmtDuration(s.avgElapsedSec)} on average` : "") +
    (s.avgTokens !== undefined ? `, ~${fmtTokens(s.avgTokens)} tokens per window` : "");
  console.log(days ? `Last ${days} day(s). Tokens are counted from sessions started with j2c.\n` : "Tokens are counted from sessions started with j2c.\n");
  for (const r of rows) {
    const prof = getProfile(cfg, r.profile);
    console.log(`${r.profile}${prof.account?.email ? ` (${prof.account.email})` : ` (${prof.provider})`}`);
    const t = r.total;
    console.log(`  tokens   last 5h ${fmtTokens(sum(r.last5h))} · last 7 days ${fmtTokens(sum(r.last7d))} · total ${fmtTokens(sum(t))}`);
    if (sum(t)) console.log(`           input ${fmtTokens(t.input)} · output ${fmtTokens(t.output)} · cache read ${fmtTokens(t.cacheRead)} · cache write ${fmtTokens(t.cacheWrite)}`);
    for (const [w, s] of Object.entries(r.limits)) console.log(`  ${describe(w, s, "reached")}`);
    for (const [w, s] of Object.entries(r.thresholds)) console.log(`  ${describe(w, s, "switched early")}`);
    if (!Object.keys(r.limits).length && !Object.keys(r.thresholds).length) console.log("  no limits reached yet");
    if (r.switchesOut || r.switchesIn) console.log(`  switches  ${r.switchesOut} away · ${r.switchesIn} onto this account`);
    console.log("");
  }
  return 0;
}

function doctor(): number {
  const cfg = requireSetup();
  let problems = 0;
  const ok = (m: string) => console.log(`  ✓ ${m}`);
  const bad = (m: string) => {
    problems++;
    console.log(`  ✗ ${m}`);
  };
  const warn = (m: string) => console.log(`  ! ${m}`);
  console.log("Claude Code");
  const v = claudeVersion();
  if (!v) bad("`claude` not found on PATH");
  else if (!versionAtLeast(v, "2.1.152")) bad(`Claude Code ${v}: resuming on another account needs ≥ 2.1.152 (claude update)`);
  else if (!versionAtLeast(v, "2.1.248")) warn(`Claude Code ${v}: parallel sessions on one account can race on token refresh before 2.1.248`);
  else ok(`Claude Code ${v}`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 18) bad(`Node ${process.versions.node} (need ≥ 18)`);
  else ok(`Node ${process.versions.node}`);

  console.log("Environment");
  const leaks = AUTH_ENV_KEYS.filter((k) => process.env[k] && k !== "CLAUDE_CONFIG_DIR");
  if (leaks.length) warn(`${leaks.join(", ")} set in your shell: plain \`claude\` would use it instead of your login. j2c removes it for its sessions (use --keep-env to keep it).`);
  else ok("no auth overrides in your shell");
  if (process.env.CLAUDE_CONFIG_DIR) warn(`CLAUDE_CONFIG_DIR=${process.env.CLAUDE_CONFIG_DIR} is set in your shell; j2c ignores it and uses each profile's own folder.`);
  const dotenv = path.join(process.cwd(), ".env");
  if (fs.existsSync(dotenv) && /^\s*(export\s+)?ANTHROPIC_(API_KEY|AUTH_TOKEN)\s*=/m.test(fs.readFileSync(dotenv, "utf8")))
    warn(".env in this folder defines an Anthropic key; some tools load it automatically and bill it instead of your plan.");
  if (fs.existsSync(path.join(commandsDir(), "use.md"))) ok("/j2c:* commands installed");
  else bad("/j2c:* commands missing (run `j2c setup`)");

  console.log("Profiles");
  for (const p of ordered(cfg)) {
    const st = loginState(p);
    const issues: string[] = [];
    if (st === "needs-login") issues.push(`not logged in → j2c login ${p.name}`);
    const cred = readCredentials(p);
    if (st === "ok" && cred?.refreshTokenExpiresAt && cred.refreshTokenExpiresAt - Date.now() < 3 * 86400e3)
      warn(`${p.name}: login expires ${new Date(cred.refreshTokenExpiresAt).toLocaleDateString()}; start one session on it (\`j2c -P ${p.name}\`) to renew it`);
    if (!p.isMain) {
      if (!fs.existsSync(p.configDir)) issues.push("folder missing → j2c login " + p.name);
      else {
        const link = path.join(p.configDir, "projects");
        try {
          if (!fs.lstatSync(link).isSymbolicLink() || fs.realpathSync(link) !== fs.realpathSync(path.join(groupStore(p.group), "projects")))
            issues.push("history folder not shared (will be repaired on next launch)");
        } catch {
          issues.push("history folder missing (will be repaired on next launch)");
        }
      }
    }
    if (p.provider === "claude" && p.account?.uuid) {
      const id = readIdentity(p);
      if (id.uuid && id.uuid !== p.account.uuid) issues.push(`logged in as ${id.email}, expected ${p.account.email}`);
    }
    const blocks = activeBlocks(loadUsage()[p.name]).filter((b) => b.until === 0);
    for (const b of blocks) issues.push(b.reason);
    if (issues.length) bad(`${p.name}: ${issues.join("; ")}`);
    else ok(`${p.name} (${p.provider}${p.account?.email ? `, ${p.account.email}` : ""})`);
  }
  if (process.platform === "darwin") warn("macOS keeps logins in the Keychain; julius2claude can't read their expiry, so login state shows as unknown.");
  if (process.platform === "win32") warn("Windows: shared folders use junctions; keep profiles on a local NTFS drive.");
  if (process.env.WSL_DISTRO_NAME && paths.config().startsWith("/mnt/"))
    bad(`julius2claude data is on the Windows drive (${paths.config()}); links there break. Keep J2C_HOME inside the Linux home.`);
  const stale = defaultClaudeJson();
  if (!fs.existsSync(stale)) warn(`${stale} not found; is Claude Code set up for this user?`);
  console.log(problems ? `\n${problems} problem(s) found.` : "\nAll good.");
  return problems ? 1 : 0;
}

const isEntry = (() => {
  try {
    return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UserError) process.stderr.write(`j2c: ${err.message}\n`);
      else process.stderr.write(`j2c: unexpected error: ${err?.stack ?? err}\n(log: ${paths.log()})\n`);
      process.exit(1);
    },
  );
}
