import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { lib, sandbox, withAccounts, ROOT } from "./helpers.mjs";

const { writeJson, readJson, updateJson } = await lib("store");
const profiles = await lib("profiles");
const router = await lib("router");
const usage = await lib("usage");
const config = await lib("config");
const runs = await lib("runs");
const hooks = await lib("hooks");
const sup = await lib("supervisor");

const now = () => Math.floor(Date.now() / 1000);

test("#1 credentials are never copied between profiles", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    const main = fs.readFileSync(path.join(sb.env.J2C_CLAUDE_DIR, ".credentials.json"), "utf8");
    const work = fs.readFileSync(path.join(sb.env.J2C_HOME, "profiles/work/.credentials.json"), "utf8");
    assert.notEqual(main, work);
    assert.ok(!fs.lstatSync(path.join(sb.env.J2C_HOME, "profiles/work/.credentials.json")).isSymbolicLink());
    const wj = JSON.parse(fs.readFileSync(path.join(sb.env.J2C_HOME, "profiles/work/.claude.json"), "utf8"));
    assert.equal(wj.oauthAccount.emailAddress, "me@work.dev", "work profile has its own identity");
  } finally {
    sb.cleanup();
  }
});

test("#2 status/doctor never spawn claude auth commands (they rotate tokens)", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    fs.writeFileSync(sb.env.FAKE_LOG, "");
    sb.j2c(["status"]);
    sb.j2c(["status", "--json"]);
    sb.j2c(["doctor"]);
    assert.deepEqual(sb.events().filter((e) => e.event === "login" || e.event === "start"), []);
  } finally {
    sb.cleanup();
  }
});

test("#1/#3 login state comes from files: zeroed token = needs login, expired access token = fine", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const dir = path.join(sb.root, "p");
    fs.mkdirSync(dir);
    const p = { name: "p", provider: "claude", configDir: dir };
    const write = (o) => fs.writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: o }));
    write({ refreshToken: "r", expiresAt: Date.now() - 1000, refreshTokenExpiresAt: Date.now() + 1e9 });
    assert.equal(profiles.loginState(p), process.platform === "darwin" ? "ok" : "ok");
    write({ refreshToken: "r", expiresAt: 0 });
    assert.equal(profiles.loginState(p), "needs-login");
    write({ refreshToken: "", expiresAt: Date.now() + 1000 });
    assert.equal(profiles.loginState(p), "needs-login");
  } finally {
    sb.cleanup();
  }
});

test("#7 Claude's built-in wait-at-limit is disabled only when auto-switch is on", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const cfg = config.emptyConfig();
    const run = { id: "r1", pid: process.pid, profile: "main", cwd: sb.work, busy: false, startedAt: Date.now() };
    let s = JSON.parse(fs.readFileSync(sup.writeRunSettings(cfg, run, cfg.profiles[0], []), "utf8"));
    assert.equal(s.autoContinueAtUsageLimit, undefined);
    cfg.autoSwitch.enabled = true;
    s = JSON.parse(fs.readFileSync(sup.writeRunSettings(cfg, run, cfg.profiles[0], []), "utf8"));
    assert.equal(s.autoContinueAtUsageLimit, false);
    assert.ok(s.hooks.StopFailure[0].hooks[0].command.includes("--run r1"), "run id is baked into the hook command, not env");
  } finally {
    sb.cleanup();
  }
});

test("#9 the real quota refusal (type + reset) is read from the transcript; older ones are ignored", () => {
  const sb = sandbox();
  try {
    const t = path.join(sb.root, "t.jsonl");
    const old = new Date(Date.now() - 60_000).toISOString();
    const fresh = new Date().toISOString();
    fs.writeFileSync(t, [
      JSON.stringify({ type: "assistant", timestamp: old, quotaLimits: { status: "rejected", rateLimitType: "seven_day", resetsAt: 111 } }),
      JSON.stringify({ type: "user", timestamp: fresh }),
    ].join("\n") + "\n");
    assert.equal(usage.findQuotaRefusal(t, Date.now() - 10_000), undefined, "refusal from before this process is history");
    fs.appendFileSync(t, JSON.stringify({ type: "assistant", timestamp: fresh, isApiErrorMessage: true, error: "rate_limit", quotaLimits: { status: "rejected", rateLimitType: "five_hour", resetsAt: 222 } }) + "\n");
    assert.deepEqual(usage.findQuotaRefusal(t, Date.now() - 10_000), { rateLimitType: "five_hour", resetsAt: 222, at: Date.parse(fresh) });
    fs.appendFileSync(t, JSON.stringify({ type: "assistant", timestamp: fresh, quotaLimits: { status: "allowed_warning" } }) + "\n");
    assert.equal(usage.findQuotaRefusal(t, Date.now() - 10_000)?.resetsAt, 222);
  } finally {
    sb.cleanup();
  }
});

