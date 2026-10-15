import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BIN, sandbox, withAccounts } from "./helpers.mjs";

const starts = (sb) => sb.events().filter((e) => e.event === "start");

test("hard limit: the session moves to the next account and resumes the same conversation", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on"]);
    const plan = { main: ["turn:50", "limit", "wait"], work: ["turn:10", "exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    const [a, b] = starts(sb);
    assert.equal(a.profile, "main");
    assert.equal(a.autoContinue, false, "#7 built-in wait-at-limit disabled");
    assert.equal(b.profile, "work");
    assert.equal(b.resumed, true);
    assert.equal(b.sessionId, a.sessionId, "same conversation");
    assert.equal(b.cwd, a.cwd, "#13 resumed from the same folder");
    assert.match(b.prompt, /\[julius2claude\].*cut off/, "#13 told to verify the cut-off turn");
    assert.ok(sb.events().some((e) => e.event === "sigint" && e.profile === "main"), "#20 stopped gracefully with Ctrl+C first");
    assert.match(r.err, /main → work/);
    assert.equal(starts(sb).length, 2);
  } finally {
    sb.cleanup();
  }
});

test("proactive: crossing the threshold moves the session at the end of the turn, without injecting a prompt", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on", "--dwell", "0"]);
    const plan = { main: ["turn:97", "wait"], work: ["exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    const [, b] = starts(sb);
    assert.equal(b.profile, "work");
    assert.equal(b.resumed, true);
    assert.equal(b.prompt, null, "a finished turn is not 'continued' behind the user's back");
  } finally {
    sb.cleanup();
  }
});

test("auto-switch off: a limit never moves anything", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    const plan = { main: ["turn:99", "limit", "exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    assert.equal(starts(sb).length, 1);
    assert.ok(!sb.events().some((e) => e.event === "sigint"));
  } finally {
    sb.cleanup();
  }
});

test("#13 a running background subagent delays a proactive switch until it finishes", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on", "--dwell", "0"]);
    const plan = { main: ["subagent", "turn:97", "sleep:1500", "subagent-done", "turn:97", "wait"], work: ["exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    const ev = sb.events();
    const sigintAt = ev.findIndex((e) => e.event === "sigint");
    const lines = ev.slice(0, sigintAt).filter((e) => e.event === "statusline");
    assert.equal(lines.length, 2, "not stopped after the first turn while the subagent ran");
  } finally {
    sb.cleanup();
  }
});

test("#20/#6 a claude that ignores Ctrl+C is escalated to SIGTERM, and fully gone before resuming", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on"]);
    const plan = { main: ["stubborn", "limit", "wait"], work: ["exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    const ev = sb.events();
    assert.equal(ev.filter((e) => e.event === "sigint").length, 2);
    const termIdx = ev.findIndex((e) => e.event === "sigterm");
    const workIdx = ev.findIndex((e) => e.event === "start" && e.profile === "work");
    assert.ok(termIdx !== -1 && termIdx < workIdx, "old process ended before the new one started");
  } finally {
    sb.cleanup();
  }
});

test("#15 every account exhausted: wait for the soonest reset, then resume (no busy loop, no crash)", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    sb.j2c(["auto", "on"]);
    const plan = { "main#0": ["turn:10", "limit:five_hour:2", "wait"], "main#1": ["exit"] };
    const t0 = Date.now();
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /every eligible account is at its limit/);
    const [a, b] = starts(sb);
    assert.equal(b.profile, "main");
    assert.equal(b.sessionId, a.sessionId);
    assert.ok(Date.now() - t0 >= 2000);
  } finally {
    sb.cleanup();
  }
});

test("/j2c:use inside a session moves it at the end of that reply", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    const plan = { main: ["j2c:use work --from-session", "turn:10", "wait"], work: ["exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    const said = sb.events().find((e) => e.event === "j2c");
    assert.match(said.out, /moving this session to "work"/);
    const [a, b] = starts(sb);
    assert.equal(b.profile, "work");
    assert.equal(b.sessionId, a.sessionId);
  } finally {
    sb.cleanup();
  }
});

test("#16 an API key in the shell never reaches claude", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    await sb.j2cAsync([], { ANTHROPIC_API_KEY: "sk-ant-leak", FAKE_PLAN: JSON.stringify({ main: ["exit"] }) });
    assert.equal(starts(sb)[0].leakedKey, null);
  } finally {
    sb.cleanup();
  }
});

