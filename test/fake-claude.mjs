#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const env = process.env;
const logFile = env.FAKE_LOG;
const record = (o) => logFile && fs.appendFileSync(logFile, JSON.stringify(o) + "\n");
const configDir = env.CLAUDE_CONFIG_DIR || env.J2C_CLAUDE_DIR;
const claudeJson = env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json") : env.J2C_CLAUDE_JSON;

if (args[0] === "--version") {
  console.log(`${env.FAKE_VERSION || "2.1.290"} (Claude Code)`);
  process.exit(0);
}

if (args[0] === "auth" && args[1] === "login") {
  if (env.FAKE_INTERACTIVE_LOGIN === "1") {
    if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG + ".loginpids", process.pid + "\n");
    process.stdout.write("Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.example/oauth/authorize?code=true&state=abc\nPaste code here if prompted > ");
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.includes("\n")) break;
    }
    if (input.trim() !== "good-code") {
      console.error("OAuth error: Invalid code");
      process.exit(1);
    }
  }
  const email = env.FAKE_ACCOUNT || "someone@example.com";
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, ".credentials.json"), JSON.stringify({
    claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt: Date.now() + 8 * 3600e3, refreshTokenExpiresAt: Date.now() + 30 * 86400e3, subscriptionType: "max" },
  }));
  const j = fs.existsSync(claudeJson) ? JSON.parse(fs.readFileSync(claudeJson, "utf8")) : {};
  j.oauthAccount = { emailAddress: email, accountUuid: "uuid-" + email, organizationUuid: "org-" + email, organizationName: env.FAKE_ORG || "Personal" };
  fs.writeFileSync(claudeJson, JSON.stringify(j));
  record({ event: "login", email, configDir: env.CLAUDE_CONFIG_DIR ?? null });
  process.exit(0);
}

let settings = {};
const si = args.indexOf("--settings");
if (si !== -1) settings = JSON.parse(fs.readFileSync(args[si + 1], "utf8"));
const ri = args.indexOf("--resume");
const sessionId = ri !== -1 ? args[ri + 1] : crypto.randomUUID();
const slug = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
const transcript = path.join(configDir, "projects", slug, `${sessionId}.jsonl`);
fs.mkdirSync(path.dirname(transcript), { recursive: true });
const profile = env.J2C_PROFILE;
const leftover = ri !== -1 ? args.slice(ri + 2).filter((a) => !a.startsWith("--")) : [];

record({
  event: "start", pid: process.pid, profile, sessionId, cwd: process.cwd(), configDir: env.CLAUDE_CONFIG_DIR ?? null,
  resumed: ri !== -1, prompt: leftover[0] ?? null, args,
  leakedKey: env.ANTHROPIC_API_KEY ?? null, autoContinue: settings.autoContinueAtUsageLimit ?? null,
});

const base = { session_id: sessionId, transcript_path: transcript, cwd: process.cwd() };
function hook(event, extra = {}) {
  for (const group of settings.hooks?.[event] ?? []) {
    for (const h of group.hooks) {
      spawnSync(h.command, { shell: true, input: JSON.stringify({ ...base, hook_event_name: event, ...extra }), stdio: ["pipe", "ignore", "inherit"] });
    }
  }
}
function statusline(rl) {
  if (!settings.statusLine) return "";
  const r = spawnSync(settings.statusLine.command, { shell: true, input: JSON.stringify({ ...base, rate_limits: rl }), encoding: "utf8" });
  return r.stdout;
}
const append = (o) => fs.appendFileSync(transcript, JSON.stringify({ sessionId, timestamp: new Date().toISOString(), ...o }) + "\n");

let ignoreSigint = env.FAKE_IGNORE_SIGINT === "1";
process.on("SIGINT", () => {
  record({ event: "sigint", profile });
  if (!ignoreSigint) process.exit(0);
});
process.on("SIGTERM", () => {
  record({ event: "sigterm", profile });
  process.exit(143);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const plans = JSON.parse(env.FAKE_PLAN || "{}");
const counterFile = path.join(os.tmpdir(), `fake-claude-${env.FAKE_ID || "x"}-${profile}.n`);
const launchNo = Number(fs.existsSync(counterFile) ? fs.readFileSync(counterFile, "utf8") : 0);
fs.writeFileSync(counterFile, String(launchNo + 1));
const plan = (plans[`${profile}#${launchNo}`] ?? plans[profile] ?? ["exit"]);
const now = () => Math.floor(Date.now() / 1000);

hook("SessionStart", { source: ri !== -1 ? "resume" : "startup" });
for (const step of plan) {
  const [kind, arg, arg2] = step.split(":");
  if (kind === "turn") {
    hook("UserPromptSubmit", { prompt: "hi" });
    append({ type: "user", message: { role: "user", content: "hi" } });
    const mid = "msg_" + crypto.randomUUID();
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 };
    append({ type: "assistant", message: { id: mid, role: "assistant", usage, content: [{ type: "thinking", thinking: "" }] } });
    append({ type: "assistant", message: { id: mid, role: "assistant", usage, content: [{ type: "text", text: "ok" }] } });
    hook("Stop", {});
    const pct = Number(arg ?? 10);
    const out = statusline({ five_hour: { used_percentage: pct, resets_at: now() + 3600 }, seven_day: { used_percentage: 5, resets_at: now() + 86400 } });
    record({ event: "statusline", profile, out: out.trim() });
  } else if (kind === "limit") {
    hook("UserPromptSubmit", { prompt: "go" });
    append({
      type: "assistant", isApiErrorMessage: true, error: "rate_limit",
      quotaLimits: { status: "rejected", rateLimitType: arg || "five_hour", resetsAt: now() + Number(arg2 || 7200) },
      message: { role: "assistant", content: [{ type: "text", text: "You've hit your session limit" }] },
    });
    for (let i = 0; i < 3; i++) hook("StopFailure", { error: "rate_limit" });
  } else if (kind === "429") {
    hook("UserPromptSubmit", { prompt: "go" });
    hook("StopFailure", { error: "rate_limit" });
  } else if (kind === "authfail") {
    hook("StopFailure", { error: "authentication_failed" });
  } else if (kind === "subagent") {
    hook("SubagentStart", { agent_id: "ag1", agent_type: "Explore" });
  } else if (kind === "subagent-done") {
    hook("SubagentStop", { agent_id: "ag1", agent_type: "Explore" });
  } else if (kind === "nested-stop") {
    hook("Stop", { agent_id: "ag1" });
  } else if (kind === "j2c") {
    const r = spawnSync(env.J2C_NODE, [env.J2C_BIN, ...arg.split(" ")], { encoding: "utf8" });
    record({ event: "j2c", profile, out: (r.stdout + r.stderr).trim() });
  } else if (kind === "busy") {
    hook("UserPromptSubmit", { prompt: "long task" });
  } else if (kind === "stubborn") {
    ignoreSigint = true;
  } else if (kind === "sleep") {
    await sleep(Number(arg));
  } else if (kind === "wait") {
    await sleep(Number(arg || 30_000));
  } else if (kind === "exit") {
    hook("SessionEnd", { reason: "exit" });
    process.exit(Number(arg || 0));
  } else if (kind === "crash") {
    process.exit(137);
  }
}
hook("SessionEnd", { reason: "exit" });
process.exit(0);