async function hookSetup(sb, auto = true) {
  sb.activate();
  const cfg = config.emptyConfig();
  cfg.profiles.push({ name: "work", provider: "claude", configDir: path.join(sb.root, "w") });
  cfg.order.push("work");
  cfg.autoSwitch.enabled = auto;
  config.saveConfig(cfg);
  const t = path.join(sb.root, "s.jsonl");
  fs.writeFileSync(t, "");
  const run = { id: "run1", pid: process.pid, profile: "main", cwd: sb.work, busy: false, startedAt: Date.now() - 5000, childStartedAt: Date.now() - 5000 };
  runs.saveRun(run);
  await hooks.runHook("session-start", "run1", { session_id: "S", transcript_path: t });
  return t;
}

test("#9 StopFailure fires many times per limit: we act exactly once", async () => {
  const sb = sandbox();
  try {
    const t = await hookSetup(sb);
    fs.appendFileSync(t, JSON.stringify({ timestamp: new Date().toISOString(), quotaLimits: { status: "rejected", rateLimitType: "five_hour", resetsAt: now() + 3600 } }) + "\n");
    for (let i = 0; i < 14; i++) await hooks.runHook("stop-failure", "run1", { session_id: "S", error: "rate_limit", transcript_path: t });
    const u = usage.loadUsage();
    assert.equal(u.main.blocks.length, 1);
    assert.equal(u.main.blocks[0].type, "five_hour");
    assert.equal(runs.loadRun("run1").pendingSwitch.hard, true);
  } finally {
    sb.cleanup();
  }
});

test("#9 a 429 without a quota refusal is capacity, not your limit: no switch until it repeats", async () => {
  const sb = sandbox();
  try {
    const t = await hookSetup(sb);
    await hooks.runHook("stop-failure", "run1", { session_id: "S", error: "rate_limit", transcript_path: t });
    assert.equal(runs.loadRun("run1").pendingSwitch, undefined);
    for (let i = 0; i < 2; i++) {
      runs.mutateRun("run1", (r) => (r.lastFailureAt = 0));
      await hooks.runHook("stop-failure", "run1", { session_id: "S", error: "rate_limit", transcript_path: t });
    }
    assert.equal(runs.loadRun("run1").pendingSwitch?.hard, true);
  } finally {
    sb.cleanup();
  }
});

test("#9 a refusal inside a subagent transcript is found too", async () => {
  const sb = sandbox();
  try {
    const t = await hookSetup(sb);
    const sub = path.join(t.replace(/\.jsonl$/, ""), "subagents");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "agent-1.jsonl"), JSON.stringify({ timestamp: new Date().toISOString(), quotaLimits: { status: "rejected", rateLimitType: "seven_day_opus", resetsAt: now() + 99 } }) + "\n");
    await hooks.runHook("stop-failure", "run1", { session_id: "S", error: "rate_limit", transcript_path: t });
    assert.equal(usage.loadUsage().main.blocks[0].type, "seven_day_opus");
  } finally {
    sb.cleanup();
  }
});