test("strict binding: refuses to start the wrong account in a company folder", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["bind", "work", ".", "--strict"]);
    const r = sb.j2c(["-P", "main"], { FAKE_PLAN: JSON.stringify({ main: ["exit"] }) });
    assert.notEqual(r.code, 0);
    assert.match(r.err, /not allowed here/);
    assert.equal(starts(sb).length, 0);
  } finally {
    sb.cleanup();
  }
});

test("bound folder starts on its account automatically", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["bind", "work"]);
    await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify({ work: ["exit"] }) });
    assert.equal(starts(sb)[0].profile, "work");
  } finally {
    sb.cleanup();
  }
});

test("crash mid-reply (WSL killed): `j2c recover` finds it and resumes it in the right folder and account", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["use", "work"]);
    const plan = { "work#0": ["busy", "crash"], "work#1": ["exit"] };
    const r1 = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r1.code, 137);
    const list = sb.j2c(["recover"], {}, { cwd: sb.root });
    assert.match(list.out, /work .*repo/);
    const r2 = await sb.j2cAsync(["recover", "1"], { FAKE_PLAN: JSON.stringify(plan) }, { cwd: sb.root });
    assert.equal(r2.code, 0, r2.err);
    const [a, b] = starts(sb);
    assert.equal(b.sessionId, a.sessionId);
    assert.equal(b.cwd, a.cwd);
    assert.equal(b.profile, "work");
    assert.match(b.prompt, /interrupted/);
    assert.match(sb.j2c(["recover"]).out, /No interrupted sessions/);
  } finally {
    sb.cleanup();
  }
});

test("status --json is stable for integrations", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    const j = JSON.parse(sb.j2c(["status", "--json"]).out);
    assert.equal(j.schemaVersion, 1);
    assert.deepEqual(j.profiles.map((p) => [p.name, p.account, p.login]), [["main", "me@personal.dev", "ok"], ["work", "me@work.dev", "ok"]]);
  } finally {
    sb.cleanup();
  }
});

test("agent login: --start prints a link, --code finishes it and records the account", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    sb.j2c(["add", "work", "--no-login"]);
    const env = { FAKE_INTERACTIVE_LOGIN: "1", FAKE_ACCOUNT: "me@company.com", FAKE_ORG: "Company" };
    const start = sb.j2c(["login", "work", "--start", "--json"], env);
    assert.equal(start.code, 0, start.err);
    const s = JSON.parse(start.out);
    assert.equal(s.status, "waiting_for_code");
    assert.match(s.url, /^https:\/\/claude\.example\/oauth/);
    const bad = sb.j2c(["login", "work", "--code", "nope", "--json"], env);
    assert.equal(bad.code, 1);
    assert.equal(JSON.parse(bad.out).status, "failed");
    sb.j2c(["login", "work", "--start"], env);
    const ok = sb.j2c(["login", "work", "--code", "good-code", "--json"], env);
    assert.equal(ok.code, 0, ok.err + ok.out);
    const r = JSON.parse(ok.out);
    assert.equal(r.status, "logged_in");
    assert.equal(r.email, "me@company.com");
    assert.equal(r.org, "Company");
    const st = JSON.parse(sb.j2c(["status", "--json"]).out);
    assert.deepEqual(st.profiles.find((p) => p.name === "work").login, "ok");
  } finally {
    sb.cleanup();
  }
});

test("agent login: `j2c add` run by an agent (no terminal) never hangs; it hands back the login link", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    const r = sb.j2c(["add", "work"], { FAKE_INTERACTIVE_LOGIN: "1" }, { timeout: 40_000 });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Open this link/);
    assert.match(r.out, /j2c login work --code/);
    sb.j2c(["login", "work", "--cancel"]);
  } finally {
    sb.cleanup();
  }
});

function loginPidsAlive(sb) {
  let pids = [];
  try {
    pids = fs.readFileSync(sb.env.FAKE_LOG + ".loginpids", "utf8").trim().split("\n").map(Number);
  } catch {}
  return pids.filter((p) => {
    try {
      process.kill(p, 0);
      return true;
    } catch {
      return false;
    }
  });
}

