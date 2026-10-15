import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Config, type Profile, loadConfig, getProfile, UserError } from "./config.js";
import { paths, defaultClaudeDir } from "./paths.js";
import { ensureProfileDir, loginState } from "./profiles.js";
import { pickNext, pickStart, allowedIn } from "./router.js";
import { type Run, BOUNDARY_MS, liveRuns, loadRun, mutateRun, removeRun, saveRun } from "./runs.js";
import { log, readJson, writeJson } from "./store.js";
import { loadUsage, mutateUsage, nowS } from "./usage.js";
import { recordEvent } from "./stats.js";
import { claudeBin, claudeVersion, descendants, restoreTty, saveTty, signal, versionAtLeast } from "./proc.js";
import { alive } from "./runs.js";

export const AUTH_ENV_KEYS = [
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_MANTLE",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "AWS_BEARER_TOKEN_BEDROCK",
  "ANTHROPIC_FOUNDRY_API_KEY", "CLAUDE_CONFIG_DIR", "CLAUDE_SECURESTORAGE_CONFIG_DIR",
];

const KEEP_VALUE_FLAGS = new Set(["--model", "--permission-mode", "--add-dir", "--agent", "--effort", "--fallback-model"]);
const KEEP_BOOL_FLAGS = new Set([
  "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--verbose", "--chrome", "--no-chrome", "--ide",
]);

export interface SuperviseOptions {
  profile?: string;
  args: string[];
  cwd: string;
  keepEnv?: boolean;
}

export function buildEnv(p: Profile, run: Run, keepEnv = false, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  if (!keepEnv) for (const k of AUTH_ENV_KEYS) delete env[k];
  delete env.CLAUDE_CONFIG_DIR;
  Object.assign(env, p.env ?? {});
  if (!p.isMain) env.CLAUDE_CONFIG_DIR = p.configDir;
  env.J2C_RUN_ID = run.id;
  env.J2C_PROFILE = p.name;
  env.J2C_NODE = process.execPath;
  env.J2C_BIN = path.resolve(process.argv[1] ?? "j2c");
  return env;
}

export function carryFlags(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const [flag, inline] = a.split(/=(.*)/s, 2);
    if (KEEP_BOOL_FLAGS.has(a)) out.push(a);
    else if (KEEP_VALUE_FLAGS.has(flag)) {
      if (inline !== undefined) out.push(a);
      else if (i + 1 < args.length) out.push(a, args[++i]);
    }
  }
  return out;
}

function userStatusline(p: Profile, cwd: string): string | undefined {
  const files = [
    path.join(cwd, ".claude", "settings.local.json"),
    path.join(cwd, ".claude", "settings.json"),
    path.join(p.isMain ? defaultClaudeDir() : p.configDir, "settings.json"),
  ];
  for (const f of files) {
    const s = readJson<any>(f, null)?.statusLine;
    if (s?.type === "command" && typeof s.command === "string" && !s.command.includes(" statusline --run ")) return s.command;
  }
  return undefined;
}

export function writeRunSettings(cfg: Config, run: Run, p: Profile, extra: string[]): string {
  const me = `"${process.execPath}" "${path.resolve(process.argv[1] ?? "j2c")}"`;
  const hook = (ev: string) => [{ hooks: [{ type: "command", command: `${me} hook ${ev} --run ${run.id}`, timeout: 15 }] }];
  const wrapped = userStatusline(p, run.cwd);
  const settings: any = {
    hooks: {
      SessionStart: hook("session-start"),
      UserPromptSubmit: hook("prompt"),
      Stop: hook("stop"),
      StopFailure: hook("stop-failure"),
      SessionEnd: hook("session-end"),
      SubagentStart: hook("subagent-start"),
      SubagentStop: hook("subagent-stop"),
    },
    statusLine: {
      type: "command",
      command: `${me} statusline --run ${run.id}` + (wrapped ? ` --wrap-b64 ${Buffer.from(wrapped).toString("base64")}` : ""),
      padding: 0,
    },
  };
  if (cfg.autoSwitch.enabled && p.provider === "claude") settings.autoContinueAtUsageLimit = false;
  const i = extra.indexOf("--settings");
  if (i !== -1 && extra[i + 1]) {
    const v = extra[i + 1];
    const theirs = v.trim().startsWith("{") ? JSON.parse(v) : readJson<any>(v, {});
    for (const [k, val] of Object.entries(theirs)) if (!(k in settings)) settings[k] = val;
  }
  const file = path.join(paths.runsDir(), `${run.id}.settings.json`);
  writeJson(file, settings);
  return file;
}

function stripSettingsFlag(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--settings") {
      i++;
      continue;
    }
    if (args[i].startsWith("--settings=")) continue;
    out.push(args[i]);
  }
  return out;
}

