#!/usr/bin/env node

import fs12 from "node:fs";
import path10 from "node:path";

import os from "node:os";
import path from "node:path";
function j2cHome() {
  return process.env.J2C_HOME || path.join(os.homedir(), ".julius2claude");
}
function defaultClaudeDir() {
  return process.env.J2C_CLAUDE_DIR || path.join(os.homedir(), ".claude");
}
function defaultClaudeJson() {
  return process.env.J2C_CLAUDE_JSON || path.join(os.homedir(), ".claude.json");
}
var paths = {
  config: () => path.join(j2cHome(), "config.json"),
  profilesDir: () => path.join(j2cHome(), "profiles"),
  profileDir: (name) => path.join(j2cHome(), "profiles", name),
  stateDir: () => path.join(j2cHome(), "state"),
  usage: () => path.join(j2cHome(), "state", "usage.json"),
  runsDir: () => path.join(j2cHome(), "state", "runs"),
  run: (id) => path.join(j2cHome(), "state", "runs", `${id}.json`),
  sessionsDir: () => path.join(j2cHome(), "state", "sessions"),
  session: (id) => path.join(j2cHome(), "state", "sessions", `${id}.json`),
  log: () => path.join(j2cHome(), "j2c.log")
};

import fs from "node:fs";
import path2 from "node:path";
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, data, mode = 384) {
  fs.mkdirSync(path2.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeFileSync(fd, JSON.stringify(data, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}
function updateJson(file, fallback, fn) {
  return withLock(file, () => {
    const cur = readJson(file, fallback);
    const next2 = fn(cur) ?? cur;
    writeJson(file, next2);
    return next2;
  });
}
var LOCK_STALE_MS = 1e4;
function withLock(target, fn) {
  const lock = `${target}.lock`;
  fs.mkdirSync(path2.dirname(lock), { recursive: true });
  const deadline = Date.now() + 5e3;
  for (; ; ) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      } catch {
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${lock}`);
      sleepSync(15);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function log(msg) {
  try {
    fs.mkdirSync(path2.dirname(paths.log()), { recursive: true });
    fs.appendFileSync(paths.log(), `${(new Date()).toISOString()} [${process.pid}] ${msg}
`);
  } catch {
  }
}

var PAID = new Set(["bedrock", "vertex", "foundry", "apikey"]);
function emptyConfig() {
  return {
    version: 1,
    profiles: [{ name: "main", provider: "claude", configDir: defaultClaudeDir(), isMain: true }],
    order: ["main"],
    active: "main",
    bindings: [],
    autoSwitch: { enabled: false, fiveHourPct: 95, weeklyPct: 98, allowPaid: false, minDwellMin: 10 }
  };
}
function loadConfig() {
  const cfg = readJson(paths.config(), null);
  if (!cfg) return emptyConfig();
  const base = emptyConfig();
  return { ...base, ...cfg, autoSwitch: { ...base.autoSwitch, ...cfg.autoSwitch } };
}
function saveConfig(cfg) {
  writeJson(paths.config(), cfg);
}
function mutateConfig(fn) {
  return updateJson(paths.config(), loadConfig(), (cur) => {
    const merged = { ...emptyConfig(), ...cur };
    fn(merged);
    return merged;
  });
}
function getProfile(cfg, name) {
  const p = cfg.profiles.find((x) => x.name === name);
  if (!p) throw new UserError(`unknown profile "${name}". Run \`j2c list\` to see your profiles.`);
  return p;
}
function ordered(cfg) {
  const rank = (n) => {
    const i = cfg.order.indexOf(n);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...cfg.profiles].sort((a, b) => rank(a.name) - rank(b.name));
}
var UserError = class extends Error {
};
function withoutBindings(cfg, skip) {
  return skip ? { ...cfg, bindings: [] } : cfg;
}
var NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

import fs6 from "node:fs";
import path6 from "node:path";

import path4 from "node:path";

import fs2 from "node:fs";
import path3 from "node:path";
var GROUP_DIRS = ["projects", "file-history", "todos", "tasks", "plans"];
var GLOBAL_DIRS = ["commands", "skills", "agents", "output-styles", "rules"];
var SYNCED_FILES = ["CLAUDE.md", "keybindings.json"];
var PROVIDER_ENV_KEYS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_BEDROCK_REGION_PREFIX",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "CLOUD_ML_REGION",
  "ANTHROPIC_FOUNDRY_RESOURCE",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL"
];
var PROFILE_OWNED_SETTINGS = ["awsAuthRefresh", "awsCredentialExport", "gcpAuthRefresh", "apiKeyHelper", "modelOverrides"];
var ACCOUNT_KEYS = ["oauthAccount", "userID", "primaryApiKey", "customApiKeyResponses", "s1mAccessCache", "passesEligibilityCache"];
function groupStore(group) {
  return !group || group === "default" ? defaultClaudeDir() : path3.join(j2cHome(), "groups", group);
}
function claudeJsonPath(p) {
  return p.isMain ? defaultClaudeJson() : path3.join(p.configDir, ".claude.json");
}
function ensureProfileDir(p) {
  if (p.isMain) return;
  fs2.mkdirSync(p.configDir, { recursive: true, mode: 448 });
  const store = groupStore(p.group);
  for (const d of GROUP_DIRS) linkDir(path3.join(store, d), path3.join(p.configDir, d));
  for (const d of GLOBAL_DIRS) linkDir(path3.join(defaultClaudeDir(), d), path3.join(p.configDir, d));
  for (const f of SYNCED_FILES) copyIfNewer(path3.join(defaultClaudeDir(), f), path3.join(p.configDir, f));
  syncSettings(p);
  seedClaudeJson(p);
}
function linkDir(target, link) {
  fs2.mkdirSync(target, { recursive: true });
  const resolvedTarget = fs2.realpathSync(target);
  let st;
  try {
    st = fs2.lstatSync(link);
  } catch {
  }
  if (st?.isSymbolicLink()) {
    let cur = "";
    try {
      cur = fs2.realpathSync(link);
    } catch {
    }
    if (cur === resolvedTarget) return;
    fs2.unlinkSync(link);
  } else if (st?.isDirectory()) {
    mergeInto(link, resolvedTarget);
    fs2.rmSync(link, { recursive: true, force: true });
  } else if (st) {
    fs2.renameSync(link, `${link}.j2c-backup-${Date.now()}`);
  }
  fs2.symlinkSync(resolvedTarget, link, process.platform === "win32" ? "junction" : "dir");
}
function mergeInto(src, dst) {
  for (const name of fs2.readdirSync(src)) {
    const from = path3.join(src, name);
    let to = path3.join(dst, name);
    const fromStat = fs2.lstatSync(from);
    if (fs2.existsSync(to)) {
      if (fromStat.isDirectory() && fs2.lstatSync(to).isDirectory()) {
        mergeInto(from, to);
        continue;
      }
      if (fromStat.isFile() && sameFile(from, to)) continue;
      to = `${to}.j2c-conflict-${Date.now()}`;
    }
    fs2.renameSync(from, to);
    log(`merged ${from} -> ${to}`);
  }
}
function sameFile(a, b) {
  try {
    return fs2.readFileSync(a).equals(fs2.readFileSync(b));
  } catch {
    return false;
  }
}
function copyIfNewer(src, dst) {
  try {
    const s = fs2.statSync(src);
    let d;
    try {
      d = fs2.lstatSync(dst);
    } catch {
    }
    if (d && d.mtimeMs >= s.mtimeMs) return;
    fs2.copyFileSync(src, dst);
  } catch {
  }
}
function buildProfileSettings(main2, existing, p) {
  const env = {};
  for (const [k, v] of Object.entries(main2.env ?? {})) if (!PROVIDER_ENV_KEYS.includes(k)) env[k] = v;
  for (const [k, v] of Object.entries(existing.env ?? {})) if (PROVIDER_ENV_KEYS.includes(k)) env[k] = v;
  Object.assign(env, p.env ?? {});
  const out = { ...main2 };
  for (const k of PROFILE_OWNED_SETTINGS) {
    if (k in existing) out[k] = existing[k];
    else delete out[k];
  }
  if (p.provider !== "claude" && "model" in existing) out.model = existing.model;
  if (Object.keys(env).length) out.env = env;
  else delete out.env;
  return out;
}
function syncSettings(p) {
  if (p.isMain) return;
  const main2 = readJson(path3.join(defaultClaudeDir(), "settings.json"), {});
  const file = path3.join(p.configDir, "settings.json");
  const existing = readJson(file, {});
  const next2 = buildProfileSettings(main2, existing, p);
  if (JSON.stringify(next2) !== JSON.stringify(existing)) writeJson(file, next2);
}
function seedClaudeJson(p) {
  if (p.isMain) return;
  const main2 = readJson(defaultClaudeJson(), {});
  const file = claudeJsonPath(p);
  const cur = readJson(file, null);
  let next2;
  if (!cur) {
    next2 = { ...main2 };
    for (const k of ACCOUNT_KEYS) delete next2[k];
  } else {
    next2 = { ...cur, mcpServers: { ...main2.mcpServers ?? {}, ...cur.mcpServers ?? {} } };
    const projects = { ...cur.projects ?? {} };
    for (const [dir, info] of Object.entries(main2.projects ?? {})) {
      projects[dir] = { ...projects[dir] ?? {} };
      if (info?.hasTrustDialogAccepted) projects[dir].hasTrustDialogAccepted = true;
      if (info?.mcpServers) projects[dir].mcpServers = { ...info.mcpServers, ...projects[dir].mcpServers ?? {} };
    }
    next2.projects = projects;
  }
  if (JSON.stringify(next2) !== JSON.stringify(cur)) writeJson(file, next2);
}
function readIdentity(p) {
  const j = readJson(claudeJsonPath(p), {});
  const a = j.oauthAccount ?? {};
  const creds = readCredentials(p);
  return {
    email: a.emailAddress,
    org: a.organizationName,
    orgUuid: a.organizationUuid,
    uuid: a.accountUuid,
    plan: creds?.subscriptionType ?? a.organizationType
  };
}
function readCredentials(p) {
  const c = readJson(path3.join(p.configDir, ".credentials.json"), null)?.claudeAiOauth;
  if (!c) return void 0;
  return {
    expiresAt: c.expiresAt,
    refreshTokenExpiresAt: c.refreshTokenExpiresAt,
    subscriptionType: c.subscriptionType,
    hasRefresh: typeof c.refreshToken === "string" && c.refreshToken.length > 0
  };
}
function loginState(p, now = Date.now()) {
  if (p.provider !== "claude") return "n/a";
  const c = readCredentials(p);
  if (!c) return process.platform === "darwin" ? "unknown" : "needs-login";
  if (!c.hasRefresh || c.expiresAt === 0) return "needs-login";
  if (c.refreshTokenExpiresAt && c.refreshTokenExpiresAt < now) return "needs-login";
  return "ok";
}

import fs3 from "node:fs";
var nowS = () => Math.floor(Date.now() / 1e3);
function loadUsage() {
  return readJson(paths.usage(), {});
}
function mutateUsage(fn) {
  return updateJson(paths.usage(), {}, (u) => {
    fn(u);
  });
}
function livePct(w, now = nowS()) {
  if (!w) return void 0;
  return w.resetsAt <= now ? 0 : w.pct;
}
function activeBlocks(u, now = nowS()) {
  return (u?.blocks ?? []).filter((b) => b.until === 0 || b.until > now);
}
function recordStatusline(profile, rateLimits) {
  if (!rateLimits || typeof rateLimits !== "object") return;
  const toWin = (w) => w && typeof w.used_percentage === "number" && typeof w.resets_at === "number" ? { pct: w.used_percentage, resetsAt: w.resets_at } : void 0;
  const five = toWin(rateLimits.five_hour);
  const seven = toWin(rateLimits.seven_day);
  if (!five && !seven) return;
  mutateUsage((u) => {
    const cur = u[profile] ??= {};
    if (five) cur.fiveHour = five;
    if (seven) cur.sevenDay = seven;
    cur.updatedAt = Date.now();
  });
}
function findQuotaRefusal(transcriptPath, sinceMs) {
  const tail = readTail(transcriptPath, 256 * 1024);
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"quotaLimits"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const q = o.quotaLimits;
    const at = Date.parse(o.timestamp ?? "") || 0;
    if (at && at < sinceMs) return void 0;
    if (q?.status === "rejected") return { rateLimitType: q.rateLimitType, resetsAt: q.resetsAt, at };
  }
  return void 0;
}
function readTail(file, bytes) {
  let fd;
  try {
    fd = fs3.openSync(file, "r");
    const size = fs3.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs3.readSync(fd, buf, 0, len, size - len);
    const s = buf.toString("utf8");
    return len < size ? s.slice(s.indexOf("\n") + 1) : s;
  } catch {
    return "";
  } finally {
    if (fd !== void 0) fs3.closeSync(fd);
  }
}

