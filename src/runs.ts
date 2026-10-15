import fs from "node:fs";
import { paths } from "./paths.js";
import { readJson, updateJson, writeJson } from "./store.js";

export interface Run {
  id: string;
  pid: number;
  childPid?: number;
  profile: string;
  cwd: string;
  sessionId?: string;
  transcriptPath?: string;
  busy: boolean;
  lastStopAt?: number;
  childStartedAt?: number;
  pendingSwitch?: { to?: string; reason: string; requestedAt: number; hard: boolean };
  agents?: string[];
  baselineChildren?: number;
  lastFailureAt?: number;
  noBinding?: boolean;
  live?: { permissionMode?: string; effort?: string; model?: string };
  lastSwitch?: { from: string; to: string; reason: string; at: number; fromOrg?: string; toOrg?: string };
  startedAt: number;
}

export const BOUNDARY_MS = 3_000;

export function loadRun(id: string): Run | undefined {
  return readJson<Run | undefined>(paths.run(id), undefined);
}

export function saveRun(run: Run): void {
  writeJson(paths.run(run.id), run);
}

export function mutateRun(id: string, fn: (r: Run) => void): Run | undefined {
  if (!fs.existsSync(paths.run(id))) return undefined;
  return updateJson<Run | undefined>(paths.run(id), undefined, (r) => {
    if (r) fn(r);
  });
}

export function removeRun(id: string): void {
  fs.rmSync(paths.run(id), { force: true });
}

export function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
}

export function liveRuns(): Run[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(paths.runsDir()).filter((n) => n.endsWith(".json"));
  } catch {}
  return names.map((n) => loadRun(n.slice(0, -5))).filter((r): r is Run => !!r && alive(r.pid));
}

export interface SessionRecord {
  sessionId: string;
  profile: string;
  cwd: string;
  transcriptPath?: string;
  runId?: string;
  supervisorPid?: number;
  state: "busy" | "idle" | "ended";
  updatedAt: number;
  title?: string;
}

export function recordSession(rec: Partial<SessionRecord> & { sessionId: string }): void {
  updateJson<SessionRecord | null>(paths.session(rec.sessionId), null, (cur) => ({
    ...(cur ?? { profile: "?", cwd: process.cwd(), state: "idle" }),
    ...rec,
    updatedAt: Date.now(),
  }) as SessionRecord);
}

export function interruptedSessions(): SessionRecord[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(paths.sessionsDir()).filter((n) => n.endsWith(".json"));
  } catch {}
  return names
    .map((n) => readJson<SessionRecord | null>(`${paths.sessionsDir()}/${n}`, null))
    .filter((s): s is SessionRecord => !!s && s.state === "busy" && !alive(s.supervisorPid))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