const say = (msg: string) => process.stderr.write(`\x1b[33m[julius2claude]\x1b[0m ${msg}\n`);

export async function supervise(opts: SuperviseOptions): Promise<number> {
  const cfg = loadConfig();
  const cwd = path.resolve(opts.cwd);
  const start = pickStart(cfg, loadUsage(), cwd, opts.profile);
  if (!start.profile) throw new UserError(start.reason ?? "no usable profile");
  let profile = start.profile;
  if (start.reason) say(`${profile.name} looks exhausted and ${start.reason}; starting on it anyway.`);
  if (loginState(profile) === "needs-login") throw new UserError(`profile "${profile.name}" is not logged in. Run \`j2c login ${profile.name}\`.`);

  const version = claudeVersion();
  if (!version) throw new UserError("could not run `claude`. Install Claude Code first: https://code.claude.com");
  if (cfg.autoSwitch.enabled && !versionAtLeast(version, "2.1.152"))
    say(`Claude Code ${version} can fail to resume a session on another account. Update with \`claude update\`.`);

  const run: Run = { id: crypto.randomUUID(), pid: process.pid, profile: profile.name, cwd, busy: false, startedAt: Date.now() };
  saveRun(run);
  const settingsFile = writeRunSettings(cfg, run, profile, opts.args);
  const ttyState = saveTty();
  let args = [...stripSettingsFlag(opts.args)];
  const carried = carryFlags(opts.args);

  const onSigint = () => {};
  process.on("SIGINT", onSigint);
  let child: ChildProcess | undefined;
  for (const sig of ["SIGTERM", "SIGHUP"] as const) process.on(sig, () => child?.kill(sig));

  try {
    for (;;) {
      ensureProfileDir(profile);
      const env = buildEnv(profile, loadRun(run.id) ?? run, opts.keepEnv);
      mutateRun(run.id, (r) => {
        r.profile = profile.name;
        r.childStartedAt = Date.now();
        r.busy = false;
        r.agents = [];
        r.baselineChildren = undefined;
        r.pendingSwitch = undefined;
      });
      log(`launch run=${run.id} profile=${profile.name} args=${JSON.stringify(args)}`);
      child = spawn(claudeBin(), ["--settings", settingsFile, ...args], { stdio: "inherit", cwd, env });
      mutateRun(run.id, (r) => void (r.childPid = child!.pid));

      const outcome = await watch(child, run.id);
      if (outcome.kind === "exited") {
        if (outcome.code !== 0) restoreTty(ttyState);
        return outcome.code;
      }

      const cur = loadRun(run.id)!;
      const cfgNow = loadConfig();
      const pending = cur.pendingSwitch!;
      let target: Profile | undefined;
      let waitUntil: number | undefined;
      if (pending.to) {
        target = cfgNow.profiles.find((p) => p.name === pending.to);
        if (!target || !allowedIn(cfgNow, cwd).some((p) => p.name === target!.name)) {
          say(`can't switch to "${pending.to}" here.`);
          mutateRun(run.id, (r) => void (r.pendingSwitch = undefined));
          const again = await watch(child, run.id);
          if (again.kind === "exited") return again.code;
          continue;
        }
      } else {
        const next = pickNext(cfgNow, loadUsage(), getProfile(cfgNow, profile.name), cwd);
        target = next.profile;
        waitUntil = next.waitUntil;
        if (!target && !pending.hard) {
          mutateRun(run.id, (r) => void (r.pendingSwitch = undefined));
          const again = await watch(child, run.id);
          if (again.kind === "exited") return again.code;
          continue;
        }
      }

      const sessionId = cur.sessionId;
      if (sessionId && liveRuns().some((r) => r.id !== run.id && r.sessionId === sessionId)) {
        say(`session ${sessionId.slice(0, 8)} is open in another terminal; not moving it (two processes on one transcript corrupt it).`);
        mutateRun(run.id, (r) => void (r.pendingSwitch = undefined));
        const again = await watch(child, run.id);
        if (again.kind === "exited") return again.code;
        continue;
      }

      const killedTasks = await stopClaude(child, cur);
      restoreTty(ttyState);

      if (!target) {
        const resumeAt = await waitForReset(cfgNow, profile, cwd, waitUntil);
        if (!resumeAt) return 0;
        target = resumeAt;
      }

      const from = profile.name;
      profile = target;
      mutateUsage((u) => void ((u[profile.name] ??= {}).enteredAt = Date.now()));
      say(`${from} → ${profile.name} (${pending.reason}).${sessionId ? " Resuming the same session…" : ""}`);
      recordEvent({ type: "switch", profile: from, to: profile.name, reason: pending.reason });
      log(`switch run=${run.id} ${from} -> ${profile.name} reason=${pending.reason} hard=${pending.hard}`);

      const transcriptOk = !!cur.transcriptPath && fs.existsSync(cur.transcriptPath);
      if (sessionId && transcriptOk) {
        args = [...carried, "--resume", sessionId];
        if (pending.hard) args.push(continuePrompt(from, profile.name, pending.reason, killedTasks));
      } else {
        args = [...stripSettingsFlag(opts.args)];
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    removeRun(run.id);
    fs.rmSync(settingsFile, { force: true });
  }
}

type Outcome = { kind: "exited"; code: number } | { kind: "switch" };

function watch(child: ChildProcess, runId: string): Promise<Outcome> {
  return new Promise((resolve) => {
    let done = false;
    let lastSeenStop = 0;
    const finish = (o: Outcome) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      child.off("exit", onExit);
      resolve(o);
    };
    const onExit = (code: number | null, sig: NodeJS.Signals | null) => finish({ kind: "exited", code: code ?? (sig ? 130 : 1) });
    child.on("exit", onExit);
    const timer = setInterval(() => {
      const r = loadRun(runId);
      if (!r) return;
      if (r.lastStopAt && r.lastStopAt !== lastSeenStop && child.pid) {
        lastSeenStop = r.lastStopAt;
        const n = descendants(child.pid).length;
        if (r.baselineChildren === undefined || n < r.baselineChildren) mutateRun(runId, (x) => void (x.baselineChildren = n));
      }
      if (readyToSwitch(r, child.pid)) finish({ kind: "switch" });
    }, 250);
    if (child.exitCode !== null || child.signalCode) onExit(child.exitCode, child.signalCode);
  });
}

export function readyToSwitch(r: Run, childPid: number | undefined, now = Date.now()): boolean {
  const p = r.pendingSwitch;
  if (!p || r.busy || !r.lastStopAt || r.lastStopAt < p.requestedAt) return false;
  if (p.hard || p.to) return true;
  if (now - r.lastStopAt > BOUNDARY_MS) return false;
  if ((r.agents ?? []).length) return false;
  if (childPid && r.baselineChildren !== undefined && descendants(childPid).length > r.baselineChildren) return false;
  return true;
}

async function stopClaude(child: ChildProcess, r: Run): Promise<string[]> {
  const pid = child.pid!;
  const tree = descendants(pid);
  const extra = r.baselineChildren !== undefined && tree.length > r.baselineChildren ? describe(tree) : [];
  const exited = new Promise<void>((res) => (child.exitCode !== null || child.signalCode ? res() : child.once("exit", () => res())));
  const steps: [NodeJS.Signals, number][] = [["SIGINT", 2500], ["SIGINT", 2500], ["SIGTERM", 3000], ["SIGKILL", 2000]];
  for (const [sig, ms] of steps) {
    if (!alive(pid)) break;
    signal(sig === "SIGINT" ? [pid] : [pid, ...tree], sig);
    await Promise.race([exited, delay(ms)]);
  }
  const left = tree.filter(alive);
  signal(left, "SIGTERM");
  await delay(left.length ? 500 : 0);
  signal(left.filter(alive), "SIGKILL");
  return extra;
}

function describe(pids: number[]): string[] {
  if (process.platform === "win32") return [];
  const out: string[] = [];
  for (const p of pids.slice(0, 10)) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      if (cmd) out.push(cmd.slice(0, 120));
    } catch {}
  }
  return out;
}