test("agent login: restarting or cancelling a login never leaves an orphaned `claude auth login` behind", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    sb.j2c(["add", "work", "--no-login"]);
    const env = { FAKE_INTERACTIVE_LOGIN: "1" };
    sb.j2c(["login", "work", "--start"], env);
    sb.j2c(["login", "work", "--start"], env);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(loginPidsAlive(sb).length, 1, "the first login was stopped when the second started");
    sb.j2c(["login", "work", "--cancel"]);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(loginPidsAlive(sb).length, 0, "cancel stops the waiting login");
    sb.j2c(["login", "work", "--start"], env);
    const ok = sb.j2c(["login", "work", "--code", "good-code", "--json"], env);
    assert.equal(JSON.parse(ok.out).status, "logged_in");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(loginPidsAlive(sb).length, 0);
  } finally {
    sb.cleanup();
  }
});

test("two terminals: when one hits the limit, the other moves at the end of its next reply without hitting it again", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on"]);
    const a = sb.j2cAsync([], { FAKE_ID: sb.env.FAKE_ID + "-a", FAKE_PLAN: JSON.stringify({ main: ["turn:10", "limit", "wait"], work: ["exit"] }) });
    const b = sb.j2cAsync([], { FAKE_ID: sb.env.FAKE_ID + "-b", FAKE_PLAN: JSON.stringify({ main: ["turn:10", "sleep:2500", "turn:20", "wait"], work: ["exit"] }) });
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra.code, 0, ra.err);
    assert.equal(rb.code, 0, rb.err);
    const starts = sb.events().filter((e) => e.event === "start");
    const mains = starts.filter((e) => e.profile === "main");
    const works = starts.filter((e) => e.profile === "work");
    assert.equal(mains.length, 2);
    assert.equal(works.length, 2, "both terminals moved to work");
    assert.deepEqual(new Set(works.map((w) => w.sessionId)), new Set(mains.map((m) => m.sessionId)), "each terminal kept its own conversation");
    for (const w of works) assert.equal(w.resumed, true);
    const limitTurns = sb.events().filter((e) => e.event === "statusline" && e.profile === "main").length;
    assert.equal(limitTurns, 3, "terminal B finished its reply on main and moved; it never sent a request that was refused");
  } finally {
    sb.cleanup();
  }
});

test("--no-binding lets one session use another account in a strictly bound folder", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["bind", "work", ".", "--strict"]);
    const r = await sb.j2cAsync(["-P", "main", "--no-binding"], { FAKE_PLAN: JSON.stringify({ main: ["exit"] }) });
    assert.equal(r.code, 0, r.err);
    assert.equal(sb.events().find((e) => e.event === "start").profile, "main");
  } finally {
    sb.cleanup();
  }
});

test("moving to an account in another organization is announced, in the terminal and in the status line", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    sb.j2c(["add", "corp"], { FAKE_ACCOUNT: "me@corp.com", FAKE_ORG: "Corp Inc" });
    sb.j2c(["auto", "on"]);
    const plan = { main: ["turn:10", "limit", "wait"], corp: ["turn:10", "exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /main → corp/);
    assert.match(r.err, /another organization \(Corp Inc\)\. Company isolation is off/);
    const line = sb.events().filter((e) => e.event === "statusline" && e.profile === "corp").pop();
    assert.match(line.out, /moved from main \(main: rate_limit\), other organization: Corp Inc/);
  } finally {
    sb.cleanup();
  }
});

test("auto mode survives a switch: the resumed session starts in the same permission mode", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on"]);
    const plan = { main: ["turn:10", "limit", "wait"], work: ["exit"] };
    const r = await sb.j2cAsync([], { FAKE_MODE: "auto", FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    const w = sb.events().find((e) => e.event === "start" && e.profile === "work");
    const i = w.args.indexOf("--permission-mode");
    assert.equal(w.args[i + 1], "auto");
    assert.equal(w.args[w.args.indexOf("--effort") + 1], "high");
  } finally {
    sb.cleanup();
  }
});

test("j2c usage draws a bar per window, the reset time and which account is blocked", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on"]);
    const plan = { main: ["turn:62", "limit", "wait"], work: ["turn:10", "exit"] };
    await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    const out = sb.j2c(["usage", "--plain"]).out;
    assert.match(out, /auto-switch on · order main → work/);
    assert.match(out, /5h\s+█{15}░{9}\s+62%\s+resets/);
    assert.match(out, /blocked: 5-hour limit reached · back/);
    assert.match(out, /work .*\n\s+5h\s+█{2}░{22}\s+10%/);
    assert.ok(!out.includes("\x1b["), "--plain has no color codes");
  } finally {
    sb.cleanup();
  }
});