test("#5 hooks ignore subagent events, foreign sessions and unknown runs", async () => {
  const sb = sandbox();
  try {
    await hookSetup(sb);
    await hooks.runHook("prompt", "run1", { session_id: "OTHER" });
    assert.equal(runs.loadRun("run1").busy, false, "a different session can't mark ours busy");
    await hooks.runHook("prompt", "run1", { session_id: "S", agent_id: "a" });
    assert.equal(runs.loadRun("run1").busy, false, "subagent prompt is not our turn");
    await hooks.runHook("prompt", "run1", { session_id: "S" });
    assert.equal(runs.loadRun("run1").busy, true);
    await hooks.runHook("stop", "run1", { session_id: "S", agent_id: "a" });
    assert.equal(runs.loadRun("run1").busy, true, "a subagent stopping doesn't end our turn");
    await hooks.runHook("stop", "nope", { session_id: "S" });
    await hooks.runHook("stop", undefined, { session_id: "S" });
    assert.equal(runs.loadRun("run1").busy, true, "hooks without our run id do nothing");
  } finally {
    sb.cleanup();
  }
});

test("auth errors block the account until the user fixes it", async () => {
  const sb = sandbox();
  try {
    await hookSetup(sb);
    await hooks.runHook("stop-failure", "run1", { session_id: "S", error: "authentication_failed" });
    const b = usage.loadUsage().main.blocks[0];
    assert.equal(b.until, 0);
    assert.equal(runs.loadRun("run1").pendingSwitch.hard, true);
  } finally {
    sb.cleanup();
  }
});

test("auto-switch off: limits are recorded but nothing moves", async () => {
  const sb = sandbox();
  try {
    const t = await hookSetup(sb, false);
    fs.appendFileSync(t, JSON.stringify({ timestamp: new Date().toISOString(), quotaLimits: { status: "rejected", rateLimitType: "five_hour", resetsAt: now() + 3600 } }) + "\n");
    await hooks.runHook("stop-failure", "run1", { session_id: "S", error: "rate_limit", transcript_path: t });
    assert.equal(usage.loadUsage().main.blocks.length, 1);
    assert.equal(runs.loadRun("run1").pendingSwitch, undefined);
  } finally {
    sb.cleanup();
  }
});

function rcfg(extra = []) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "j2c-r-"));
  const loggedIn = (name) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: { refreshToken: "r", expiresAt: Date.now() + 1e6 } }));
    return dir;
  };
  const cfg = config.emptyConfig();
  cfg.profiles[0].configDir = loggedIn("main");
  cfg.autoSwitch.enabled = true;
  for (const p of extra) {
    cfg.profiles.push({ configDir: loggedIn(p.name), ...p });
    cfg.order.push(p.name);
  }
  return cfg;
}

test("#10 absent usage means unknown, not 0%; a window past its reset counts as 0%", () => {
  assert.equal(usage.livePct(undefined), undefined);
  assert.equal(usage.livePct({ pct: 99, resetsAt: now() - 1 }), 0);
  assert.equal(usage.livePct({ pct: 99, resetsAt: now() + 60 }), 99);
});

test("#23 same bar to leave and to enter: no flapping between two accounts near the limit", () => {
  const cfg = rcfg([{ name: "work", provider: "claude" }]);
  const u = { main: { fiveHour: { pct: 96, resetsAt: now() + 100 } }, work: { fiveHour: { pct: 95.5, resetsAt: now() + 100 } } };
  const p = router.pickNext(cfg, u, cfg.profiles[0], "/x");
  assert.equal(p.profile, undefined, "work is just as full: don't move");
  assert.equal(p.waitUntil, now() + 100);
});

test("#23 minimum dwell: a proactive switch waits, a hard refusal does not", () => {
  const cfg = rcfg([{ name: "work", provider: "claude" }]);
  const u = { main: { fiveHour: { pct: 97, resetsAt: now() + 100 }, enteredAt: Date.now() - 60_000 } };
  assert.equal(router.shouldLeave(cfg, u, cfg.profiles[0], false), false);
  assert.equal(router.shouldLeave(cfg, u, cfg.profiles[0], true), true);
  u.main.enteredAt = Date.now() - 11 * 60_000;
  assert.equal(router.shouldLeave(cfg, u, cfg.profiles[0], false), true);
});

