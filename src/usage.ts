import fs from "node:fs";
import { paths } from "./paths.js";
import { readJson, updateJson } from "./store.js";

export interface Window {
  pct: number;
  resetsAt: number;
}

export interface Block {
  until: number;
  reason: string;
  type?: string;
}

export interface ProfileUsage {
  fiveHour?: Window;
  sevenDay?: Window;
  blocks?: Block[];
  updatedAt?: number;
  enteredAt?: number;
  transient429?: number[];
}

export type UsageState = Record<string, ProfileUsage>;

export const nowS = () => Math.floor(Date.now() / 1000);

export function loadUsage(): UsageState {
  return readJson<UsageState>(paths.usage(), {});
}

export function mutateUsage(fn: (u: UsageState) => void): UsageState {
  return updateJson<UsageState>(paths.usage(), {}, (u) => {
    fn(u);
  });
}

export function livePct(w: Window | undefined, now = nowS()): number | undefined {
  if (!w) return undefined;
  return w.resetsAt <= now ? 0 : w.pct;
}

export function activeBlocks(u: ProfileUsage | undefined, now = nowS()): Block[] {
  return (u?.blocks ?? []).filter((b) => b.until === 0 || b.until > now);
}

export function recordStatusline(profile: string, rateLimits: any): void {
  if (!rateLimits || typeof rateLimits !== "object") return;
  const toWin = (w: any): Window | undefined =>
    w && typeof w.used_percentage === "number" && typeof w.resets_at === "number"
      ? { pct: w.used_percentage, resetsAt: w.resets_at }
      : undefined;
  const five = toWin(rateLimits.five_hour);
  const seven = toWin(rateLimits.seven_day);
  if (!five && !seven) return;
  mutateUsage((u) => {
    const cur = (u[profile] ??= {});
    if (five) cur.fiveHour = five;
    if (seven) cur.sevenDay = seven;
    cur.updatedAt = Date.now();
    const now = nowS();
    for (const [w, type, label] of [[five, "five_hour", "5-hour limit"], [seven, "seven_day", "weekly limit"]] as const) {
      if (!w || w.pct < 100 || w.resetsAt <= now) continue;
      cur.blocks = [
        ...(cur.blocks ?? []).filter((b) => (b.until === 0 || b.until > now) && b.type !== type),
        { until: w.resetsAt, reason: `${label} reached`, type },
      ];
    }
  });
}

export function fmtWait(at: number, now = nowS()): string {
  const d = new Date(at * 1000);
  const sameDay = d.toDateString() === new Date(now * 1000).toDateString();
  const when = sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const left = Math.max(0, at - now);
  const h = Math.floor(left / 3600);
  const m = Math.ceil((left % 3600) / 60);
  return `${when} (in ${h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`})`;
}

export interface QuotaRefusal {
  rateLimitType?: string;
  resetsAt?: number;
  at: number;
}

export function findQuotaRefusal(transcriptPath: string, sinceMs: number): QuotaRefusal | undefined {
  const tail = readTail(transcriptPath, 256 * 1024);
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"quotaLimits"')) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const q = o.quotaLimits;
    const at = Date.parse(o.timestamp ?? "") || 0;
    if (at && at < sinceMs) return undefined;
    if (q?.status === "rejected") return { rateLimitType: q.rateLimitType, resetsAt: q.resetsAt, at };
  }
  return undefined;
}

function readTail(file: string, bytes: number): string {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const s = buf.toString("utf8");
    return len < size ? s.slice(s.indexOf("\n") + 1) : s;
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
