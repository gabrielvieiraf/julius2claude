import { spawnSync } from "node:child_process";
import { loadConfig, getProfile } from "./config.js";
import { pickNext, shouldLeave, usable } from "./router.js";
import { loadRun, mutateRun } from "./runs.js";
import { livePct, loadUsage, mutateUsage, recordStatusline } from "./usage.js";
import { readStdin } from "./hooks.js";
import { recordEvent } from "./stats.js";
import { BOUNDARY_MS } from "./runs.js";

export async function runStatusline(runId: string | undefined, wrapped: string | undefined): Promise<string> {
  const raw = await readStdin();
  const run = runId ? loadRun(runId) : undefined;
  const cfg = loadConfig();
  const profileName = run?.profile ?? process.env.J2C_PROFILE;
  const lines: string[] = [];

  if (profileName && cfg.profiles.some((p) => p.name === profileName)) {
    if (raw.rate_limits) recordStatusline(profileName, raw.rate_limits);
    const usage = loadUsage();
    const profile = getProfile(cfg, profileName);
    const u = usage[profileName];
    const parts = [`j2c ${profileName}`];
    const five = livePct(u?.fiveHour);
    const seven = livePct(u?.sevenDay);
    if (five !== undefined) parts.push(`5h ${bar(five)} ${Math.round(five)}%`);
    if (seven !== undefined) parts.push(`7d ${Math.round(seven)}%`);

    if (run && cfg.autoSwitch.enabled && !run.pendingSwitch && shouldLeave(cfg, usage, profile, false)) {
      const next = pickNext(cfg, usage, profile, run.cwd);
      if (next.profile) {
        const weekly = (livePct(u?.sevenDay) ?? 0) >= cfg.autoSwitch.weeklyPct;
        const win = weekly ? u?.sevenDay : u?.fiveHour;
        recordEvent({ type: "threshold", profile: profileName, window: weekly ? "seven_day" : "five_hour", resetsAt: win?.resetsAt });
        const justStopped = !run.busy && run.lastStopAt && Date.now() - run.lastStopAt < BOUNDARY_MS;
        mutateRun(run.id, (r) => {
          r.pendingSwitch ??= {
            reason: usable(cfg, usage, profile).reason ?? "threshold",
            requestedAt: justStopped ? run.lastStopAt! : Date.now(),
            hard: false,
          };
        });
      }
    }
    const fresh = run ? loadRun(run.id) : undefined;
    if (fresh?.pendingSwitch) parts.push(`↪ switching at end of turn (${fresh.pendingSwitch.reason})`);
    else if (!usable(cfg, usage, profile).ok) {
      const next = pickNext(cfg, usage, profile, run?.cwd ?? process.cwd());
      parts.push(next.profile ? `⚠ ${usable(cfg, usage, profile).reason} · /j2c:next → ${next.profile.name}` : `⚠ ${usable(cfg, usage, profile).reason}`);
    }
    lines.push(parts.join(" · "));
    if (u && !u.enteredAt) mutateUsage((s) => void ((s[profileName] ??= {}).enteredAt = Date.now()));
  }

  if (wrapped) {
    const r = spawnSync(wrapped, { shell: true, input: JSON.stringify(raw), encoding: "utf8", timeout: 3_000 });
    const out = (r.stdout ?? "").trimEnd();
    if (out) lines.push(out);
  }
  return lines.join("\n");
}

function bar(pct: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(pct / 20)));
  return "▰".repeat(filled) + "▱".repeat(5 - filled);
}