test("#22 data groups: a session never moves onto an account from another group", () => {
  const cfg = rcfg([{ name: "corp", provider: "claude", group: "work" }, { name: "alt", provider: "claude" }]);
  assert.equal(router.pickNext(cfg, {}, cfg.profiles[0], "/x").profile.name, "alt");
  cfg.profiles = cfg.profiles.filter((p) => p.name !== "alt");
  assert.equal(router.pickNext(cfg, {}, cfg.profiles[0], "/x").profile, undefined);
});

test("#8 pay-per-token profiles are never used automatically unless allowed", () => {
  const cfg = rcfg([{ name: "aws", provider: "bedrock" }]);
  assert.equal(router.pickNext(cfg, {}, cfg.profiles[0], "/x").profile, undefined);
  cfg.autoSwitch.allowPaid = true;
  assert.equal(router.pickNext(cfg, {}, cfg.profiles[0], "/x").profile.name, "aws");
});

test("strict binding: only the bound account may run in that folder (and below)", () => {
  const cfg = rcfg([{ name: "corp", provider: "claude" }]);
  cfg.bindings.push({ dir: "/repos/company", profile: "corp", strict: true });
  assert.deepEqual(router.allowedIn(cfg, "/repos/company/api").map((p) => p.name), ["corp"]);
  assert.deepEqual(router.allowedIn(cfg, "/repos/companyx").map((p) => p.name), ["main", "corp"]);
  assert.equal(router.pickStart(cfg, {}, "/repos/company/api").profile.name, "corp");
  assert.ok(router.pickStart(cfg, {}, "/repos/company", "main").reason);
});

test("#15 all accounts exhausted: report the soonest reset", () => {
  const cfg = rcfg([{ name: "a", provider: "claude" }, { name: "b", provider: "claude" }]);
  const u = {
    main: { blocks: [{ until: now() + 900, reason: "x" }] },
    a: { blocks: [{ until: now() + 300, reason: "x" }] },
    b: { sevenDay: { pct: 100, resetsAt: now() + 5000 } },
  };
  const p = router.pickNext(cfg, u, cfg.profiles[0], "/x");
  assert.equal(p.profile, undefined);
  assert.equal(p.waitUntil, now() + 300);
});

test("#13 switch only at a turn boundary; proactive switches wait for subagents and never fire late", () => {
  const base = { id: "r", pid: 1, profile: "main", cwd: "/", startedAt: 0 };
  const t = Date.now();
  const ready = (r) => sup.readyToSwitch({ ...base, ...r }, undefined, t);
  assert.equal(ready({ busy: true, lastStopAt: t, pendingSwitch: { requestedAt: t - 10, hard: true } }), false, "mid-turn: never");
  assert.equal(ready({ busy: false, lastStopAt: t - 20, pendingSwitch: { requestedAt: t - 10, hard: true } }), false, "turn ended before the request");
  assert.equal(ready({ busy: false, lastStopAt: t - 5, pendingSwitch: { requestedAt: t - 10, hard: true } }), true);
  assert.equal(ready({ busy: false, lastStopAt: t - 5, pendingSwitch: { requestedAt: t - 10, hard: false }, agents: ["a"] }), false, "background subagent running");
  assert.equal(ready({ busy: false, lastStopAt: t - 10_000, pendingSwitch: { requestedAt: t - 20_000, hard: false } }), false, "user may be typing: wait for next turn end");
  assert.equal(ready({ busy: false, lastStopAt: t - 5, pendingSwitch: { requestedAt: t - 10, hard: false } }), true);
});

test("#16 auth env from the shell never overrides a profile", () => {
  const p = { name: "work", provider: "claude", configDir: "/p/work" };
  const run = { id: "r", pid: 1, profile: "work", cwd: "/", busy: false, startedAt: 0 };
  const env = sup.buildEnv(p, run, false, { ANTHROPIC_API_KEY: "sk-leak", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CONFIG_DIR: "/other", PATH: "/bin" });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, "/p/work");
  assert.equal(env.PATH, "/bin");
  const main = sup.buildEnv({ name: "main", provider: "claude", configDir: "/h/.claude", isMain: true }, run, false, { CLAUDE_CONFIG_DIR: "/other" });
  assert.equal(main.CLAUDE_CONFIG_DIR, undefined, "main runs on the default dir");
  const aws = sup.buildEnv({ name: "aws", provider: "bedrock", configDir: "/p/aws", env: { CLAUDE_CODE_USE_BEDROCK: "1", AWS_PROFILE: "dev" } }, run, false, {});
  assert.equal(aws.CLAUDE_CODE_USE_BEDROCK, "1");
  assert.equal(aws.AWS_PROFILE, "dev");
});

