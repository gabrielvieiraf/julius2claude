import fs from "node:fs";
import path from "node:path";
import { loadConfig, getProfile } from "./config.js";
import { shouldLeave } from "./router.js";
import { loadRun, mutateRun, recordSession, type Run } from "./runs.js";
import { log } from "./store.js";
import { ingestTranscript, recordEvent } from "./stats.js";
import { findQuotaRefusal, loadUsage, mutateUsage, nowS, type QuotaRefusal } from "./usage.js";

const HARD_ERRORS: Record<string, string> = {
  authentication_failed: "login failed (run `j2c login <profile>`)",
  oauth_org_not_allowed: "organization does not allow this login here",
  account_on_hold: "account on hold",
  billing_error: "billing problem on this account",
  verification_required: "account needs verification",
};

const TRANSIENT_WINDOW_MS = 10 * 60_000;
const TRANSIENT_LIMIT = 3;

export async function readStdin(): Promise<any> {
  if (process.stdin.isTTY) return {};
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export async function runHook(event: string, runId: string | undefined, input?: any): Promise<void> {
  const data = input ?? (await readStdin());
  if (!runId) return;
  const run = loadRun(runId);
  if (!run) return;
  if (event === "subagent-start" || event === "subagent-stop") {
    const id: string | undefined = data.agent_id;
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
  const sid: string | undefined = data.session_id;
  if (event !== "session-start" && run.sessionId && sid && sid !== run.sessionId) return;

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

function record(run: Run, sessionId: string, state: "busy" | "idle" | "ended", transcriptPath?: string) {
  recordSession({
    sessionId,
    state,
    profile: run.profile,
    cwd: run.cwd,
    runId: run.id,
    supervisorPid: run.pid,
    ...(transcriptPath ? { transcriptPath } : {}),
  });
}

function onStopFailure(run: Run, data: any): void {
  const error: string = data.error ?? data.error_type ?? "unknown";
  const now = Date.now();
  ingestTranscript(data.transcript_path ?? run.transcriptPath, run.profile, run.startedAt);
  mutateRun(run.id, (r) => {
    r.busy = false;
    r.lastStopAt = now;
  });
  if (data.session_id) record(run, data.session_id, "idle");
  if (run.pendingSwitch || (run.lastFailureAt && now - run.lastFailureAt < 5_000)) return;
  mutateRun(run.id, (r) => void (r.lastFailureAt = now));

  let hard = false;
  if (HARD_ERRORS[error]) {
    hard = true;
    mutateUsage((u) => {
      const cur = (u[run.profile] ??= {});
      cur.blocks = [...(cur.blocks ?? []), { until: 0, reason: HARD_ERRORS[error], type: "auth" }];
    });
  } else if (error === "rate_limit") {
    const refusal = findRefusal(run, data.transcript_path ?? run.transcriptPath);
    if (refusal?.resetsAt) {
      hard = true;
      recordEvent({ type: "limit", profile: run.profile, window: refusal.rateLimitType, resetsAt: refusal.resetsAt });
      const label = limitLabel(refusal.rateLimitType);
      mutateUsage((u) => {
        const cur = (u[run.profile] ??= {});
        cur.blocks = [
          ...(cur.blocks ?? []).filter((b) => b.until === 0 || b.until > nowS()),
          { until: refusal.resetsAt!, reason: `${label} reached`, type: refusal.rateLimitType },
        ];
      });
    } else {
      mutateUsage((u) => {
        const cur = (u[run.profile] ??= {});
        cur.transient429 = [...(cur.transient429 ?? []).filter((t) => now - t < TRANSIENT_WINDOW_MS), now];
        if (cur.transient429.length >= TRANSIENT_LIMIT) {
          cur.blocks = [...(cur.blocks ?? []), { until: nowS() + 600, reason: "repeated 429 errors", type: "transient" }];
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

function findRefusal(run: Run, transcript: string | undefined): QuotaRefusal | undefined {
  if (!transcript) return undefined;
  const since = run.childStartedAt ?? run.startedAt;
  const main = findQuotaRefusal(transcript, since);
  if (main) return main;
  const subDir = path.join(transcript.replace(/\.jsonl$/, ""), "subagents");
  let best: QuotaRefusal | undefined;
  try {
    for (const f of fs.readdirSync(subDir)) {
      if (!f.endsWith(".jsonl")) continue;
      const r = findQuotaRefusal(path.join(subDir, f), since);
      if (r && (!best || r.at > best.at)) best = r;
    }
  } catch {}
  return best;
}

export function limitLabel(type: string | undefined): string {
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
