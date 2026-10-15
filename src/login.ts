import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type Profile, UserError, getProfile, loadConfig, mutateConfig } from "./config.js";
import { paths } from "./paths.js";
import { claudeBin } from "./proc.js";
import { ensureProfileDir, readIdentity, type Identity } from "./profiles.js";
import { alive } from "./runs.js";
import { log, readJson, sleepSync, writeJson } from "./store.js";
import { buildEnv } from "./supervisor.js";
import { mutateUsage } from "./usage.js";

interface LoginState {
  status: "starting" | "waiting" | "done" | "failed";
  url?: string;
  pid?: number;
  error?: string;
  email?: string;
  org?: string;
  startedAt: number;
}

const stateFile = (name: string) => path.join(paths.stateDir(), `login-${name}.json`);
const codeFile = (name: string) => path.join(paths.stateDir(), `login-${name}.code`);
const WAIT_FOR_CODE_MS = 15 * 60_000;

export function loginEnv(p: Profile): NodeJS.ProcessEnv {
  const env = buildEnv(p, { id: "login", pid: process.pid, profile: p.name, cwd: process.cwd(), busy: false, startedAt: Date.now() });
  delete env.J2C_RUN_ID;
  return env;
}

export interface LoginResult {
  email?: string;
  org?: string;
  warnings: string[];
}

export function recordLogin(name: string, before: Identity): LoginResult {
  const cfg = loadConfig();
  const p = getProfile(cfg, name);
  const id = readIdentity(p);
  const warnings: string[] = [];
  if (before.uuid && id.uuid && (before.uuid !== id.uuid || before.orgUuid !== id.orgUuid))
    warnings.push(`"${name}" was ${before.email} and is now ${id.email}.`);
  const dup = cfg.profiles.find((o) => o.name !== name && o.account?.uuid && o.account.uuid === id.uuid && readIdentity(o).orgUuid === id.orgUuid);
  if (dup) warnings.push(`This is the same account as "${dup.name}". It works, but adds no extra capacity.`);
  mutateConfig((c) => {
    getProfile(c, name).account = { email: id.email, org: id.org, plan: id.plan, uuid: id.uuid };
  });
  mutateUsage((u) => {
    if (u[name]) u[name].blocks = (u[name].blocks ?? []).filter((b) => b.type !== "auth");
  });
  return { email: id.email, org: id.org, warnings };
}

function claudeProfile(name: string): Profile {
  const p = getProfile(loadConfig(), name);
  if (p.provider !== "claude") throw new UserError(`"${name}" is a ${p.provider} profile; it uses your ${p.provider} credentials, not a Claude login.`);
  return p;
}

export function startLogin(name: string, email: string | undefined, json: boolean): number {
  const p = claudeProfile(name);
  ensureProfileDir(p);
  const prev = readJson<LoginState | null>(stateFile(name), null);
  if (prev?.pid && alive(prev.pid)) {
    try {
      process.kill(prev.pid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 5_000;
    while (alive(prev.pid) && Date.now() < deadline) sleepSync(100);
  }
  fs.rmSync(codeFile(name), { force: true });
  writeJson(stateFile(name), { status: "starting", startedAt: Date.now() } satisfies LoginState);
  const worker = spawn(process.execPath, [path.resolve(process.argv[1]), "__login-worker", name, ...(email ? ["--email", email] : [])], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  worker.unref();
  const deadline = Date.now() + 30_000;
  let st = readJson<LoginState | null>(stateFile(name), null);
  while (Date.now() < deadline && (!st || st.status === "starting")) {
    sleepSync(200);
    st = readJson<LoginState | null>(stateFile(name), null);
  }
  if (st?.status === "done") {
    fs.rmSync(stateFile(name), { force: true });
    if (json) console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "logged_in", email: st.email ?? null, org: st.org ?? null }));
    else console.log(`✓ ${name}: ${st.email ?? "logged in"}${st.org ? ` (${st.org})` : ""}`);
    return 0;
  }
  if (!st?.url) throw new UserError(`could not start the login for "${name}"${st?.error ? `: ${st.error}` : ""}.`);
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "waiting_for_code", url: st.url, next: `j2c login ${name} --code <code>` }));
    return 0;
  }
  console.log(`Login for "${name}" is waiting.

1. Open this link and sign in with the account you want for "${name}":
   ${st.url}
2. Copy the code shown at the end of the login.
3. Run: j2c login ${name} --code <code>

The code only works for this login and expires in a few minutes.`);
  return 0;
}