test("#16 profile settings: provider env never leaks from main; profile-owned settings survive syncs", () => {
  const main = { env: { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_API_KEY: "x", FOO: "1" }, permissions: { allow: ["Bash(ls)"] }, apiKeyHelper: "main-helper" };
  const existing = { env: { AWS_PROFILE: "dev", CLAUDE_CODE_USE_BEDROCK: "1" }, awsAuthRefresh: "aws sso login" };
  const out = profiles.buildProfileSettings(main, existing, { name: "aws", provider: "bedrock", configDir: "/x", env: { AWS_REGION: "us-east-1" } });
  assert.deepEqual(out.env, { FOO: "1", AWS_PROFILE: "dev", CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1" });
  assert.equal(out.awsAuthRefresh, "aws sso login");
  assert.equal(out.apiKeyHelper, undefined, "main's API key helper doesn't follow into other profiles");
  assert.deepEqual(out.permissions, main.permissions);
  const claudeP = profiles.buildProfileSettings(main, {}, { name: "w", provider: "claude", configDir: "/x" });
  assert.deepEqual(claudeP.env, { FOO: "1" });
});

test("#17 only directories are linked; files are copied (atomic renames would detach a file link)", () => {
  const sb = sandbox();
  sb.activate();
  try {
    fs.writeFileSync(path.join(sb.env.J2C_CLAUDE_DIR, "CLAUDE.md"), "# rules");
    fs.writeFileSync(sb.env.J2C_CLAUDE_JSON, JSON.stringify({ oauthAccount: { emailAddress: "main@x" }, userID: "u", mcpServers: { a: {} }, hasCompletedOnboarding: true }));
    const p = { name: "w", provider: "claude", configDir: path.join(sb.root, "w") };
    profiles.ensureProfileDir(p);
    for (const e of fs.readdirSync(p.configDir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) assert.ok(fs.statSync(path.join(p.configDir, e.name)).isDirectory(), `${e.name} link must be a directory`);
    }
    assert.ok(fs.lstatSync(path.join(p.configDir, "projects")).isSymbolicLink());
    assert.ok(fs.lstatSync(path.join(p.configDir, "CLAUDE.md")).isFile());
    const cj = JSON.parse(fs.readFileSync(path.join(p.configDir, ".claude.json"), "utf8"));
    assert.equal(cj.oauthAccount, undefined, "main identity is never copied");
    assert.equal(cj.userID, undefined);
    assert.deepEqual(cj.mcpServers, { a: {} });
    assert.equal(cj.hasCompletedOnboarding, true);
  } finally {
    sb.cleanup();
  }
});

test("#18 linking over an existing history folder merges without losing anything", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const target = path.join(sb.root, "shared");
    const link = path.join(sb.root, "slot", "projects");
    fs.mkdirSync(path.join(target, "p1"), { recursive: true });
    fs.writeFileSync(path.join(target, "p1", "a.jsonl"), "A-shared");
    fs.mkdirSync(path.join(link, "p1"), { recursive: true });
    fs.writeFileSync(path.join(link, "p1", "a.jsonl"), "A-local");
    fs.writeFileSync(path.join(link, "p1", "b.jsonl"), "B");
    profiles.linkDir(target, link);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    const files = fs.readdirSync(path.join(target, "p1")).sort();
    assert.equal(files.length, 3);
    assert.equal(fs.readFileSync(path.join(target, "p1", "a.jsonl"), "utf8"), "A-shared");
    assert.equal(fs.readFileSync(path.join(target, "p1", "b.jsonl"), "utf8"), "B");
    assert.ok(files.some((f) => f.startsWith("a.jsonl.j2c-conflict-")));
    profiles.linkDir(target, link);
    assert.ok(fs.lstatSync(link).isSymbolicLink());
  } finally {
    sb.cleanup();
  }
});