test("interactive login in a terminal: c copies, o opens, and a pasted code finishes the login", { skip: process.platform !== "linux" }, async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, []);
    sb.j2c(["add", "work", "--no-login"]);
    const { spawn } = await import("node:child_process");
    const bin = path.join(sb.root, "bin");
    fs.mkdirSync(bin);
    for (const tool of ["clip.exe", "xclip", "wl-copy", "xsel", "explorer.exe", "xdg-open", "wslview"])
      fs.writeFileSync(path.join(bin, tool), "#!/bin/sh\ncat > /dev/null 2>&1; echo \"$0 $*\" >> " + JSON.stringify(path.join(sb.root, "tools.log")) + "\n", { mode: 0o755 });
    const env = { ...process.env, ...sb.env, J2C_NO_CLIPBOARD: "", FAKE_INTERACTIVE_LOGIN: "1", PATH: bin + ":" + process.env.PATH };
    const child = spawn("script", ["-qfc", `${process.execPath} ${BIN} login work`, "/dev/null"], { cwd: sb.work, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const waitFor = async (re) => {
      for (let i = 0; i < 100 && !re.test(out); i++) await new Promise((r) => setTimeout(r, 100));
      assert.match(out, re);
    };
    await waitFor(/Keys: c = copy/);
    child.stdin.write("c");
    await waitFor(/link copied/);
    child.stdin.write("o");
    await waitFor(/opened in the browser/);
    child.stdin.write("good-code\r");
    await waitFor(/✓ work: /);
    child.stdin.end();
    await Promise.race([new Promise((r) => child.on("exit", r)), new Promise((r) => setTimeout(r, 3000))]);
    child.kill("SIGKILL");
    const tools = fs.readFileSync(path.join(sb.root, "tools.log"), "utf8");
    assert.match(tools, /(clip\.exe|xclip|wl-copy|xsel)/);
    assert.match(tools, /(explorer\.exe|wslview|xdg-open) https:\/\/claude\.example/);
  } finally {
    sb.cleanup();
  }
});

test("j2c rescue: closes a plain-claude session stuck at its limit and resumes it on the next account, telling it which agents were cut", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    const { spawn } = await import("node:child_process");
    const sid = "11111111-2222-3333-4444-555555555555";
    const proj = path.join(sb.env.J2C_CLAUDE_DIR, "projects", sb.work.replace(/[^a-zA-Z0-9]/g, "-"));
    fs.mkdirSync(path.join(proj, sid, "subagents"), { recursive: true });
    const t = new Date().toISOString();
    const refusal = { type: "assistant", sessionId: sid, cwd: sb.work, timestamp: t, isApiErrorMessage: true, error: "rate_limit", quotaLimits: { status: "rejected", rateLimitType: "seven_day", resetsAt: Math.floor(Date.now() / 1000) + 86400 }, message: { content: [{ type: "text", text: "You've hit your weekly limit" }] } };
    fs.writeFileSync(path.join(proj, `${sid}.jsonl`), JSON.stringify({ type: "user", sessionId: sid, cwd: sb.work, timestamp: t, message: { content: "go" } }) + "\n" + JSON.stringify(refusal) + "\n");
    fs.writeFileSync(path.join(proj, sid, "subagents", "agent-x.jsonl"), JSON.stringify({ ...refusal, isSidechain: true }) + "\n");
    fs.writeFileSync(path.join(proj, sid, "subagents", "agent-x.meta.json"), JSON.stringify({ description: "Realtime collaboration" }));
    const stuck = spawn(process.execPath, ["-e", "process.on('SIGINT',()=>process.exit(0));setInterval(()=>{},1000)"], { stdio: "ignore" });
    fs.mkdirSync(path.join(sb.env.J2C_CLAUDE_DIR, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(sb.env.J2C_CLAUDE_DIR, "sessions", `${stuck.pid}.json`), JSON.stringify({ pid: stuck.pid, sessionId: sid, cwd: sb.work, kind: "interactive" }));

    const list = sb.j2c(["rescue", "--list"]);
    assert.match(list.out, /account main · weekly limit/);
    assert.match(list.out, /still open \(pid \d+\) · cut agents: Realtime collaboration/);

    const exited = new Promise((r) => stuck.on("exit", r));
    const r = await sb.j2cAsync(["rescue", "--yes", "--model", "sonnet"], { FAKE_PLAN: JSON.stringify({ work: ["exit"] }) });
    assert.equal(r.code, 0, r.err + r.out);
    await exited;
    const start = sb.events().find((e) => e.event === "start");
    assert.equal(start.profile, "work");
    assert.equal(start.sessionId, sid);
    assert.equal(fs.realpathSync(start.cwd), fs.realpathSync(sb.work));
    assert.equal(start.args[start.args.indexOf("--model") + 1], "sonnet");
    assert.match(start.prompt, /weekly limit on account "main" and was moved to "work"/);
    assert.match(start.prompt, /"Realtime collaboration"/);
    assert.match(start.prompt, /Use the sonnet model for everything, including agents/);
    const usage = JSON.parse(sb.j2c(["status", "--json"]).out).profiles.find((p) => p.name === "main");
    assert.equal(usage.usable, false, "main is recorded as blocked until its reset");
    assert.match(sb.j2c(["rescue"]).out, /No session is stuck/);
  } finally {
    sb.cleanup();
  }
});