export function cancelLogin(name: string): number {
  const st = readJson<LoginState | null>(stateFile(name), null);
  if (st?.pid && alive(st.pid)) {
    try {
      process.kill(st.pid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 5_000;
    while (alive(st.pid) && Date.now() < deadline) sleepSync(100);
  }
  fs.rmSync(stateFile(name), { force: true });
  fs.rmSync(codeFile(name), { force: true });
  console.log(`No login is waiting for "${name}" anymore.`);
  return 0;
}

export function submitCode(name: string, code: string, json: boolean): number {
  claudeProfile(name);
  const st = readJson<LoginState | null>(stateFile(name), null);
  if (!st || st.status !== "waiting" || !alive(st.pid))
    throw new UserError(`no login is waiting for "${name}". Start one with: j2c login ${name} --start`);
  fs.writeFileSync(codeFile(name), code.trim() + "\n", { mode: 0o600 });
  const deadline = Date.now() + 90_000;
  let cur: LoginState | null = st;
  while (Date.now() < deadline) {
    sleepSync(250);
    cur = readJson<LoginState | null>(stateFile(name), null);
    if (cur?.status === "done" || cur?.status === "failed") break;
  }
  fs.rmSync(codeFile(name), { force: true });
  if (cur?.status !== "done") {
    const msg = cur?.status === "failed" ? cur.error ?? "login failed" : "timed out waiting for the login to finish";
    if (json) console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "failed", error: msg }));
    else console.error(`Login for "${name}" failed: ${msg}. Start again with: j2c login ${name} --start`);
    return 1;
  }
  const warnings = (cur as LoginState & { warnings?: string[] }).warnings ?? [];
  if (json) console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "logged_in", email: cur.email ?? null, org: cur.org ?? null, warnings }));
  else {
    console.log(`✓ ${name}: ${cur.email ?? "logged in"}${cur.org ? ` (${cur.org})` : ""}`);
    for (const w of warnings) console.log(`! ${w}`);
  }
  fs.rmSync(stateFile(name), { force: true });
  return 0;
}

export async function loginWorker(name: string, email: string | undefined): Promise<void> {
  const p = claudeProfile(name);
  const before = readIdentity(p);
  const set = (s: Partial<LoginState> & { warnings?: string[] }) =>
    writeJson(stateFile(name), { ...readJson<LoginState>(stateFile(name), { status: "starting", startedAt: Date.now() }), ...s });
  const child = spawn(claudeBin(), ["auth", "login", ...(email ? ["--email", email] : [])], {
    env: { ...loginEnv(p), BROWSER: process.env.J2C_BROWSER ?? "true" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let url: string | undefined;
  const onData = (d: Buffer) => {
    out += d.toString();
    if (!url) {
      const m = out.match(/https:\/\/\S+/);
      if (m) {
        url = m[0];
        set({ status: "waiting", url, pid: process.pid });
      }
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const exited = new Promise<number>((res) => child.on("exit", (c) => res(c ?? 1)));
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
    process.on(sig, () => {
      child.kill("SIGTERM");
      set({ status: "failed", error: "login cancelled" });
      process.exit(1);
    });
  const deadline = Date.now() + WAIT_FOR_CODE_MS;
  let sent = false;
  let code = -1;
  for (;;) {
    const done = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 300))]);
    if (done !== null) {
      code = done;
      break;
    }
    if (!sent && fs.existsSync(codeFile(name))) {
      child.stdin.write(fs.readFileSync(codeFile(name), "utf8"));
      child.stdin.end();
      sent = true;
    }
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      set({ status: "failed", error: "no code received within 15 minutes" });
      return;
    }
  }
  if (code !== 0) {
    const tail = out.replace(/https:\/\/\S+/g, "").trim().split("\n").filter(Boolean).slice(-2).join(" ");
    set({ status: "failed", error: tail || `claude auth login exited with ${code}` });
    log(`login ${name} failed: ${tail}`);
    return;
  }
  const r = recordLogin(name, before);
  set({ status: "done", email: r.email, org: r.org, warnings: r.warnings });
}