test("#18 removing a profile with --purge never deletes shared history", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    const shared = path.join(sb.env.J2C_CLAUDE_DIR, "projects", "keep.txt");
    fs.writeFileSync(shared, "precious");
    const r = sb.j2c(["remove", "work", "--purge"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(shared, "utf8"), "precious");
    assert.ok(!fs.existsSync(path.join(sb.env.J2C_HOME, "profiles/work")));
  } finally {
    sb.cleanup();
  }
});

test("#22 groups keep company history apart from personal history", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    sb.j2c(["add", "corp", "--group", "work"], { FAKE_ACCOUNT: "me@corp.com" });
    const real = fs.realpathSync(path.join(sb.env.J2C_HOME, "profiles/corp/projects"));
    assert.equal(real, fs.realpathSync(path.join(sb.env.J2C_HOME, "groups/work/projects")));
    assert.ok(!real.startsWith(fs.realpathSync(sb.env.J2C_CLAUDE_DIR)), "company history is not inside the personal ~/.claude");
  } finally {
    sb.cleanup();
  }
});

test("secrets are refused in --env", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    const r = sb.j2c(["add", "api", "--env", "ANTHROPIC_API_KEY=sk-123", "--no-login"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /refusing to store/);
  } finally {
    sb.cleanup();
  }
});

test("state files survive concurrent writers (parallel sessions' hooks)", async () => {
  const sb = sandbox();
  try {
    const file = path.join(sb.root, "c.json");
    const script = `import(${JSON.stringify(path.join(ROOT, ".test-build/store.js"))}).then(m=>{for(let i=0;i<20;i++)m.updateJson(${JSON.stringify(file)},{n:0},c=>{c.n++})})`;
    await Promise.all(Array.from({ length: 6 }, () => new Promise((res) => spawn(process.execPath, ["-e", script]).on("exit", res))));
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).n, 120);
    assert.deepEqual(fs.readdirSync(sb.root).filter((f) => f.endsWith(".tmp") || f.endsWith(".lock")), []);
  } finally {
    sb.cleanup();
  }
});

test("#13 carried flags: model/permissions survive a switch; prompt and resume flags don't", () => {
  assert.deepEqual(
    sup.carryFlags(["--model", "opus", "-c", "do x", "--permission-mode=plan", "--add-dir", "../lib", "--dangerously-skip-permissions", "--resume", "abc"]),
    ["--model", "opus", "--permission-mode=plan", "--add-dir", "../lib", "--dangerously-skip-permissions"],
  );
});

test("recover lists sessions that died mid-reply, not ones that ended or are still running", () => {
  const sb = sandbox();
  sb.activate();
  try {
    runs.recordSession({ sessionId: "dead", state: "busy", profile: "main", cwd: sb.work, supervisorPid: 999999 });
    runs.recordSession({ sessionId: "ended", state: "ended", profile: "main", cwd: sb.work, supervisorPid: 999999 });
    runs.recordSession({ sessionId: "live", state: "busy", profile: "main", cwd: sb.work, supervisorPid: process.pid });
    runs.recordSession({ sessionId: "idle", state: "idle", profile: "main", cwd: sb.work, supervisorPid: 999999 });
    assert.deepEqual(runs.interruptedSessions().map((s) => s.sessionId), ["dead"]);
  } finally {
    sb.cleanup();
  }
});

test("a resumed session keeps the permission mode, effort and model it had before the switch", () => {
  assert.deepEqual(
    sup.liveFlags(["--model", "sonnet", "--permission-mode=plan", "--add-dir", "x"], { permissionMode: "auto", effort: "high", model: "claude-opus-5-5" }, true),
    ["--add-dir", "x", "--permission-mode", "auto", "--effort", "high", "--model", "claude-opus-5-5"],
  );
  assert.deepEqual(sup.liveFlags(["--model", "sonnet"], { model: "claude-opus-5-5" }, false), ["--model", "sonnet"], "model ids don't carry across providers");
  assert.deepEqual(sup.liveFlags([], { permissionMode: "default" }, true), []);
});