test("j2c rescue ignores sessions whose limit already reset and sessions already supervised", () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    const proj = path.join(sb.env.J2C_CLAUDE_DIR, "projects", "p");
    fs.mkdirSync(proj, { recursive: true });
    const old = { type: "assistant", sessionId: "old", cwd: sb.work, timestamp: new Date().toISOString(), isApiErrorMessage: true, error: "rate_limit", quotaLimits: { status: "rejected", rateLimitType: "five_hour", resetsAt: Math.floor(Date.now() / 1000) - 60 } };
    fs.writeFileSync(path.join(proj, "old.jsonl"), JSON.stringify(old) + "\n");
    assert.match(sb.j2c(["rescue", "--all"]).out, /No session is stuck/);
  } finally {
    sb.cleanup();
  }
});

test("per-profile commands: claude-<profile> starts that profile, foreign commands are left alone, removal cleans up", { skip: process.platform === "win32" }, async () => {
  const sb = sandbox();
  try {
    const dir = sb.env.J2C_SHIM_DIR;
    fs.writeFileSync(path.join(dir, "j2c"), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "claude-other"), "#!/bin/sh\necho not ours\n", { mode: 0o755 });
    withAccounts(sb, ["work"]);
    sb.j2c(["add", "other", "--no-login"]);
    assert.ok(fs.existsSync(path.join(dir, "claude-main")));
    assert.ok(fs.existsSync(path.join(dir, "claude-work")));
    assert.equal(fs.readFileSync(path.join(dir, "claude-other"), "utf8"), "#!/bin/sh\necho not ours\n", "a command that is not ours is never overwritten");
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(path.join(dir, "claude-work"), [], { cwd: sb.work, env: { ...process.env, ...sb.env, FAKE_PLAN: JSON.stringify({ work: ["exit"] }) }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(sb.events().find((e) => e.event === "start").profile, "work");
    sb.j2c(["remove", "work"]);
    assert.ok(!fs.existsSync(path.join(dir, "claude-work")));
    assert.ok(fs.existsSync(path.join(dir, "claude-other")));
    sb.j2c(["shims", "--remove"]);
    assert.ok(!fs.existsSync(path.join(dir, "claude-main")));
    assert.ok(fs.existsSync(path.join(dir, "claude-other")));
  } finally {
    sb.cleanup();
  }
});

test("notifications: a switch notifies only when notifications are on", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on"]);
    const file = path.join(sb.root, "notes.jsonl");
    const plan = JSON.stringify({ main: ["turn:10", "limit", "wait"], work: ["exit"] });
    await sb.j2cAsync([], { J2C_NOTIFY_FILE: file, FAKE_PLAN: plan });
    assert.ok(!fs.existsSync(file), "off by default");
    sb.j2c(["notify", "on"]);
    fs.rmSync(path.join(sb.env.J2C_HOME, "state", "usage.json"), { force: true });
    await sb.j2cAsync([], { J2C_NOTIFY_FILE: file, FAKE_ID: sb.env.FAKE_ID + "-2", FAKE_PLAN: plan });
    const notes = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(notes.some((n) => /main → work/.test(n.title)), JSON.stringify(notes));
    assert.match(sb.j2c(["notify", "on", "--webhook", "http://insecure"]).err, /https/);
  } finally {
    sb.cleanup();
  }
});
