import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { lib, sandbox, withAccounts } from "./helpers.mjs";

const stats = await lib("stats");
const nowS = () => Math.floor(Date.now() / 1000);
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 };
const line = (id, extra = {}) => JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(), message: { id, usage }, ...extra }) + "\n";

test("tokens: one reply split over several transcript lines is counted once", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const t = path.join(sb.root, "s.jsonl");
    fs.writeFileSync(t, line("m1") + line("m1") + line("m1") + line("m2"));
    stats.ingestTranscript(t, "main");
    const total = stats.loadLedger().profiles.main.total;
    assert.deepEqual(total, { input: 20, output: 10, cacheRead: 200, cacheWrite: 40 });
  } finally {
    sb.cleanup();
  }
});

test("tokens: reading is incremental, a half-written last line waits, and the next ingest picks it up", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const t = path.join(sb.root, "s.jsonl");
    fs.writeFileSync(t, line("m1"));
    stats.ingestTranscript(t, "main");
    stats.ingestTranscript(t, "main");
    assert.equal(stats.loadLedger().profiles.main.total.input, 10, "same lines are never counted twice");
    const partial = line("m2");
    fs.appendFileSync(t, partial.slice(0, 20));
    stats.ingestTranscript(t, "main");
    assert.equal(stats.loadLedger().profiles.main.total.input, 10);
    fs.appendFileSync(t, partial.slice(20));
    stats.ingestTranscript(t, "main");
    assert.equal(stats.loadLedger().profiles.main.total.input, 20);
  } finally {
    sb.cleanup();
  }
});

test("tokens: subagent transcripts count, API error lines don't, and tokens go to the active account", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const t = path.join(sb.root, "s.jsonl");
    const sub = path.join(sb.root, "s", "subagents");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(t, line("m1") + line("err", { isApiErrorMessage: true }));
    fs.writeFileSync(path.join(sub, "agent-1.jsonl"), line("a1"));
    stats.ingestTranscript(t, "main");
    fs.appendFileSync(t, line("m3"));
    stats.ingestTranscript(t, "work");
    const l = stats.loadLedger();
    assert.equal(l.profiles.main.total.input, 20);
    assert.equal(l.profiles.work.total.input, 10);
  } finally {
    sb.cleanup();
  }
});

test("tokens: the same transcript reached through a profile's linked folder is not counted again", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const realDir = path.join(sb.root, "projects");
    fs.mkdirSync(realDir);
    fs.symlinkSync(realDir, path.join(sb.root, "linked"), "dir");
    fs.writeFileSync(path.join(realDir, "s.jsonl"), line("m1"));
    stats.ingestTranscript(path.join(realDir, "s.jsonl"), "main");
    fs.appendFileSync(path.join(realDir, "s.jsonl"), line("m2"));
    stats.ingestTranscript(path.join(sb.root, "linked", "s.jsonl"), "work");
    const l = stats.loadLedger();
    assert.equal(l.profiles.main.total.input, 10);
    assert.equal(l.profiles.work.total.input, 10);
  } finally {
    sb.cleanup();
  }
});

test("tokens: resuming an old conversation does not count its earlier history", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const t = path.join(sb.root, "s.jsonl");
    const old = JSON.stringify({ type: "assistant", timestamp: new Date(Date.now() - 3 * 86400e3).toISOString(), message: { id: "old", usage } }) + "\n";
    fs.writeFileSync(t, old + line("new"));
    stats.ingestTranscript(t, "main", Date.now() - 60_000);
    assert.equal(stats.loadLedger().profiles.main.total.input, 10);
  } finally {
    sb.cleanup();
  }
});

test("limit events: time to reach the limit is measured from the start of its window", () => {
  const sb = sandbox();
  sb.activate();
  try {
    const t = path.join(sb.root, "s.jsonl");
    fs.writeFileSync(t, line("m1"));
    stats.ingestTranscript(t, "main");
    const at = nowS();
    stats.recordEvent({ type: "limit", profile: "main", window: "five_hour", resetsAt: at + 2 * 3600, at });
    stats.recordEvent({ type: "limit", profile: "main", window: "five_hour", resetsAt: at + 4 * 3600, at });
    stats.recordEvent({ type: "limit", profile: "main", window: "seven_day", resetsAt: at + 2 * 86400, at });
    stats.recordEvent({ type: "switch", profile: "main", to: "work", reason: "x" });
    const [main, work] = stats.computeStats(["main", "work"]);
    assert.equal(main.limits.five_hour.count, 2);
    assert.equal(main.limits.five_hour.avgElapsedSec, 2 * 3600, "average of 3h and 1h");
    assert.equal(main.limits.five_hour.avgTokens, 135);
    assert.equal(main.limits.seven_day.avgElapsedSec, 5 * 86400);
    assert.equal(main.switchesOut, 1);
    assert.equal(work.switchesIn, 1);
    assert.equal(stats.sum(main.last5h), 135);
  } finally {
    sb.cleanup();
  }
});

test("formatting", () => {
  assert.equal(stats.fmtTokens(1_234_567), "1.2M");
  assert.equal(stats.fmtTokens(950), "950");
  assert.equal(stats.fmtDuration(3 * 3600 + 5 * 60), "3h 05m");
  assert.equal(stats.fmtDuration(4 * 86400 + 6 * 3600), "4d 6h");
});

test("stats end to end: tokens per account, the limit that was hit and the switch it caused", async () => {
  const sb = sandbox();
  try {
    withAccounts(sb, ["work"]);
    sb.j2c(["auto", "on"]);
    const plan = { main: ["turn:50", "turn:60", "limit", "wait"], work: ["turn:10", "exit"] };
    const r = await sb.j2cAsync([], { FAKE_PLAN: JSON.stringify(plan) });
    assert.equal(r.code, 0, r.err);
    const s = JSON.parse(sb.j2c(["stats", "--json"]).out);
    const main = s.profiles.find((p) => p.profile === "main");
    const work = s.profiles.find((p) => p.profile === "work");
    assert.equal(main.total.input, 200, "two replies on main, each counted once");
    assert.equal(work.total.input, 100);
    assert.equal(main.limits.five_hour.count, 1);
    assert.ok(Math.abs(main.limits.five_hour.avgElapsedSec - 3 * 3600) < 120, "fake limit resets in 2h, so it was hit 3h into the window");
    assert.equal(main.limits.five_hour.avgTokens, 2700);
    assert.equal(main.switchesOut, 1);
    assert.equal(work.switchesIn, 1);
    const text = sb.j2c(["stats"]).out;
    assert.match(text, /5-hour limit: reached 1 time, after 3h/);
  } finally {
    sb.cleanup();
  }
});