export function continuePrompt(from: string, to: string, reason: string, killed: string[]): string {
  return [
    `[julius2claude] This session was moved from account "${from}" to "${to}" because ${reason}.`,
    "The last turn was cut off by the limit. Check the result of the last tool call and redo anything that did not complete.",
    killed.length ? `These background processes were stopped during the move; restart the ones still needed: ${killed.join(" | ")}.` : "",
    "Then continue the task from where it stopped.",
  ].filter(Boolean).join(" ");
}

async function waitForReset(cfg: Config, from: Profile, cwd: string, until: number | undefined): Promise<Profile | undefined> {
  if (!until) {
    say("every eligible account is blocked and none has a known reset time. Run `j2c status` to see why.");
    return undefined;
  }
  say(`every eligible account is at its limit. Waiting until ${new Date(until * 1000).toLocaleTimeString()} to resume (Ctrl+C to stop).`);
  let cancelled = false;
  const onInt = () => (cancelled = true);
  process.on("SIGINT", onInt);
  try {
    while (!cancelled && nowS() < until + 5) await delay(1000);
  } finally {
    process.off("SIGINT", onInt);
  }
  if (cancelled) return undefined;
  const usage = loadUsage();
  const self = getProfile(loadConfig(), from.name);
  const next = pickNext(cfg, usage, self, cwd);
  return next.profile ?? self;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
