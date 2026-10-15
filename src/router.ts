import path from "node:path";
import { type Config, type Profile, PAID, ordered } from "./config.js";
import { loginState } from "./profiles.js";
import { type UsageState, activeBlocks, livePct, nowS } from "./usage.js";

export interface Verdict {
  ok: boolean;
  reason?: string;
  availableAt?: number;
}

export function usable(cfg: Config, usage: UsageState, p: Profile, now = nowS()): Verdict {
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
  if (seven !== undefined && seven >= cfg.autoSwitch.weeklyPct)
    return { ok: false, reason: `weekly at ${Math.round(seven)}%`, availableAt: u!.sevenDay!.resetsAt };
  if (five !== undefined && five >= cfg.autoSwitch.fiveHourPct)
    return { ok: false, reason: `5h at ${Math.round(five)}%`, availableAt: u!.fiveHour!.resetsAt };
  return { ok: true };
}

export function bindingFor(cfg: Config, cwd: string) {
  const abs = path.resolve(cwd);
  return cfg.bindings
    .filter((b) => abs === b.dir || abs.startsWith(b.dir.endsWith(path.sep) ? b.dir : b.dir + path.sep))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
}

export function allowedIn(cfg: Config, cwd: string): Profile[] {
  const b = bindingFor(cfg, cwd);
  if (b?.strict) return cfg.profiles.filter((p) => p.name === b.profile);
  return cfg.profiles;
}

export interface Pick {
  profile?: Profile;
  waitUntil?: number;
  reason?: string;
}

export function pickNext(cfg: Config, usage: UsageState, from: Profile | undefined, cwd: string, now = nowS()): Pick {
  const group = from?.group ?? "default";
  const allowed = new Set(allowedIn(cfg, cwd).map((p) => p.name));
  const candidates = ordered(cfg).filter(
    (p) =>
      p.name !== from?.name &&
      !p.paused &&
      allowed.has(p.name) &&
      (p.group ?? "default") === group &&
      (!PAID.has(p.provider) || cfg.autoSwitch.allowPaid),
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
    waitUntil: Number.isFinite(soonest) ? soonest : undefined,
    reason: candidates.length ? "every eligible account is at its limit" : "no other eligible account in this group",
  };
}

export function shouldLeave(cfg: Config, usage: UsageState, p: Profile, hardRefused: boolean, now = nowS()): boolean {
  if (hardRefused) return true;
  if (usable(cfg, usage, p, now).ok) return false;
  if (activeBlocks(usage[p.name], now).length) return true;
  const entered = usage[p.name]?.enteredAt ?? 0;
  return Date.now() - entered >= cfg.autoSwitch.minDwellMin * 60_000;
}

export function pickStart(cfg: Config, usage: UsageState, cwd: string, explicit?: string): Pick & { bound?: boolean } {
  const allowed = allowedIn(cfg, cwd);
  if (explicit) {
    const p = allowed.find((x) => x.name === explicit);
    return p ? { profile: p } : { reason: `"${explicit}" is not allowed here (strict binding)` };
  }
  const b = bindingFor(cfg, cwd);
  const preferred = cfg.profiles.find((p) => p.name === (b?.profile ?? cfg.active)) ?? cfg.profiles[0];
  if (preferred.paused && !b) {
    const next = pickNext(cfg, usage, preferred, cwd);
    if (next.profile) return next;
  }
  if (!cfg.autoSwitch.enabled || usable(cfg, usage, preferred).ok) return { profile: preferred, bound: !!b };
  const next = pickNext(cfg, usage, preferred, cwd);
  return next.profile ? next : { profile: preferred, bound: !!b, ...next };
}
