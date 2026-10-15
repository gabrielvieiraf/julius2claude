import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { type Config, type Profile, UserError, getProfile, loadConfig } from "./config.js";
import { limitLabel } from "./hooks.js";
import { defaultClaudeDir, j2cHome, paths } from "./paths.js";
import { signal } from "./proc.js";
import { pickNext } from "./router.js";
import { alive, liveRuns } from "./runs.js";
import { readJson } from "./store.js";
import { supervise } from "./supervisor.js";
import { loadUsage, mutateUsage, nowS } from "./usage.js";

export interface StuckSession {
  sessionId: string;
  cwd: string;
  transcript: string;
  limitType?: string;
  resetsAt?: number;
  refusedAt: number;
  pid?: number;
  configDir?: string;
  cutAgents: string[];
}

interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  kind?: string;
}

const RECENT_MS = 3 * 86400e3;

function configDirs(cfg: Config): string[] {
  return [...new Set([defaultClaudeDir(), ...cfg.profiles.map((p) => p.configDir)])];
}

function projectStores(cfg: Config): string[] {
  const stores = new Set<string>([path.join(defaultClaudeDir(), "projects")]);
  for (const p of cfg.profiles) if (p.group && p.group !== "default") stores.add(path.join(j2cHome(), "groups", p.group, "projects"));
  return [...stores];
}

export function runningClaudes(cfg: Config): (SessionFile & { configDir: string })[] {
  const out: (SessionFile & { configDir: string })[] = [];
  for (const dir of configDirs(cfg)) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(dir, "sessions")).filter((n) => /^\d+\.json$/.test(n));
    } catch {}
    for (const n of names) {
      const s = readJson<SessionFile | null>(path.join(dir, "sessions", n), null);
      if (s?.pid && s.sessionId && alive(s.pid)) out.push({ ...s, configDir: dir });
    }
  }
  return out;
}

function tailLines(file: string, bytes = 512 * 1024): string[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (len < size) lines.shift();
    return lines.filter(Boolean);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function lastAssistant(file: string): any {
  const lines = tailLines(file);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o: any;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (o.type === "assistant" && !o.isSidechain) return o;
  }
  return undefined;
}

export function inspectTranscript(transcript: string): StuckSession | undefined {
  const last = lastAssistant(transcript);
  if (!last?.isApiErrorMessage || last.error !== "rate_limit") return undefined;
  const q = last.quotaLimits ?? {};
  const refusedAt = Date.parse(last.timestamp ?? "") || 0;
  const cutAgents: string[] = [];
  const sub = path.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  try {
    for (const f of fs.readdirSync(sub)) {
      if (!f.endsWith(".jsonl")) continue;
      const a = lastAssistant(path.join(sub, f));
      const tail = tailLines(path.join(sub, f), 64 * 1024).slice(-3).join("\n");
      const refused = (a?.isApiErrorMessage && a.error === "rate_limit") || /"error":"rate_limit"/.test(tail);
      if (!refused) continue;
      const meta = readJson<{ description?: string } | null>(path.join(sub, f.replace(/\.jsonl$/, ".meta.json")), null);
      cutAgents.push(meta?.description ?? f.replace(/\.jsonl$/, ""));
    }
  } catch {}
  return {
    sessionId: last.sessionId ?? path.basename(transcript, ".jsonl"),
    cwd: last.cwd ?? "",
    transcript,
    limitType: q.status === "rejected" ? q.rateLimitType : undefined,
    resetsAt: q.status === "rejected" ? q.resetsAt : undefined,
    refusedAt,
    cutAgents,
  };
}

function findTranscript(cfg: Config, sessionId: string): string | undefined {
  for (const store of projectStores(cfg)) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(store);
    } catch {}
    for (const d of dirs) {
      const f = path.join(store, d, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  }
  return undefined;
}

export function stuckSessions(cfg: Config): StuckSession[] {
  const procs = runningClaudes(cfg);
  const supervised = new Set(liveRuns().map((r) => r.sessionId).filter(Boolean));
  const seen = new Map<string, StuckSession>();
  for (const store of projectStores(cfg)) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(store);
    } catch {}
    for (const d of dirs) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(path.join(store, d)).filter((f) => f.endsWith(".jsonl"));
      } catch {}
      for (const f of files) {
        const full = path.join(store, d, f);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {}
        if (Date.now() - mtime > RECENT_MS) continue;
        const s = inspectTranscript(full);
        if (!s || supervised.has(s.sessionId)) continue;
        const proc = procs.find((p) => p.sessionId === s.sessionId);
        if (proc) {
          s.pid = proc.pid;
          s.configDir = proc.configDir;
          if (!s.cwd) s.cwd = proc.cwd;
        }
        seen.set(s.sessionId, s);
      }
    }
  }
  for (const p of procs) {
    if (seen.has(p.sessionId) || supervised.has(p.sessionId)) continue;
    const t = findTranscript(cfg, p.sessionId);
    const s = t ? inspectTranscript(t) : undefined;
    if (s) seen.set(s.sessionId, { ...s, pid: p.pid, configDir: p.configDir, cwd: s.cwd || p.cwd });
  }
  return [...seen.values()]
    .filter((s) => s.pid || !s.resetsAt || s.resetsAt > nowS())
    .filter((s) => (readJson<{ updatedAt?: number } | null>(paths.session(s.sessionId), null)?.updatedAt ?? 0) <= s.refusedAt)
    .sort((a, b) => b.refusedAt - a.refusedAt);
}