function usable(cfg, usage, p, now = nowS()) {
  const u = usage[p.name];
  const blocks = activeBlocks(u, now);
  if (blocks.length) {
    const hard = blocks.find((b) => b.until === 0);
    if (hard) return { ok: false, reason: hard.reason, availableAt: 0 };
    const until = Math.max(...blocks.map((b) => b.until));
    return { ok: false, reason: blocks[0].reason, availableAt: until };
  }
  if (loginState(p) === "needs-login") return { ok: false, reason: "needs login (run `j2c login " + p.name + "`)", availableAt: 0 };
  if (p.provider !== "claude") return { ok: true };
  const five = livePct(u?.fiveHour, now);
  const seven = livePct(u?.sevenDay, now);
  if (seven !== void 0 && seven >= cfg.autoSwitch.weeklyPct)
    return { ok: false, reason: `weekly at ${Math.round(seven)}%`, availableAt: u.sevenDay.resetsAt };
  if (five !== void 0 && five >= cfg.autoSwitch.fiveHourPct)
    return { ok: false, reason: `5h at ${Math.round(five)}%`, availableAt: u.fiveHour.resetsAt };
  return { ok: true };
}
function bindingFor(cfg, cwd) {
  const abs = path4.resolve(cwd);
  return cfg.bindings.filter((b) => abs === b.dir || abs.startsWith(b.dir.endsWith(path4.sep) ? b.dir : b.dir + path4.sep)).sort((a, b) => b.dir.length - a.dir.length)[0];
}
function allowedIn(cfg, cwd) {
  const b = bindingFor(cfg, cwd);
  if (b?.strict) return cfg.profiles.filter((p) => p.name === b.profile);
  return cfg.profiles;
}
function pickNext(cfg, usage, from, cwd, now = nowS()) {
  const group = from?.group ?? "default";
  const allowed = new Set(allowedIn(cfg, cwd).map((p) => p.name));
  const candidates = ordered(cfg).filter(
    (p) => p.name !== from?.name && allowed.has(p.name) && (p.group ?? "default") === group && (!PAID.has(p.provider) || cfg.autoSwitch.allowPaid)
  );
  let soonest = Infinity;
  for (const p of candidates) {
    const v = usable(cfg, usage, p, now);
    if (v.ok) return { profile: p };
    if (v.availableAt) soonest = Math.min(soonest, v.availableAt);
  }
  if (from) {
    const v = usable(cfg, usage, from, now);
    if (v.availableAt) soonest = Math.min(soonest, v.availableAt);
  }
  return {
    waitUntil: Number.isFinite(soonest) ? soonest : void 0,
    reason: candidates.length ? "every eligible account is at its limit" : "no other eligible account in this group"
  };
}
function shouldLeave(cfg, usage, p, hardRefused, now = nowS()) {
  if (hardRefused) return true;
  if (usable(cfg, usage, p, now).ok) return false;
  if (activeBlocks(usage[p.name], now).length) return true;
  const entered = usage[p.name]?.enteredAt ?? 0;
  return Date.now() - entered >= cfg.autoSwitch.minDwellMin * 6e4;
}
function pickStart(cfg, usage, cwd, explicit) {
  const allowed = allowedIn(cfg, cwd);
  if (explicit) {
    const p = allowed.find((x) => x.name === explicit);
    return p ? { profile: p } : { reason: `"${explicit}" is not allowed here (strict binding)` };
  }
  const b = bindingFor(cfg, cwd);
  const preferred = cfg.profiles.find((p) => p.name === (b?.profile ?? cfg.active)) ?? cfg.profiles[0];
  if (!cfg.autoSwitch.enabled || usable(cfg, usage, preferred).ok) return { profile: preferred, bound: !!b };
  const next2 = pickNext(cfg, usage, preferred, cwd);
  return next2.profile ? next2 : { profile: preferred, bound: !!b, ...next2 };
}

import fs4 from "node:fs";
var BOUNDARY_MS = 3e3;
function loadRun(id) {
  return readJson(paths.run(id), void 0);
}
function saveRun(run) {
  writeJson(paths.run(run.id), run);
}
function mutateRun(id, fn) {
  if (!fs4.existsSync(paths.run(id))) return void 0;
  return updateJson(paths.run(id), void 0, (r) => {
    if (r) fn(r);
  });
}
function removeRun(id) {
  fs4.rmSync(paths.run(id), { force: true });
}
function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function liveRuns() {
  let names = [];
  try {
    names = fs4.readdirSync(paths.runsDir()).filter((n) => n.endsWith(".json"));
  } catch {
  }
  return names.map((n) => loadRun(n.slice(0, -5))).filter((r) => !!r && alive(r.pid));
}
function recordSession(rec) {
  updateJson(paths.session(rec.sessionId), null, (cur) => ({
    ...cur ?? { profile: "?", cwd: process.cwd(), state: "idle" },
    ...rec,
    updatedAt: Date.now()
  }));
}
function interruptedSessions() {
  let names = [];
  try {
    names = fs4.readdirSync(paths.sessionsDir()).filter((n) => n.endsWith(".json"));
  } catch {
  }
  return names.map((n) => readJson(`${paths.sessionsDir()}/${n}`, null)).filter((s) => !!s && s.state === "busy" && !alive(s.supervisorPid)).sort((a, b) => b.updatedAt - a.updatedAt);
}

