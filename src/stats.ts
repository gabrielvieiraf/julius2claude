import fs from "node:fs";
import path from "node:path";
import { paths } from "./paths.js";
import { readJson, updateJson } from "./store.js";

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface FileCursor {
  offset: number;
  lastId?: string;
  touchedAt: number;
}

interface Ledger {
  version: 1;
  profiles: Record<string, { total: Tokens; hours: Record<string, Tokens> }>;
  files: Record<string, FileCursor>;
}

export type EventType = "limit" | "threshold" | "switch";

export interface StatEvent {
  at: number;
  type: EventType;
  profile: string;
  window?: string;
  resetsAt?: number;
  elapsedSec?: number;
  tokensInWindow?: number;
  to?: string;
  reason?: string;
}

export const WINDOW_SEC: Record<string, number> = {
  five_hour: 5 * 3600,
  seven_day: 7 * 86400,
  seven_day_opus: 7 * 86400,
  seven_day_sonnet: 7 * 86400,
  seven_day_overage_included: 7 * 86400,
};

const HOUR = 3600;
const KEEP_HOURS_SEC = 35 * 86400;
const KEEP_FILES_MS = 30 * 86400e3;

const ledgerFile = () => path.join(paths.stateDir(), "tokens.json");
const eventsFile = () => path.join(paths.stateDir(), "events.jsonl");
const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
export const sum = (t: Tokens) => t.input + t.output + t.cacheRead + t.cacheWrite;

function add(a: Tokens, u: any): void {
  a.input += u.input_tokens ?? 0;
  a.output += u.output_tokens ?? 0;
  a.cacheRead += u.cache_read_input_tokens ?? 0;
  a.cacheWrite += u.cache_creation_input_tokens ?? 0;
}

function emptyLedger(): Ledger {
  return { version: 1, profiles: {}, files: {} };
}

export function loadLedger(): Ledger {
  return readJson<Ledger>(ledgerFile(), emptyLedger());
}

function readFrom(file: string, offset: number): { text: string; end: number } | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (size < offset) offset = 0;
    if (size === offset) return { text: "", end: offset };
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl === -1) return { text: "", end: offset };
    return { text: buf.subarray(0, lastNl + 1).toString("utf8"), end: offset + lastNl + 1 };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function real(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

function transcriptFiles(transcript: string): string[] {
  const files = [real(transcript)];
  const sub = path.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  try {
    for (const f of fs.readdirSync(sub)) if (f.endsWith(".jsonl")) files.push(real(path.join(sub, f)));
  } catch {}
  return files;
}

export function ingestTranscript(transcript: string | undefined, profile: string, sinceMs = 0): void {
  if (!transcript) return;
  updateJson<Ledger>(ledgerFile(), emptyLedger(), (l) => {
    const now = Date.now();
    const p = (l.profiles[profile] ??= { total: zero(), hours: {} });
    for (const file of transcriptFiles(transcript)) {
      const isNew = !l.files[file];
      const cur = l.files[file] ?? { offset: 0, touchedAt: now };
      const chunk = readFrom(file, cur.offset);
      if (!chunk) continue;
      let lastId = cur.lastId;
      for (const line of chunk.text.split("\n")) {
        if (!line.includes('"usage"')) continue;
        let o: any;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        const msg = o.message;
        if (o.type !== "assistant" || !msg?.usage || o.isApiErrorMessage) continue;
        const at = Date.parse(o.timestamp ?? "") || now;
        if (isNew && at < sinceMs) continue;
        const id: string | undefined = msg.id ?? o.requestId;
        if (id && id === lastId) continue;
        lastId = id;
        add(p.total, msg.usage);
        const ts = Math.floor(at / 1000);
        const hour = String(ts - (ts % HOUR));
        add((p.hours[hour] ??= zero()), msg.usage);
      }
      l.files[file] = { offset: chunk.end, lastId, touchedAt: now };
    }
    const cutoff = Math.floor(now / 1000) - KEEP_HOURS_SEC;
    for (const prof of Object.values(l.profiles))
      for (const h of Object.keys(prof.hours)) if (Number(h) < cutoff) delete prof.hours[h];
    for (const [f, c] of Object.entries(l.files)) if (now - c.touchedAt > KEEP_FILES_MS) delete l.files[f];
  });
}

export function tokensBetween(l: Ledger, profile: string, fromSec: number, toSec: number): Tokens {
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

export function recordEvent(e: Omit<StatEvent, "at"> & { at?: number }): void {
  const ev: StatEvent = { at: Math.floor(Date.now() / 1000), ...e };
  if ((ev.type === "limit" || ev.type === "threshold") && ev.window && ev.resetsAt && WINDOW_SEC[ev.window]) {
    const start = ev.resetsAt - WINDOW_SEC[ev.window];
    ev.elapsedSec = Math.max(0, ev.at - start);
    ev.tokensInWindow = sum(tokensBetween(loadLedger(), ev.profile, start, ev.at));
  }
  fs.mkdirSync(path.dirname(eventsFile()), { recursive: true });
  fs.appendFileSync(eventsFile(), JSON.stringify(ev) + "\n");
}

export function loadEvents(sinceSec = 0): StatEvent[] {
  let text = "";
  try {
    text = fs.readFileSync(eventsFile(), "utf8");
  } catch {}
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as StatEvent;
      } catch {
        return undefined;
      }
    })
    .filter((e): e is StatEvent => !!e && e.at >= sinceSec);
}

export interface WindowStats {
  count: number;
  avgElapsedSec?: number;
  avgTokens?: number;
}

export interface ProfileStats {
  profile: string;
  total: Tokens;
  last5h: Tokens;
  last7d: Tokens;
  limits: Record<string, WindowStats>;
  thresholds: Record<string, WindowStats>;
  switchesOut: number;
  switchesIn: number;
}

function windowStats(events: StatEvent[]): Record<string, WindowStats> {
  const by: Record<string, StatEvent[]> = {};
  for (const e of events) if (e.window) (by[e.window] ??= []).push(e);
  const out: Record<string, WindowStats> = {};
  for (const [w, list] of Object.entries(by)) {
    const el = list.map((e) => e.elapsedSec).filter((x): x is number => typeof x === "number");
    const tk = list.map((e) => e.tokensInWindow).filter((x): x is number => typeof x === "number" && x > 0);
    out[w] = {
      count: list.length,
      ...(el.length ? { avgElapsedSec: Math.round(el.reduce((a, b) => a + b, 0) / el.length) } : {}),
      ...(tk.length ? { avgTokens: Math.round(tk.reduce((a, b) => a + b, 0) / tk.length) } : {}),
    };
  }
  return out;
}

export function computeStats(profiles: string[], sinceSec = 0, nowSec = Math.floor(Date.now() / 1000)): ProfileStats[] {
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
      switchesIn: events.filter((e) => e.type === "switch" && e.to === name).length,
    };
  });
}

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function fmtDuration(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}