function profileOf(cfg: Config, s: StuckSession): Profile {
  const byDir = s.configDir ? cfg.profiles.find((p) => path.resolve(p.configDir) === path.resolve(s.configDir!)) : undefined;
  return byDir ?? cfg.profiles.find((p) => p.isMain) ?? cfg.profiles[0];
}

export function rescuePrompt(s: StuckSession, from: string, to: string, model: string | undefined, note: string | undefined): string {
  return [
    `[julius2claude] This session was stopped by the ${limitLabel(s.limitType)} on account "${from}" and was moved to "${to}".`,
    s.cutAgents.length ? `These background agents were cut off by the limit: ${s.cutAgents.map((a) => `"${a}"`).join(", ")}.` : "",
    "Background shells from the previous process were stopped.",
    "Check what each agent and the last step actually completed (git status, changed files, anything already deployed), re-run only what is missing with the same instructions, restart the shells that are needed, then continue the task.",
    model ? `Use the ${model} model for everything, including agents (set model: ${model} when starting agents).` : "",
    note ?? "",
  ].filter(Boolean).join(" ");
}

function describe(cfg: Config, s: StuckSession, i?: number): string {
  const from = profileOf(cfg, s).name;
  const back = s.resetsAt ? ` · back ${new Date(s.resetsAt * 1000).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}` : "";
  return [
    `${i !== undefined ? `${String(i + 1).padStart(2)}. ` : ""}${s.cwd || "(unknown folder)"}`,
    `    session ${s.sessionId} · account ${from} · ${limitLabel(s.limitType)}${back}`,
    `    ${s.pid ? `still open (pid ${s.pid})` : "not running"}${s.cutAgents.length ? ` · cut agents: ${s.cutAgents.join(", ")}` : ""}`,
  ].join("\n");
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((r) => rl.question(question, r));
  rl.close();
  return !/^n/i.test(answer.trim());
}

async function stopProcess(pid: number): Promise<boolean> {
  const steps: [NodeJS.Signals, number][] = [["SIGINT", 2500], ["SIGINT", 2500], ["SIGTERM", 3000], ["SIGKILL", 2000]];
  for (const [sig, ms] of steps) {
    if (!alive(pid)) return true;
    signal([pid], sig);
    const deadline = Date.now() + ms;
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  }
  return !alive(pid);
}

export interface RescueOptions {
  index?: number;
  session?: string;
  to?: string;
  model?: string;
  note?: string;
  yes?: boolean;
  list?: boolean;
  all?: boolean;
}

export async function rescue(opts: RescueOptions): Promise<number> {
  const cfg = loadConfig();
  let list = stuckSessions(cfg);
  const here = path.resolve(process.cwd());
  if (!opts.all && !opts.session && list.some((s) => s.cwd === here)) list = list.filter((s) => s.cwd === here);
  if (opts.session) list = list.filter((s) => s.sessionId === opts.session);

  if (!list.length) {
    console.log(opts.session ? `Session ${opts.session} is not stuck at a usage limit.` : "No session is stuck at a usage limit.");
    return 0;
  }
  if (opts.list || (list.length > 1 && opts.index === undefined)) {
    console.log("Sessions stuck at a usage limit:\n");
    list.forEach((s, i) => console.log(describe(cfg, s, i) + "\n"));
    console.log("Rescue one with: j2c rescue <number> [--model sonnet]");
    return 0;
  }
  const s = opts.index !== undefined ? list[opts.index - 1] : list[0];
  if (!s) throw new UserError(`no stuck session #${opts.index}`);
  if (!s.cwd || !fs.existsSync(s.cwd)) throw new UserError(`the folder of session ${s.sessionId} (${s.cwd || "unknown"}) no longer exists.`);

  const from = profileOf(cfg, s);
  if (s.resetsAt && s.resetsAt > nowS())
    mutateUsage((u) => {
      const cur = (u[from.name] ??= {});
      cur.blocks = [
        ...(cur.blocks ?? []).filter((b) => (b.until === 0 || b.until > nowS()) && b.type !== s.limitType),
        { until: s.resetsAt!, reason: `${limitLabel(s.limitType)} reached`, type: s.limitType },
      ];
    });

  let target: Profile | undefined;
  if (opts.to) target = getProfile(cfg, opts.to);
  else {
    const next = pickNext(cfg, loadUsage(), from, s.cwd);
    target = next.profile;
    if (!target) {
      console.log(describe(cfg, s));
      console.log(`\nNo other account can take it now (${next.reason})${next.waitUntil ? `; the first one frees up ${new Date(next.waitUntil * 1000).toLocaleString()}` : ""}.`);
      return 1;
    }
  }

  console.log(describe(cfg, s));
  console.log(`\n→ resuming it on "${target.name}"${opts.model ? ` with ${opts.model}` : ""}, in this terminal.`);
  if (s.pid) {
    const ok = opts.yes || (await confirm(`The stuck session is still open (pid ${s.pid}). Close it first? [Y/n] `));
    if (!ok) {
      console.log(`Close it yourself (/exit in that terminal) and run j2c rescue again.`);
      return 1;
    }
    if (!(await stopProcess(s.pid))) throw new UserError(`could not stop pid ${s.pid}.`);
    console.log(`Closed the stuck session (pid ${s.pid}). If its terminal looks broken, type \`reset\` there.`);
  }

  process.chdir(s.cwd);
  return supervise({
    profile: target.name,
    args: [...(opts.model ? ["--model", opts.model] : []), "--resume", s.sessionId, rescuePrompt(s, from.name, target.name, opts.model, opts.note)],
    cwd: s.cwd,
  });
}