import fs5 from "node:fs";
import path5 from "node:path";
var WINDOW_SEC = {
  five_hour: 5 * 3600,
  seven_day: 7 * 86400,
  seven_day_opus: 7 * 86400,
  seven_day_sonnet: 7 * 86400,
  seven_day_overage_included: 7 * 86400
};
var HOUR = 3600;
var KEEP_HOURS_SEC = 35 * 86400;
var KEEP_FILES_MS = 30 * 864e5;
var ledgerFile = () => path5.join(paths.stateDir(), "tokens.json");
var eventsFile = () => path5.join(paths.stateDir(), "events.jsonl");
var zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
var sum = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;
function add(a, u) {
  a.input += u.input_tokens ?? 0;
  a.output += u.output_tokens ?? 0;
  a.cacheRead += u.cache_read_input_tokens ?? 0;
  a.cacheWrite += u.cache_creation_input_tokens ?? 0;
}
function emptyLedger() {
  return { version: 1, profiles: {}, files: {} };
}
function loadLedger() {
  return readJson(ledgerFile(), emptyLedger());
}
function readFrom(file, offset) {
  let fd;
  try {
    fd = fs5.openSync(file, "r");
    const size = fs5.fstatSync(fd).size;
    if (size < offset) offset = 0;
    if (size === offset) return { text: "", end: offset };
    const buf = Buffer.alloc(size - offset);
    fs5.readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(10);
    if (lastNl === -1) return { text: "", end: offset };
    return { text: buf.subarray(0, lastNl + 1).toString("utf8"), end: offset + lastNl + 1 };
  } catch {
    return void 0;
  } finally {
    if (fd !== void 0) fs5.closeSync(fd);
  }
}
function real(file) {
  try {
    return fs5.realpathSync(file);
  } catch {
    return file;
  }
}
function transcriptFiles(transcript) {
  const files = [real(transcript)];
  const sub = path5.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  try {
    for (const f of fs5.readdirSync(sub)) if (f.endsWith(".jsonl")) files.push(real(path5.join(sub, f)));
  } catch {
  }
  return files;
}
function ingestTranscript(transcript, profile, sinceMs = 0) {
  if (!transcript) return;
  updateJson(ledgerFile(), emptyLedger(), (l) => {
    const now = Date.now();
    const p = l.profiles[profile] ??= { total: zero(), hours: {} };
    for (const file of transcriptFiles(transcript)) {
      const isNew = !l.files[file];
      const cur = l.files[file] ?? { offset: 0, touchedAt: now };
      const chunk = readFrom(file, cur.offset);
      if (!chunk) continue;
      let lastId = cur.lastId;
      for (const line of chunk.text.split("\n")) {
        if (!line.includes('"usage"')) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        const msg = o.message;
        if (o.type !== "assistant" || !msg?.usage || o.isApiErrorMessage) continue;
        const at = Date.parse(o.timestamp ?? "") || now;
        if (isNew && at < sinceMs) continue;
        const id = msg.id ?? o.requestId;
        if (id && id === lastId) continue;
        lastId = id;
        add(p.total, msg.usage);
        const ts = Math.floor(at / 1e3);
        const hour = String(ts - ts % HOUR);
        add(p.hours[hour] ??= zero(), msg.usage);
      }
      l.files[file] = { offset: chunk.end, lastId, touchedAt: now };
    }
    const cutoff = Math.floor(now / 1e3) - KEEP_HOURS_SEC;
    for (const prof of Object.values(l.profiles))
      for (const h of Object.keys(prof.hours)) if (Number(h) < cutoff) delete prof.hours[h];
    for (const [f, c] of Object.entries(l.files)) if (now - c.touchedAt > KEEP_FILES_MS) delete l.files[f];
  });
}
function tokensBetween(l, profile, fromSec, toSec) {
  const t = zero();
  const hours = l.profiles[profile]?.hours ?? {};
  for (const [h, v] of Object.entries(hours)) {
    const start = Number(h);
    if (start + HOUR <= fromSec || start > toSec) continue;
    t.input += v.input;
    t.output += v.output;
    t.cacheRead += v.cacheRead;
    t.cacheWrite += v.cacheWrite;
  }
  return t;
}
function recordEvent(e) {
  const ev = { at: Math.floor(Date.now() / 1e3), ...e };
  if ((ev.type === "limit" || ev.type === "threshold") && ev.window && ev.resetsAt && WINDOW_SEC[ev.window]) {
    const start = ev.resetsAt - WINDOW_SEC[ev.window];
    ev.elapsedSec = Math.max(0, ev.at - start);
    ev.tokensInWindow = sum(tokensBetween(loadLedger(), ev.profile, start, ev.at));
  }
  fs5.mkdirSync(path5.dirname(eventsFile()), { recursive: true });
  fs5.appendFileSync(eventsFile(), JSON.stringify(ev) + "\n");
}
function loadEvents(sinceSec = 0) {
  let text = "";
  try {
    text = fs5.readFileSync(eventsFile(), "utf8");
  } catch {
  }
  return text.split("\n").filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return void 0;
    }
  }).filter((e) => !!e && e.at >= sinceSec);
}
function windowStats(events) {
  const by = {};
  for (const e of events) if (e.window) (by[e.window] ??= []).push(e);
  const out = {};
  for (const [w, list] of Object.entries(by)) {
    const el = list.map((e) => e.elapsedSec).filter((x) => typeof x === "number");
    const tk = list.map((e) => e.tokensInWindow).filter((x) => typeof x === "number" && x > 0);
    out[w] = {
      count: list.length,
      ...el.length ? { avgElapsedSec: Math.round(el.reduce((a, b) => a + b, 0) / el.length) } : {},
      ...tk.length ? { avgTokens: Math.round(tk.reduce((a, b) => a + b, 0) / tk.length) } : {}
    };
  }
  return out;
}
function computeStats(profiles, sinceSec = 0, nowSec = Math.floor(Date.now() / 1e3)) {
  const l = loadLedger();
  const events = loadEvents(sinceSec);
  return profiles.map((name) => {
    const mine = events.filter((e) => e.profile === name);
    return {
      profile: name,
      total: l.profiles[name]?.total ?? zero(),
      last5h: tokensBetween(l, name, nowSec - 5 * HOUR, nowSec),
      last7d: tokensBetween(l, name, nowSec - 7 * 86400, nowSec),
      limits: windowStats(mine.filter((e) => e.type === "limit")),
      thresholds: windowStats(mine.filter((e) => e.type === "threshold")),
      switchesOut: mine.filter((e) => e.type === "switch").length,
      switchesIn: events.filter((e) => e.type === "switch" && e.to === name).length
    };
  });
}
function fmtTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}
function fmtDuration(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor(sec % 86400 / 3600);
  const m = Math.floor(sec % 3600 / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

var HARD_ERRORS = {
  authentication_failed: "login failed (run `j2c login <profile>`)",
  oauth_org_not_allowed: "organization does not allow this login here",
  account_on_hold: "account on hold",
  billing_error: "billing problem on this account",
  verification_required: "account needs verification"
};
var TRANSIENT_WINDOW_MS = 10 * 6e4;
var TRANSIENT_LIMIT = 3;
async function readStdin() {
  if (process.stdin.isTTY) return {};
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
async function runHook(event, runId, input) {
  const data = input ?? await readStdin();
  if (!runId) return;
  const run = loadRun(runId);
  if (!run) return;
  if (event === "subagent-start" || event === "subagent-stop") {
    const id = data.agent_id;
    if (!id) return;
    mutateRun(runId, (r) => {
      const set = new Set(r.agents ?? []);
      if (event === "subagent-start") set.add(id);
      else set.delete(id);
      r.agents = [...set];
    });
    return;
  }
  if (data.agent_id) return;
  const sid = data.session_id;
  if (event !== "session-start" && run.sessionId && sid && sid !== run.sessionId) return;
  rememberLive(runId, data);
  switch (event) {
    case "session-start":
      mutateRun(runId, (r) => {
        r.sessionId = sid ?? r.sessionId;
        r.transcriptPath = data.transcript_path ?? r.transcriptPath;
        r.busy = false;
      });
      if (sid) record(run, sid, "idle", data.transcript_path);
      return;
    case "prompt":
      mutateRun(runId, (r) => void (r.busy = true));
      if (sid) record(run, sid, "busy");
      return;
    case "stop":
      ingestTranscript(data.transcript_path ?? run.transcriptPath, run.profile, run.startedAt);
      mutateRun(runId, (r) => {
        r.busy = false;
        r.lastStopAt = Date.now();
      });
      if (sid) record(run, sid, "idle");
      return;
    case "session-end":
      ingestTranscript(data.transcript_path ?? run.transcriptPath, run.profile, run.startedAt);
      if (sid) record(run, sid, "ended");
      return;
    case "stop-failure":
      return onStopFailure(run, data);
  }
}
function rememberLive(runId, data) {
  const mode = typeof data.permission_mode === "string" ? data.permission_mode : void 0;
  const effort = typeof data.effort?.level === "string" ? data.effort.level : void 0;
  const model = typeof data.model?.id === "string" ? data.model.id : typeof data.model === "string" ? data.model : void 0;
  if (!mode && !effort && !model) return;
  mutateRun(runId, (r) => {
    r.live = { ...r.live, ...mode ? { permissionMode: mode } : {}, ...effort ? { effort } : {}, ...model ? { model } : {} };
  });
}
function record(run, sessionId, state, transcriptPath) {
  recordSession({
    sessionId,
    state,
    profile: run.profile,
    cwd: run.cwd,
    runId: run.id,
    supervisorPid: run.pid,
    ...transcriptPath ? { transcriptPath } : {}
  });
}
function onStopFailure(run, data) {
  const error = data.error ?? data.error_type ?? "unknown";
  const now = Date.now();
  ingestTranscript(data.transcript_path ?? run.transcriptPath, run.profile, run.startedAt);
  mutateRun(run.id, (r) => {
    r.busy = false;
    r.lastStopAt = now;
  });
  if (data.session_id) record(run, data.session_id, "idle");
  if (run.pendingSwitch || run.lastFailureAt && now - run.lastFailureAt < 5e3) return;
  mutateRun(run.id, (r) => void (r.lastFailureAt = now));
  let hard = false;
  if (HARD_ERRORS[error]) {
    hard = true;
    mutateUsage((u) => {
      const cur = u[run.profile] ??= {};
      cur.blocks = [...cur.blocks ?? [], { until: 0, reason: HARD_ERRORS[error], type: "auth" }];
    });
  } else if (error === "rate_limit") {
    const refusal = findRefusal(run, data.transcript_path ?? run.transcriptPath);
    if (refusal?.resetsAt) {
      hard = true;
      recordEvent({ type: "limit", profile: run.profile, window: refusal.rateLimitType, resetsAt: refusal.resetsAt });
      const label = limitLabel(refusal.rateLimitType);
      mutateUsage((u) => {
        const cur = u[run.profile] ??= {};
        cur.blocks = [
          ...(cur.blocks ?? []).filter((b) => b.until === 0 || b.until > nowS()),
          { until: refusal.resetsAt, reason: `${label} reached`, type: refusal.rateLimitType }
        ];
      });
    } else {
      mutateUsage((u) => {
        const cur = u[run.profile] ??= {};
        cur.transient429 = [...(cur.transient429 ?? []).filter((t) => now - t < TRANSIENT_WINDOW_MS), now];
        if (cur.transient429.length >= TRANSIENT_LIMIT) {
          cur.blocks = [...cur.blocks ?? [], { until: nowS() + 600, reason: "repeated 429 errors", type: "transient" }];
          cur.transient429 = [];
          hard = true;
        }
      });
    }
  } else {
    return;
  }
  const cfg = loadConfig();
  log(`stop-failure run=${run.id} profile=${run.profile} error=${error} hard=${hard}`);
  if (!hard || !cfg.autoSwitch.enabled) return;
  const profile = getProfile(cfg, run.profile);
  if (!shouldLeave(cfg, loadUsage(), profile, true)) return;
  mutateRun(run.id, (r) => {
    r.pendingSwitch ??= { reason: `${run.profile}: ${error}`, requestedAt: now - 1, hard: true };
  });
}
function findRefusal(run, transcript) {
  if (!transcript) return void 0;
  const since = run.childStartedAt ?? run.startedAt;
  const main2 = findQuotaRefusal(transcript, since);
  if (main2) return main2;
  const subDir = path6.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  let best;
  try {
    for (const f of fs6.readdirSync(subDir)) {
      if (!f.endsWith(".jsonl")) continue;
      const r = findQuotaRefusal(path6.join(subDir, f), since);
      if (r && (!best || r.at > best.at)) best = r;
    }
  } catch {
  }
  return best;
}
function limitLabel(type) {
  switch (type) {
    case "five_hour":
      return "5-hour limit";
    case "seven_day":
      return "weekly limit";
    case "seven_day_opus":
      return "weekly Opus limit";
    case "seven_day_sonnet":
      return "weekly Sonnet limit";
    default:
      return type ? `${type} limit` : "usage limit";
  }
}

import { spawn as spawn3 } from "node:child_process";
import fs10 from "node:fs";
import path8 from "node:path";

import { execFileSync, spawnSync } from "node:child_process";
import fs7 from "node:fs";
function descendants(root) {
  if (process.platform === "win32") return [];
  let out = "";
  try {
    out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  const kids = new Map();
  for (const line of out.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || !ppid) continue;
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const res = [];
  const stack = [...kids.get(root) ?? []];
  while (stack.length) {
    const p = stack.pop();
    if (p === process.pid) continue;
    res.push(p);
    stack.push(...kids.get(p) ?? []);
  }
  return res;
}
function signal(pids, sig) {
  for (const p of pids) {
    try {
      process.kill(p, sig);
    } catch {
    }
  }
}
function saveTty() {
  if (process.platform === "win32" || !process.stdin.isTTY) return void 0;
  const r = spawnSync("stty", ["-g"], { stdio: ["inherit", "pipe", "ignore"], encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : void 0;
}
function restoreTty(saved) {
  if (!process.stdout.isTTY) return;
  if (saved) spawnSync("stty", [saved], { stdio: ["inherit", "ignore", "ignore"] });
  try {
    fs7.writeSync(1, "\x1B[=0u\x1B[<u\x1B[?1000l\x1B[?1002l\x1B[?1003l\x1B[?1006l\x1B[?2004l\x1B[?1049l\x1B[?25h");
  } catch {
  }
}
function claudeBin() {
  return process.env.J2C_CLAUDE_BIN || "claude";
}
function claudeVersion() {
  try {
    const out = execFileSync(claudeBin(), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15e3 });
    return out.match(/\d+\.\d+\.\d+/)?.[0];
  } catch {
    return void 0;
  }
}
function versionAtLeast(v, min) {
  if (!v) return false;
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

import { spawn, spawnSync as spawnSync2 } from "node:child_process";
import fs8 from "node:fs";
function isWsl() {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(fs8.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}
function has(cmd) {
  return spawnSync2(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;
}
function copyToClipboard(text) {
  if (process.env.J2C_NO_CLIPBOARD) return false;
  const candidates = process.platform === "darwin" ? [["pbcopy", []]] : process.platform === "win32" ? [["clip", []]] : isWsl() ? [["clip.exe", []]] : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  for (const [cmd, args] of candidates) {
    if (!has(cmd)) continue;
    const r = spawnSync2(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 5e3 });
    if (r.status === 0) return true;
  }
  return false;
}
function openInBrowser(url) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["explorer.exe", [url]] : isWsl() ? has("wslview") ? ["wslview", [url]] : ["explorer.exe", [url]] : ["xdg-open", [url]];
  if (!has(cmd)) return false;
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

import { spawn as spawn2 } from "node:child_process";
import crypto from "node:crypto";
import fs9 from "node:fs";
import path7 from "node:path";
var AUTH_ENV_KEYS = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_MANTLE",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "ANTHROPIC_FOUNDRY_API_KEY",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_SECURESTORAGE_CONFIG_DIR"
];
var KEEP_VALUE_FLAGS = new Set(["--model", "--permission-mode", "--add-dir", "--agent", "--effort", "--fallback-model"]);
var KEEP_BOOL_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--verbose",
  "--chrome",
  "--no-chrome",
  "--ide"
]);
function buildEnv(p, run, keepEnv = false, base = process.env) {
  const env = { ...base };
  if (!keepEnv) for (const k of AUTH_ENV_KEYS) delete env[k];
  delete env.CLAUDE_CONFIG_DIR;
  Object.assign(env, p.env ?? {});
  if (!p.isMain) env.CLAUDE_CONFIG_DIR = p.configDir;
  env.J2C_RUN_ID = run.id;
  env.J2C_PROFILE = p.name;
  env.J2C_NODE = process.execPath;
  env.J2C_BIN = path7.resolve(process.argv[1] ?? "j2c");
  return env;
}
function carryFlags(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const [flag, inline] = a.split(/=(.*)/s, 2);
    if (KEEP_BOOL_FLAGS.has(a)) out.push(a);
    else if (KEEP_VALUE_FLAGS.has(flag)) {
      if (inline !== void 0) out.push(a);
      else if (i + 1 < args.length) out.push(a, args[++i]);
    }
  }
  return out;
}
function userStatusline(p, cwd) {
  const files = [
    path7.join(cwd, ".claude", "settings.local.json"),
    path7.join(cwd, ".claude", "settings.json"),
    path7.join(p.isMain ? defaultClaudeDir() : p.configDir, "settings.json")
  ];
  for (const f of files) {
    const s = readJson(f, null)?.statusLine;
    if (s?.type === "command" && typeof s.command === "string" && !s.command.includes(" statusline --run ")) return s.command;
  }
  return void 0;
}
function writeRunSettings(cfg, run, p, extra) {
  const me = `"${process.execPath}" "${path7.resolve(process.argv[1] ?? "j2c")}"`;
  const hook = (ev) => [{ hooks: [{ type: "command", command: `${me} hook ${ev} --run ${run.id}`, timeout: 15 }] }];
  const wrapped = userStatusline(p, run.cwd);
  const settings = {
    hooks: {
      SessionStart: hook("session-start"),
      UserPromptSubmit: hook("prompt"),
      Stop: hook("stop"),
      StopFailure: hook("stop-failure"),
      SessionEnd: hook("session-end"),
      SubagentStart: hook("subagent-start"),
      SubagentStop: hook("subagent-stop")
    },
    statusLine: {
      type: "command",
      command: `${me} statusline --run ${run.id}` + (wrapped ? ` --wrap-b64 ${Buffer.from(wrapped).toString("base64")}` : ""),
      padding: 0
    }
  };
  if (cfg.autoSwitch.enabled && p.provider === "claude") settings.autoContinueAtUsageLimit = false;
  const i = extra.indexOf("--settings");
  if (i !== -1 && extra[i + 1]) {
    const v = extra[i + 1];
    const theirs = v.trim().startsWith("{") ? JSON.parse(v) : readJson(v, {});
    for (const [k, val] of Object.entries(theirs)) if (!(k in settings)) settings[k] = val;
  }
  const file = path7.join(paths.runsDir(), `${run.id}.settings.json`);
  writeJson(file, settings);
  return file;
}
function stripSettingsFlag(args) {
  const out = [];
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
var say = (msg) => process.stderr.write(`\x1B[33m[julius2claude]\x1B[0m ${msg}
`);
async function supervise(opts) {
  const cfg = withoutBindings(loadConfig(), opts.noBinding);
  const cwd = path7.resolve(opts.cwd);
  const start = pickStart(cfg, loadUsage(), cwd, opts.profile);
  if (!start.profile) throw new UserError(start.reason ?? "no usable profile");
  let profile = start.profile;
  if (start.reason) say(`${profile.name} looks exhausted and ${start.reason}; starting on it anyway.`);
  if (loginState(profile) === "needs-login") throw new UserError(`profile "${profile.name}" is not logged in. Run \`j2c login ${profile.name}\`.`);
  const version = claudeVersion();
  if (!version) throw new UserError("could not run `claude`. Install Claude Code first: https://code.claude.com");
  if (cfg.autoSwitch.enabled && !versionAtLeast(version, "2.1.152"))
    say(`Claude Code ${version} can fail to resume a session on another account. Update with \`claude update\`.`);
  const run = { id: crypto.randomUUID(), pid: process.pid, profile: profile.name, cwd, busy: false, startedAt: Date.now(), ...opts.noBinding ? { noBinding: true } : {} };
  saveRun(run);
  const settingsFile = writeRunSettings(cfg, run, profile, opts.args);
  const ttyState = saveTty();
  let args = [...stripSettingsFlag(opts.args)];
  const carried = carryFlags(opts.args);
  const onSigint = () => {
  };
  process.on("SIGINT", onSigint);
  let child;
  for (const sig of ["SIGTERM", "SIGHUP"]) process.on(sig, () => child?.kill(sig));
  try {
    for (; ; ) {
      ensureProfileDir(profile);
      const env = buildEnv(profile, loadRun(run.id) ?? run, opts.keepEnv);
      mutateRun(run.id, (r) => {
        r.profile = profile.name;
        r.childStartedAt = Date.now();
        r.busy = false;
        r.agents = [];
        r.baselineChildren = void 0;
        r.pendingSwitch = void 0;
      });
      log(`launch run=${run.id} profile=${profile.name} args=${JSON.stringify(args)}`);
      child = spawn2(claudeBin(), ["--settings", settingsFile, ...args], { stdio: "inherit", cwd, env });
      mutateRun(run.id, (r) => void (r.childPid = child.pid));
      const outcome = await watch(child, run.id);
      if (outcome.kind === "exited") {
        if (outcome.code !== 0) restoreTty(ttyState);
        return outcome.code;
      }
      const cur = loadRun(run.id);
      const cfgNow = withoutBindings(loadConfig(), opts.noBinding);
      const pending = cur.pendingSwitch;
      let target;
      let waitUntil;
      if (pending.to) {
        target = cfgNow.profiles.find((p) => p.name === pending.to);
        if (!target || !allowedIn(cfgNow, cwd).some((p) => p.name === target.name)) {
          say(`can't switch to "${pending.to}" here.`);
          mutateRun(run.id, (r) => void (r.pendingSwitch = void 0));
          const again = await watch(child, run.id);
          if (again.kind === "exited") return again.code;
          continue;
        }
      } else {
        const next2 = pickNext(cfgNow, loadUsage(), getProfile(cfgNow, profile.name), cwd);
        target = next2.profile;
        waitUntil = next2.waitUntil;
        if (!target && !pending.hard) {
          mutateRun(run.id, (r) => void (r.pendingSwitch = void 0));
          const again = await watch(child, run.id);
          if (again.kind === "exited") return again.code;
          continue;
        }
      }
      const sessionId = cur.sessionId;
      if (sessionId && liveRuns().some((r) => r.id !== run.id && r.sessionId === sessionId)) {
        say(`session ${sessionId.slice(0, 8)} is open in another terminal; not moving it (two processes on one transcript corrupt it).`);
        mutateRun(run.id, (r) => void (r.pendingSwitch = void 0));
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
      const fromOrg = getProfile(cfgNow, from).account?.org;
      const toOrg = profile.account?.org;
      const crossOrg = !!fromOrg && !!toOrg && fromOrg !== toOrg;
      mutateRun(run.id, (r) => void (r.lastSwitch = { from, to: profile.name, reason: pending.reason, at: Date.now(), fromOrg, toOrg }));
      say(`${from} \u2192 ${profile.name} (${pending.reason}).${sessionId ? " Resuming the same session\u2026" : ""}`);
      if (crossOrg && !cfgNow.bindings.some((b) => b.strict))
        say(`${profile.name} belongs to another organization (${toOrg}). Company isolation is off, so the session moved there. To keep a folder on one account: j2c bind <profile> <folder> --strict`);
      recordEvent({ type: "switch", profile: from, to: profile.name, reason: pending.reason });
      log(`switch run=${run.id} ${from} -> ${profile.name} reason=${pending.reason} hard=${pending.hard}`);
      const transcriptOk = !!cur.transcriptPath && fs9.existsSync(cur.transcriptPath);
      if (sessionId && transcriptOk) {
        args = [...liveFlags(carried, cur.live, getProfile(cfgNow, from).provider === profile.provider), "--resume", sessionId];
        if (pending.hard) args.push(continuePrompt(from, profile.name, pending.reason, killedTasks));
      } else {
        args = [...stripSettingsFlag(opts.args)];
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    removeRun(run.id);
    fs9.rmSync(settingsFile, { force: true });
  }
}
function watch(child, runId) {
  return new Promise((resolve) => {
    let done = false;
    let lastSeenStop = 0;
    const finish = (o) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      child.off("exit", onExit);
      resolve(o);
    };
    const onExit = (code, sig) => finish({ kind: "exited", code: code ?? (sig ? 130 : 1) });
    child.on("exit", onExit);
    const timer = setInterval(() => {
      const r = loadRun(runId);
      if (!r) return;
      if (r.lastStopAt && r.lastStopAt !== lastSeenStop && child.pid) {
        lastSeenStop = r.lastStopAt;
        const n = descendants(child.pid).length;
        if (r.baselineChildren === void 0 || n < r.baselineChildren) mutateRun(runId, (x) => void (x.baselineChildren = n));
      }
      if (readyToSwitch(r, child.pid)) finish({ kind: "switch" });
    }, 250);
    if (child.exitCode !== null || child.signalCode) onExit(child.exitCode, child.signalCode);
  });
}
function readyToSwitch(r, childPid, now = Date.now()) {
  const p = r.pendingSwitch;
  if (!p || r.busy || !r.lastStopAt || r.lastStopAt < p.requestedAt) return false;
  if (p.hard || p.to) return true;
  if (now - r.lastStopAt > BOUNDARY_MS) return false;
  if ((r.agents ?? []).length) return false;
  if (childPid && r.baselineChildren !== void 0 && descendants(childPid).length > r.baselineChildren) return false;
  return true;
}
async function stopClaude(child, r) {
  const pid = child.pid;
  const tree = descendants(pid);
  const extra = r.baselineChildren !== void 0 && tree.length > r.baselineChildren ? describe(tree) : [];
  const exited = new Promise((res) => child.exitCode !== null || child.signalCode ? res() : child.once("exit", () => res()));
  const steps = [["SIGINT", 2500], ["SIGINT", 2500], ["SIGTERM", 3e3], ["SIGKILL", 2e3]];
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
function describe(pids) {
  if (process.platform === "win32") return [];
  const out = [];
  for (const p of pids.slice(0, 10)) {
    try {
      const cmd = fs9.readFileSync(`/proc/${p}/cmdline`, "utf8").replace(/\0/g, " ").trim();
      if (cmd) out.push(cmd.slice(0, 120));
    } catch {
    }
  }
  return out;
}
function liveFlags(carried, live, sameProvider) {
  const drop = new Set();
  const extra = [];
  if (live?.permissionMode && live.permissionMode !== "default") {
    drop.add("--permission-mode");
    extra.push("--permission-mode", live.permissionMode);
  }
  if (live?.effort) {
    drop.add("--effort");
    extra.push("--effort", live.effort);
  }
  if (live?.model && sameProvider) {
    drop.add("--model");
    extra.push("--model", live.model);
  }
  const out = [];
  for (let i = 0; i < carried.length; i++) {
    const [flag] = carried[i].split("=", 1);
    if (drop.has(flag)) {
      if (!carried[i].includes("=")) i++;
      continue;
    }
    out.push(carried[i]);
  }
  return [...out, ...extra];
}
function continuePrompt(from, to, reason, killed) {
  return [
    `[julius2claude] This session was moved from account "${from}" to "${to}" because ${reason}.`,
    "The last turn was cut off by the limit. Check the result of the last tool call and redo anything that did not complete.",
    killed.length ? `These background processes were stopped during the move; restart the ones still needed: ${killed.join(" | ")}.` : "",
    "Then continue the task from where it stopped."
  ].filter(Boolean).join(" ");
}
async function waitForReset(cfg, from, cwd, until) {
  if (!until) {
    say("every eligible account is blocked and none has a known reset time. Run `j2c status` to see why.");
    return void 0;
  }
  say(`every eligible account is at its limit. Waiting until ${new Date(until * 1e3).toLocaleTimeString()} to resume (Ctrl+C to stop).`);
  let cancelled = false;
  const onInt = () => cancelled = true;
  process.on("SIGINT", onInt);
  try {
    while (!cancelled && nowS() < until + 5) await delay(1e3);
  } finally {
    process.off("SIGINT", onInt);
  }
  if (cancelled) return void 0;
  const usage = loadUsage();
  const self = getProfile(loadConfig(), from.name);
  const next2 = pickNext(cfg, usage, self, cwd);
  return next2.profile ?? self;
}
var delay = (ms) => new Promise((r) => setTimeout(r, ms));

var stateFile = (name) => path8.join(paths.stateDir(), `login-${name}.json`);
var codeFile = (name) => path8.join(paths.stateDir(), `login-${name}.code`);
var WAIT_FOR_CODE_MS = 15 * 6e4;
function loginEnv(p) {
  const env = buildEnv(p, { id: "login", pid: process.pid, profile: p.name, cwd: process.cwd(), busy: false, startedAt: Date.now() });
  delete env.J2C_RUN_ID;
  return env;
}
function recordLogin(name, before) {
  const cfg = loadConfig();
  const p = getProfile(cfg, name);
  const id = readIdentity(p);
  const warnings = [];
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
function claudeProfile(name) {
  const p = getProfile(loadConfig(), name);
  if (p.provider !== "claude") throw new UserError(`"${name}" is a ${p.provider} profile; it uses your ${p.provider} credentials, not a Claude login.`);
  return p;
}
function startLogin(name, email, json, interactive = false) {
  const p = claudeProfile(name);
  ensureProfileDir(p);
  const prev = readJson(stateFile(name), null);
  if (prev?.pid && alive(prev.pid)) {
    try {
      process.kill(prev.pid, "SIGTERM");
    } catch {
    }
    const deadline2 = Date.now() + 5e3;
    while (alive(prev.pid) && Date.now() < deadline2) sleepSync(100);
  }
  fs10.rmSync(codeFile(name), { force: true });
  writeJson(stateFile(name), { status: "starting", startedAt: Date.now() });
  const worker = spawn3(process.execPath, [path8.resolve(process.argv[1]), "__login-worker", name, ...email ? ["--email", email] : []], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  worker.unref();
  const deadline = Date.now() + 3e4;
  let st = readJson(stateFile(name), null);
  while (Date.now() < deadline && (!st || st.status === "starting")) {
    sleepSync(200);
    st = readJson(stateFile(name), null);
  }
  if (st?.status === "done") {
    fs10.rmSync(stateFile(name), { force: true });
    if (json) console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "logged_in", email: st.email ?? null, org: st.org ?? null }));
    else console.log(`\u2713 ${name}: ${st.email ?? "logged in"}${st.org ? ` (${st.org})` : ""}`);
    return 0;
  }
  if (!st?.url) throw new UserError(`could not start the login for "${name}"${st?.error ? `: ${st.error}` : ""}.`);
  const copied = copyToClipboard(st.url);
  if (json) {
    console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "waiting_for_code", url: st.url, copied, next: `j2c login ${name} --code <code>` }));
    return 0;
  }
  console.log(`Login for "${name}" is waiting.

1. Open this link and sign in with the account you want for "${name}"${copied ? " (already copied to your clipboard)" : ""}:
   ${st.url}
2. Copy the code shown at the end of the login.
3. ${interactive ? "Paste it here and press Enter." : `Run: j2c login ${name} --code <code>`}

The code only works for this login and expires in a few minutes.`);
  return 0;
}
function cancelLogin(name) {
  const st = readJson(stateFile(name), null);
  if (st?.pid && alive(st.pid)) {
    try {
      process.kill(st.pid, "SIGTERM");
    } catch {
    }
    const deadline = Date.now() + 5e3;
    while (alive(st.pid) && Date.now() < deadline) sleepSync(100);
  }
  fs10.rmSync(stateFile(name), { force: true });
  fs10.rmSync(codeFile(name), { force: true });
  console.log(`No login is waiting for "${name}" anymore.`);
  return 0;
}
function submitCode(name, code, json) {
  claudeProfile(name);
  const st = readJson(stateFile(name), null);
  if (!st || st.status !== "waiting" || !alive(st.pid))
    throw new UserError(`no login is waiting for "${name}". Start one with: j2c login ${name} --start`);
  fs10.writeFileSync(codeFile(name), code.trim() + "\n", { mode: 384 });
  const deadline = Date.now() + 9e4;
  let cur = st;
  while (Date.now() < deadline) {
    sleepSync(250);
    cur = readJson(stateFile(name), null);
    if (cur?.status === "done" || cur?.status === "failed") break;
  }
  fs10.rmSync(codeFile(name), { force: true });
  if (cur?.status !== "done") {
    const msg = cur?.status === "failed" ? cur.error ?? "login failed" : "timed out waiting for the login to finish";
    if (json) console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "failed", error: msg }));
    else console.error(`Login for "${name}" failed: ${msg}. Start again with: j2c login ${name} --start`);
    return 1;
  }
  const warnings = cur.warnings ?? [];
  if (json) console.log(JSON.stringify({ schemaVersion: 1, profile: name, status: "logged_in", email: cur.email ?? null, org: cur.org ?? null, warnings }));
  else {
    console.log(`\u2713 ${name}: ${cur.email ?? "logged in"}${cur.org ? ` (${cur.org})` : ""}`);
    for (const w of warnings) console.log(`! ${w}`);
  }
  fs10.rmSync(stateFile(name), { force: true });
  return 0;
}
async function loginWorker(name, email) {
  const p = claudeProfile(name);
  const before = readIdentity(p);
  const set = (s) => writeJson(stateFile(name), { ...readJson(stateFile(name), { status: "starting", startedAt: Date.now() }), ...s });
  const child = spawn3(claudeBin(), ["auth", "login", ...email ? ["--email", email] : []], {
    env: { ...loginEnv(p), BROWSER: process.env.J2C_BROWSER ?? "true" },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let out = "";
  let url;
  const onData = (d) => {
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
  const exited = new Promise((res) => child.on("exit", (c) => res(c ?? 1)));
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"])
    process.on(sig, () => {
      child.kill("SIGTERM");
      set({ status: "failed", error: "login cancelled" });
      process.exit(1);
    });
  const deadline = Date.now() + WAIT_FOR_CODE_MS;
  let sent = false;
  let code = -1;
  for (; ; ) {
    const done = await Promise.race([exited, new Promise((r2) => setTimeout(() => r2(null), 300))]);
    if (done !== null) {
      code = done;
      break;
    }
    if (!sent && fs10.existsSync(codeFile(name))) {
      child.stdin.write(fs10.readFileSync(codeFile(name), "utf8"));
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
async function interactiveLogin(name, email) {
  const st0 = startLogin(name, email, false, true);
  if (st0 !== 0) return st0;
  const url = readJson(stateFile(name), null)?.url;
  if (!url) return 0;
  process.stdout.write("\nKeys: c = copy the link, o = open it in the browser. Paste the code and press Enter: ");
  const code = await readCode(url);
  if (code === void 0) {
    cancelLogin(name);
    return 1;
  }
  return submitCode(name, code, false);
}
function readCode(url) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buf = "";
    const done = (v) => {
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(v);
    };
    const onData = (chunk) => {
      const s = chunk.toString("utf8");
      if (s === "") return done(void 0);
      if (!buf && s.length === 1 && (s === "c" || s === "C")) {
        process.stdout.write(copyToClipboard(url) ? "\r\x1B[2Klink copied. Paste the code and press Enter: " : "\r\x1B[2Kno clipboard tool found; copy the link above. Code: ");
        return;
      }
      if (!buf && s.length === 1 && (s === "o" || s === "O")) {
        process.stdout.write(openInBrowser(url) ? "\r\x1B[2Kopened in the browser. Paste the code and press Enter: " : "\r\x1B[2Kcould not open a browser; copy the link above. Code: ");
        return;
      }
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          if (buf.trim()) return done(buf.trim());
          continue;
        }
        if (ch === "\x7F" || ch === "\b") {
          if (buf) {
            buf = buf.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (ch >= " ") {
          buf += ch;
          process.stdout.write("*");
        }
      }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

import fs11 from "node:fs";
import path9 from "node:path";
var J2C = `"\${J2C_NODE:-node}" "\${J2C_BIN:-$(command -v j2c)}"`;
var COMMANDS = {
  use: {
    description: "julius2claude: move this session to another account (at the end of this turn)",
    hint: "<profile>",
    body: `!\`${J2C} use $ARGUMENTS --from-session 2>&1\`

Reply with one short line confirming what julius2claude said above. Do not do anything else.`
  },
  next: {
    description: "julius2claude: move this session to the next account with room left",
    body: `!\`${J2C} next --from-session 2>&1\`

Reply with one short line confirming what julius2claude said above. Do not do anything else.`
  },
  stats: {
    description: "julius2claude: tokens per account and how long each took to reach its limits",
    body: `!\`${J2C} stats 2>&1\`

Show the report above to the user as-is. Do not do anything else.`
  },
  status: {
    description: "julius2claude: accounts, limits and which one this session is on",
    body: `!\`${J2C} usage --plain 2>&1\`

Show the report above to the user exactly as-is inside a code block. Do not do anything else.`
  },
  usage: {
    description: "julius2claude: visual usage of every account (5h and weekly bars, resets, tokens)",
    body: `!\`${J2C} usage --plain 2>&1\`

Show the report above to the user exactly as-is inside a code block. Do not do anything else.`
  }
};
function commandsDir() {
  return path9.join(defaultClaudeDir(), "commands", "j2c");
}
function installSlashCommands() {
  const dir = commandsDir();
  fs11.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [name, c] of Object.entries(COMMANDS)) {
    const fm = [
      "---",
      `description: ${c.description}`,
      ...c.hint ? [`argument-hint: ${c.hint}`] : [],
      "allowed-tools: Bash",
      "disable-model-invocation: true",
      "---",
      ""
    ].join("\n");
    const file = path9.join(dir, `${name}.md`);
    fs11.writeFileSync(file, fm + c.body + "\n");
    written.push(file);
  }
  return written;
}

import { spawnSync as spawnSync3 } from "node:child_process";
async function runStatusline(runId, wrapped) {
  const raw = await readStdin();
  if (runId && !raw.agent_id) rememberLive(runId, raw);
  const run = runId ? loadRun(runId) : void 0;
  const cfg = withoutBindings(loadConfig(), run?.noBinding);
  const profileName = run?.profile ?? process.env.J2C_PROFILE;
  const lines = [];
  if (profileName && cfg.profiles.some((p) => p.name === profileName)) {
    if (raw.rate_limits) recordStatusline(profileName, raw.rate_limits);
    const usage = loadUsage();
    const profile = getProfile(cfg, profileName);
    const u = usage[profileName];
    const parts = [`j2c ${profileName}`];
    const five = livePct(u?.fiveHour);
    const seven = livePct(u?.sevenDay);
    if (five !== void 0) parts.push(`5h ${bar(five)} ${Math.round(five)}%`);
    if (seven !== void 0) parts.push(`7d ${Math.round(seven)}%`);
    if (run && cfg.autoSwitch.enabled && !run.pendingSwitch && shouldLeave(cfg, usage, profile, false)) {
      const next2 = pickNext(cfg, usage, profile, run.cwd);
      if (next2.profile) {
        const weekly = (livePct(u?.sevenDay) ?? 0) >= cfg.autoSwitch.weeklyPct;
        const win = weekly ? u?.sevenDay : u?.fiveHour;
        recordEvent({ type: "threshold", profile: profileName, window: weekly ? "seven_day" : "five_hour", resetsAt: win?.resetsAt });
        const justStopped = !run.busy && run.lastStopAt && Date.now() - run.lastStopAt < BOUNDARY_MS;
        mutateRun(run.id, (r) => {
          r.pendingSwitch ??= {
            reason: usable(cfg, usage, profile).reason ?? "threshold",
            requestedAt: justStopped ? run.lastStopAt : Date.now(),
            hard: false
          };
        });
      }
    }
    const fresh = run ? loadRun(run.id) : void 0;
    const ls = fresh?.lastSwitch;
    if (ls && Date.now() - ls.at < 15 * 6e4)
      parts.push(`\u21AA moved from ${ls.from} (${ls.reason})${ls.fromOrg && ls.toOrg && ls.fromOrg !== ls.toOrg ? `, other organization: ${ls.toOrg}` : ""}`);
    const warn5 = five !== void 0 && five >= 80 && five < cfg.autoSwitch.fiveHourPct;
    const warn7 = seven !== void 0 && seven >= 90 && seven < cfg.autoSwitch.weeklyPct;
    if ((warn5 || warn7) && !fresh?.pendingSwitch) {
      const nx = pickNext(cfg, usage, profile, run?.cwd ?? process.cwd());
      parts.push(`\u26A0 near the ${warn7 ? "weekly" : "5h"} limit${nx.profile ? ` \xB7 next: ${nx.profile.name}` : ""}`);
    }
    if (fresh?.pendingSwitch) parts.push(`\u21AA switching at end of turn (${fresh.pendingSwitch.reason})`);
    else if (!usable(cfg, usage, profile).ok) {
      const next2 = pickNext(cfg, usage, profile, run?.cwd ?? process.cwd());
      parts.push(next2.profile ? `\u26A0 ${usable(cfg, usage, profile).reason} \xB7 /j2c:next \u2192 ${next2.profile.name}` : `\u26A0 ${usable(cfg, usage, profile).reason}`);
    }
    lines.push(parts.join(" \xB7 "));
    if (u && !u.enteredAt) mutateUsage((s) => void ((s[profileName] ??= {}).enteredAt = Date.now()));
  }
  if (wrapped) {
    const r = spawnSync3(wrapped, { shell: true, input: JSON.stringify(raw), encoding: "utf8", timeout: 3e3 });
    const out = (r.stdout ?? "").trimEnd();
    if (out) lines.push(out);
  }
  return lines.join("\n");
}
function bar(pct) {
  const filled = Math.max(0, Math.min(5, Math.round(pct / 20)));
  return "\u25B0".repeat(filled) + "\u25B1".repeat(5 - filled);
}

var VERSION = true ? "0.3.0" : "dev";
var SCHEMA_VERSION = 1;
var HELP = `julius2claude (j2c) ${VERSION}: multi-account routing and usage-limit failover for Claude Code.

Run Claude Code across your own accounts (Pro/Max, Team/Enterprise, Bedrock, Vertex, Foundry,
API key) and move a session to the next account when one hits its limit \u2014 at the end of a turn,
without losing the conversation.

Usage:
  j2c [claude args...]            start Claude Code on the right account (same args as \`claude\`)
  j2c -P <profile> [claude args]  start on a specific profile
  j2c --no-binding [claude args]  ignore folder bindings for this session

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
  j2c usage                       visual usage of every account (bars, resets, tokens)
  j2c stats [--days N] [--json]   tokens per account and how long each took to reach its limits
  j2c recover [n]                 resume sessions cut off by a crash / WSL restart
  j2c doctor                      check everything that commonly goes wrong

Docs: https://github.com/gabrielvieiraf/julius2claude`;
function parse(argv, valueFlags = []) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
      let v = true;
      if (inline !== void 0) v = inline;
      else if (valueFlags.includes(k) && i + 1 < argv.length) v = argv[++i];
      const prev = out.flags[k];
      if (k === "env") out.flags[k] = [...prev ?? [], String(v)];
      else out.flags[k] = v;
    } else out._.push(a);
  }
  return out;
}
var str = (v) => typeof v === "string" ? v : void 0;
function requireSetup() {
  if (!fs12.existsSync(paths.config())) throw new UserError("julius2claude is not set up yet. Run `j2c setup` first.");
  return loadConfig();
}
async function main(argv) {
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
      const out = await runStatusline(str(p.flags.run), wrap ? Buffer.from(wrap, "base64").toString("utf8") : void 0);
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
      return add2(rest);
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
    case "usage":
      return usageView(rest);
    case "run":
      return launch(rest);
    default:
      return launch(argv);
  }
}
async function launch(argv) {
  requireSetup();
  let profile;
  let keepEnv = false;
  let noBinding = false;
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-P" || argv[i] === "--profile") profile = argv[++i];
    else if (argv[i] === "--keep-env") keepEnv = true;
    else if (argv[i] === "--no-binding") noBinding = true;
    else args.push(argv[i]);
  }
  return supervise({ profile, args, cwd: process.cwd(), keepEnv, noBinding });
}
function setup() {
  const existed = fs12.existsSync(paths.config());
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
  console.log(`  commands: /j2c:use, /j2c:next, /j2c:status (${path10.dirname(files[0])})`);
  if (mainP?.account?.email) console.log(`  main:     ${mainP.account.email}${mainP.account.org ? ` (${mainP.account.org})` : ""}`);
  if (!v) console.log("  \u26A0 `claude` was not found on PATH. Install Claude Code: https://code.claude.com");
  else if (!versionAtLeast(v, "2.1.152")) console.log(`  \u26A0 Claude Code ${v} is old; run \`claude update\`.`);
  console.log(`
Next:
  j2c add work              # log in a second account (e.g. your company's)
  j2c add aws --bedrock     # or a pay-per-token Amazon Bedrock profile
  j2c                       # start Claude Code through julius2claude (same args as \`claude\`)

Tip: alias claude=j2c  \u2014 if you want every session supervised.`);
  if (!process.stdin.isTTY) console.log("\nAI agents: follow docs/AGENT-SETUP.md (https://github.com/gabrielvieiraf/julius2claude/blob/main/docs/AGENT-SETUP.md).");
  return 0;
}
function add2(argv) {
  const cfg0 = requireSetup();
  const p = parse(argv, ["aws-profile", "region", "project", "resource", "api-key-helper", "env", "group", "model", "email"]);
  const name = p._[0];
  if (!name || !NAME_RE.test(name)) throw new UserError("usage: j2c add <name> [options]  (name: lowercase letters, digits, - or _)");
  if (cfg0.profiles.some((x) => x.name === name)) throw new UserError(`profile "${name}" already exists.`);
  const f = p.flags;
  let provider = "claude";
  const env = {};
  if (f.bedrock) {
    provider = "bedrock";
    env.CLAUDE_CODE_USE_BEDROCK = "1";
    if (str(f["aws-profile"])) env.AWS_PROFILE = str(f["aws-profile"]);
    if (str(f.region)) env.AWS_REGION = str(f.region);
  } else if (f.vertex) {
    provider = "vertex";
    env.CLAUDE_CODE_USE_VERTEX = "1";
    if (!str(f.project)) throw new UserError("--vertex needs --project <gcp-project-id>");
    env.ANTHROPIC_VERTEX_PROJECT_ID = str(f.project);
    env.CLOUD_ML_REGION = str(f.region) ?? "global";
  } else if (f.foundry) {
    provider = "foundry";
    env.CLAUDE_CODE_USE_FOUNDRY = "1";
    if (!str(f.resource)) throw new UserError("--foundry needs --resource <name>");
    env.ANTHROPIC_FOUNDRY_RESOURCE = str(f.resource);
  } else if (f["api-key-helper"]) {
    provider = "apikey";
  }
  if (str(f.model)) env.ANTHROPIC_MODEL = str(f.model);
  for (const kv of f.env ?? []) {
    const i = kv.indexOf("=");
    if (i < 1) throw new UserError(`--env expects KEY=VALUE, got "${kv}"`);
    const k = kv.slice(0, i);
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(k) && k !== "AWS_PROFILE")
      throw new UserError(`refusing to store ${k} in plain text. Use --api-key-helper "<command that prints it>" or your AWS/GCP credential chain.`);
    env[k] = kv.slice(i + 1);
  }
  const group = str(f.group);
  if (group && !NAME_RE.test(group)) throw new UserError("--group: lowercase letters, digits, - or _");
  const profile = {
    name,
    provider,
    configDir: paths.profileDir(name),
    ...Object.keys(env).length ? { env } : {},
    ...group && group !== "default" ? { group } : {}
  };
  mutateConfig((cfg) => {
    cfg.profiles.push(profile);
    if (!cfg.order.includes(name)) cfg.order.push(name);
  });
  ensureProfileDir(profile);
  if (provider === "apikey") {
    const file = path10.join(profile.configDir, "settings.json");
    const s = JSON.parse(fs12.readFileSync(file, "utf8"));
    s.apiKeyHelper = str(f["api-key-helper"]);
    fs12.writeFileSync(file, JSON.stringify(s, null, 2) + "\n", { mode: 384 });
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
  return login([name, ...str(f.email) ? ["--email", str(f.email)] : [], ...f.json ? ["--json"] : []]);
}
function login(argv) {
  requireSetup();
  const p = parse(argv, ["code", "email"]);
  const name = p._[0];
  if (!name) throw new UserError("usage: j2c login <profile> [--start | --code <code>] [--email <email>] [--json]");
  const json = !!p.flags.json;
  if (p.flags.cancel) return cancelLogin(name);
  if (p.flags.start) return startLogin(name, str(p.flags.email), json);
  if (str(p.flags.code)) return submitCode(name, str(p.flags.code), json);
  if (!process.stdin.isTTY || json) return startLogin(name, str(p.flags.email), json);
  return interactiveLogin(name, str(p.flags.email));
}
function remove(argv) {
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
    for (const e of fs12.readdirSync(prof.configDir, { withFileTypes: true })) if (e.isSymbolicLink()) fs12.unlinkSync(path10.join(prof.configDir, e.name));
    fs12.rmSync(prof.configDir, { recursive: true, force: true });
    console.log(`Removed "${name}" and its folder. Its login was not revoked; sign out at claude.ai if you want that.`);
  } else console.log(`Removed "${name}". Its folder is kept at ${prof.configDir}.`);
  return 0;
}
function fmtReset(epoch) {
  if (!epoch) return "";
  const d = new Date(epoch * 1e3);
  const sameDay = d.toDateString() === (new Date()).toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
function status(argv) {
  const cfg = requireSetup();
  const usage = loadUsage();
  const runs = liveRuns();
  const here = bindingFor(cfg, process.cwd());
  const current = process.env.J2C_RUN_ID ? loadRun(process.env.J2C_RUN_ID) : void 0;
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
      thisSession: current?.profile === p.name
    };
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, autoSwitch: cfg.autoSwitch, binding: here ?? null, profiles: rows }, null, 2));
    return 0;
  }
  const pct = (n) => n === null ? "  \u2014" : `${String(Math.round(n)).padStart(3)}%`;
  console.log(`auto-switch: ${cfg.autoSwitch.enabled ? `on (5h \u2265${cfg.autoSwitch.fiveHourPct}%, weekly \u2265${cfg.autoSwitch.weeklyPct}%${cfg.autoSwitch.allowPaid ? ", may use paid profiles" : ""})` : "off (j2c auto on)"}`);
  if (here) console.log(`this folder \u2192 ${here.profile}${here.strict ? " (strict)" : ""}`);
  console.log("");
  for (const r of rows) {
    const mark = r.thisSession ? "\u25B6" : r.default ? "*" : " ";
    const who = r.account ? `${r.account}${r.org ? ` \xB7 ${r.org}` : ""}` : r.provider === "claude" ? "(not logged in)" : r.provider;
    const limits = r.provider === "claude" ? `5h ${pct(r.fiveHour)}  7d ${pct(r.weekly)}` : "pay-per-token ";
    const state = r.usable ? "ready" : `${r.reason}${r.availableAt ? ` \xB7 back ${fmtReset(r.availableAt)}` : ""}`;
    console.log(`${mark} ${r.name.padEnd(12)} ${limits}  ${state.padEnd(28)} ${who}${r.sessions ? ` \xB7 ${r.sessions} running` : ""}`);
  }
  console.log("\n\u25B6 this session   * default for new sessions");
  return 0;
}
function requestSwitch(to, reason) {
  const id = process.env.J2C_RUN_ID;
  const run = id ? loadRun(id) : void 0;
  if (!run || !alive(run.pid)) return "";
  mutateRun(run.id, (r) => void (r.pendingSwitch = { to, reason, requestedAt: Date.now(), hard: false }));
  return run.profile;
}
function use(argv) {
  const cfg = requireSetup();
  const p = parse(argv);
  const name = p._[0];
  if (!name) throw new UserError("usage: j2c use <profile>");
  const target = getProfile(cfg, name);
  if (p.flags["from-session"]) {
    const run = process.env.J2C_RUN_ID ? loadRun(process.env.J2C_RUN_ID) : void 0;
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
function next(argv) {
  const cfg = requireSetup();
  const run = process.env.J2C_RUN_ID ? loadRun(process.env.J2C_RUN_ID) : void 0;
  const from = run ? getProfile(cfg, run.profile) : getProfile(cfg, cfg.active);
  const pick = pickNext({ ...withoutBindings(cfg, run?.noBinding), autoSwitch: { ...cfg.autoSwitch, allowPaid: cfg.autoSwitch.allowPaid || argv.includes("--paid") } }, loadUsage(), from, run?.cwd ?? process.cwd());
  if (!pick.profile) {
    console.log(`julius2claude: no other account to move to (${pick.reason})${pick.waitUntil ? `; the next one frees up at ${fmtReset(pick.waitUntil)}` : ""}.`);
    return 0;
  }
  if (argv.includes("--from-session") && run) {
    requestSwitch(pick.profile.name, "you asked");
    console.log(`julius2claude: moving this session to "${pick.profile.name}" when this reply ends.`);
  } else {
    mutateConfig((c) => void (c.active = pick.profile.name));
    console.log(`"${pick.profile.name}" is now the default for new sessions.`);
  }
  return 0;
}
function order(argv) {
  const cfg = requireSetup();
  for (const n of argv) getProfile(cfg, n);
  mutateConfig((c) => void (c.order = [...argv, ...c.order.filter((n) => !argv.includes(n))]));
  console.log(`Failover order: ${ordered(loadConfig()).map((p) => p.name).join(" \u2192 ")}`);
  return 0;
}
function bind(argv) {
  const cfg = requireSetup();
  const p = parse(argv);
  const [name, dirArg] = p._;
  if (!name) throw new UserError("usage: j2c bind <profile> [dir] [--strict]");
  getProfile(cfg, name);
  const dir = fs12.realpathSync(path10.resolve(dirArg ?? "."));
  mutateConfig((c) => {
    c.bindings = c.bindings.filter((b) => b.dir !== dir);
    c.bindings.push({ dir, profile: name, ...p.flags.strict ? { strict: true } : {} });
  });
  console.log(`${dir} \u2192 ${name}${p.flags.strict ? " (strict: no other account can run here)" : ""}`);
  return 0;
}
function unbind(argv) {
  requireSetup();
  const dir = fs12.realpathSync(path10.resolve(argv[0] ?? "."));
  mutateConfig((c) => void (c.bindings = c.bindings.filter((b) => b.dir !== dir)));
  console.log(`${dir} is no longer bound.`);
  return 0;
}
function auto(argv) {
  requireSetup();
  const p = parse(argv, ["5h", "weekly", "dwell"]);
  const mode = p._[0];
  if (mode !== "on" && mode !== "off") throw new UserError("usage: j2c auto on|off [--paid] [--5h N] [--weekly N] [--dwell MIN]");
  const num = (k, lo, hi) => {
    const v = str(p.flags[k]);
    if (v === void 0) return void 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new UserError(`--${k} must be between ${lo} and ${hi}`);
    return n;
  };
  const cfg = mutateConfig((c) => {
    c.autoSwitch.enabled = mode === "on";
    if (p.flags.paid !== void 0) c.autoSwitch.allowPaid = !!p.flags.paid;
    c.autoSwitch.fiveHourPct = num("5h", 50, 100) ?? c.autoSwitch.fiveHourPct;
    c.autoSwitch.weeklyPct = num("weekly", 50, 100) ?? c.autoSwitch.weeklyPct;
    c.autoSwitch.minDwellMin = num("dwell", 0, 600) ?? c.autoSwitch.minDwellMin;
  });
  if (mode === "off") console.log("Auto-switch is off. Claude Code's own wait-at-limit behaviour is back.");
  else {
    console.log(`Auto-switch is on: sessions move at the end of a turn when 5h \u2265 ${cfg.autoSwitch.fiveHourPct}% or weekly \u2265 ${cfg.autoSwitch.weeklyPct}%, or when an account refuses.`);
    console.log(cfg.autoSwitch.allowPaid ? "Paid profiles (Bedrock, API key\u2026) may be used as a fallback." : "Paid profiles are never used automatically (add --paid to allow).");
    console.log("Use only your own accounts. See the README section on Anthropic's terms.");
  }
  return 0;
}
async function recover(argv) {
  const cfg = requireSetup();
  const list = interruptedSessions().filter((s2) => fs12.existsSync(s2.cwd));
  if (!list.length) {
    console.log("No interrupted sessions. \u{1F389}");
    return 0;
  }
  const n = argv[0] ? Number(argv[0]) : void 0;
  if (n === void 0) {
    console.log("Sessions that were mid-reply when they died:\n");
    list.slice(0, 20).forEach((s2, i) => console.log(`  ${String(i + 1).padStart(2)}. ${new Date(s2.updatedAt).toLocaleString()}  ${s2.profile.padEnd(10)} ${s2.cwd}  (${s2.sessionId.slice(0, 8)})`));
    console.log("\nResume one with: j2c recover <number>");
    return 0;
  }
  const s = list[n - 1];
  if (!s) throw new UserError(`no session #${n}`);
  const prof = cfg.profiles.find((p) => p.name === s.profile);
  if (!prof) throw new UserError(`profile "${s.profile}" no longer exists; resume it by hand: claude --resume ${s.sessionId}`);
  const usage = loadUsage();
  const onProfile = usable(cfg, usage, prof).ok ? prof : pickNext(cfg, usage, prof, s.cwd).profile ?? prof;
  process.chdir(s.cwd);
  return supervise({
    profile: onProfile.name,
    args: ["--resume", s.sessionId, "[julius2claude] This session was interrupted (the machine, WSL or terminal died) in the middle of a reply. Check what the last tool call actually did, redo anything incomplete, then continue the task."],
    cwd: s.cwd
  });
}
var WINDOW_LABEL = {
  five_hour: "5-hour limit",
  seven_day: "weekly limit",
  seven_day_opus: "weekly Opus limit",
  seven_day_sonnet: "weekly Sonnet limit"
};
function usageView(argv) {
  const cfg = requireSetup();
  const usage = loadUsage();
  const color = !argv.includes("--plain") && !!process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code, s) => color ? `\x1B[${code}m${s}\x1B[0m` : s;
  const dim = (s) => paint("2", s);
  const runs = liveRuns();
  const current = process.env.J2C_RUN_ID ? loadRun(process.env.J2C_RUN_ID) : void 0;
  const statsBy = new Map(computeStats(cfg.profiles.map((p) => p.name)).map((s) => [s.profile, s]));
  const bar2 = (pct) => {
    const w = 24;
    const filled = Math.max(0, Math.min(w, Math.round(pct / 100 * w)));
    const c = pct >= 90 ? "31" : pct >= 70 ? "33" : "32";
    return paint(c, "\u2588".repeat(filled)) + dim("\u2591".repeat(w - filled));
  };
  const lines = [];
  lines.push(`julius2claude \xB7 auto-switch ${cfg.autoSwitch.enabled ? "on" : "off"} \xB7 order ${ordered(cfg).map((p) => p.name).join(" \u2192 ")}`);
  lines.push("");
  for (const p of ordered(cfg)) {
    const u = usage[p.name];
    const v = usable(cfg, usage, p);
    const tags = [
      current?.profile === p.name ? "this session" : "",
      cfg.active === p.name ? "default" : "",
      runs.filter((r) => r.profile === p.name).length ? `${runs.filter((r) => r.profile === p.name).length} running` : ""
    ].filter(Boolean);
    const who = p.account?.email ? `${p.account.email}${p.account.org ? ` \xB7 ${p.account.org}` : ""}` : p.provider;
    lines.push(`${paint("1", p.name.padEnd(10))} ${who}${tags.length ? dim(`  [${tags.join(", ")}]`) : ""}`);
    if (p.provider !== "claude") {
      lines.push(`  ${dim("pay-per-token, no 5h or weekly limits")}`);
    } else {
      for (const [label, w] of [["5h", u?.fiveHour], ["week", u?.sevenDay]]) {
        const pct = livePct(w);
        if (pct === void 0) lines.push(`  ${label.padEnd(5)} ${dim("unknown until a session runs on this account")}`);
        else lines.push(`  ${label.padEnd(5)} ${bar2(pct)} ${String(Math.round(pct)).padStart(3)}%  ${dim(w && w.resetsAt > Date.now() / 1e3 ? `resets ${fmtReset(w.resetsAt)}` : "")}`);
      }
    }
    if (!v.ok) lines.push(`  ${paint("31", `blocked: ${v.reason}${v.availableAt ? ` \xB7 back ${fmtReset(v.availableAt)}` : ""}`)}`);
    const s = statsBy.get(p.name);
    if (s && sum(s.total)) lines.push(`  ${dim(`tokens ${fmtTokens(sum(s.last5h))} last 5h \xB7 ${fmtTokens(sum(s.last7d))} last 7 days`)}`);
    lines.push("");
  }
  console.log(lines.join("\n").trimEnd());
  return 0;
}
function stats(argv) {
  const cfg = requireSetup();
  const p = parse(argv, ["days"]);
  const days = str(p.flags.days) ? Number(str(p.flags.days)) : void 0;
  if (days !== void 0 && (!Number.isFinite(days) || days <= 0)) throw new UserError("--days must be a positive number");
  const since = days ? Math.floor(Date.now() / 1e3) - days * 86400 : 0;
  const rows = computeStats(ordered(cfg).map((x) => x.name), since);
  if (p.flags.json) {
    console.log(JSON.stringify({ schemaVersion: SCHEMA_VERSION, sinceEpochSec: since || null, profiles: rows }, null, 2));
    return 0;
  }
  const describe2 = (w, s, verb) => `${WINDOW_LABEL[w] ?? w}: ${verb} ${s.count} time${s.count === 1 ? "" : "s"}` + (s.avgElapsedSec !== void 0 ? `, after ${fmtDuration(s.avgElapsedSec)} on average` : "") + (s.avgTokens !== void 0 ? `, ~${fmtTokens(s.avgTokens)} tokens per window` : "");
  console.log(days ? `Last ${days} day(s). Tokens are counted from sessions started with j2c.
` : "Tokens are counted from sessions started with j2c.\n");
  for (const r of rows) {
    const prof = getProfile(cfg, r.profile);
    console.log(`${r.profile}${prof.account?.email ? ` (${prof.account.email})` : ` (${prof.provider})`}`);
    const t = r.total;
    console.log(`  tokens   last 5h ${fmtTokens(sum(r.last5h))} \xB7 last 7 days ${fmtTokens(sum(r.last7d))} \xB7 total ${fmtTokens(sum(t))}`);
    if (sum(t)) console.log(`           input ${fmtTokens(t.input)} \xB7 output ${fmtTokens(t.output)} \xB7 cache read ${fmtTokens(t.cacheRead)} \xB7 cache write ${fmtTokens(t.cacheWrite)}`);
    for (const [w, s] of Object.entries(r.limits)) console.log(`  ${describe2(w, s, "reached")}`);
    for (const [w, s] of Object.entries(r.thresholds)) console.log(`  ${describe2(w, s, "switched early")}`);
    if (!Object.keys(r.limits).length && !Object.keys(r.thresholds).length) console.log("  no limits reached yet");
    if (r.switchesOut || r.switchesIn) console.log(`  switches  ${r.switchesOut} away \xB7 ${r.switchesIn} onto this account`);
    console.log("");
  }
  return 0;
}
function doctor() {
  const cfg = requireSetup();
  let problems = 0;
  const ok = (m) => console.log(`  \u2713 ${m}`);
  const bad = (m) => {
    problems++;
    console.log(`  \u2717 ${m}`);
  };
  const warn = (m) => console.log(`  ! ${m}`);
  console.log("Claude Code");
  const v = claudeVersion();
  if (!v) bad("`claude` not found on PATH");
  else if (!versionAtLeast(v, "2.1.152")) bad(`Claude Code ${v}: resuming on another account needs \u2265 2.1.152 (claude update)`);
  else if (!versionAtLeast(v, "2.1.248")) warn(`Claude Code ${v}: parallel sessions on one account can race on token refresh before 2.1.248`);
  else ok(`Claude Code ${v}`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 18) bad(`Node ${process.versions.node} (need \u2265 18)`);
  else ok(`Node ${process.versions.node}`);
  console.log("Environment");
  const leaks = AUTH_ENV_KEYS.filter((k) => process.env[k] && k !== "CLAUDE_CONFIG_DIR");
  if (leaks.length) warn(`${leaks.join(", ")} set in your shell: plain \`claude\` would use it instead of your login. j2c removes it for its sessions (use --keep-env to keep it).`);
  else ok("no auth overrides in your shell");
  if (process.env.CLAUDE_CONFIG_DIR) warn(`CLAUDE_CONFIG_DIR=${process.env.CLAUDE_CONFIG_DIR} is set in your shell; j2c ignores it and uses each profile's own folder.`);
  const dotenv = path10.join(process.cwd(), ".env");
  if (fs12.existsSync(dotenv) && /^\s*(export\s+)?ANTHROPIC_(API_KEY|AUTH_TOKEN)\s*=/m.test(fs12.readFileSync(dotenv, "utf8")))
    warn(".env in this folder defines an Anthropic key; some tools load it automatically and bill it instead of your plan.");
  if (fs12.existsSync(path10.join(commandsDir(), "use.md"))) ok("/j2c:* commands installed");
  else bad("/j2c:* commands missing (run `j2c setup`)");
  console.log("Profiles");
  for (const p of ordered(cfg)) {
    const st = loginState(p);
    const issues = [];
    if (st === "needs-login") issues.push(`not logged in \u2192 j2c login ${p.name}`);
    const cred = readCredentials(p);
    if (st === "ok" && cred?.refreshTokenExpiresAt && cred.refreshTokenExpiresAt - Date.now() < 3 * 864e5)
      warn(`${p.name}: login expires ${new Date(cred.refreshTokenExpiresAt).toLocaleDateString()}; start one session on it (\`j2c -P ${p.name}\`) to renew it`);
    if (!p.isMain) {
      if (!fs12.existsSync(p.configDir)) issues.push("folder missing \u2192 j2c login " + p.name);
      else {
        const link = path10.join(p.configDir, "projects");
        try {
          if (!fs12.lstatSync(link).isSymbolicLink() || fs12.realpathSync(link) !== fs12.realpathSync(path10.join(groupStore(p.group), "projects")))
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
  if (!fs12.existsSync(stale)) warn(`${stale} not found; is Claude Code set up for this user?`);
  console.log(problems ? `
${problems} problem(s) found.` : "\nAll good.");
  return problems ? 1 : 0;
}
var isEntry = (() => {
  try {
    return fs12.realpathSync(process.argv[1] ?? "") === fs12.realpathSync(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof UserError) process.stderr.write(`j2c: ${err.message}
`);
      else process.stderr.write(`j2c: unexpected error: ${err?.stack ?? err}
(log: ${paths.log()})
`);
      process.exit(1);
    }
  );
}
export {
  SCHEMA_VERSION,
  main
};
