import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

export function descendants(root: number): number[] {
  if (process.platform === "win32") return [];
  let out = "";
  try {
    out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }
  const kids = new Map<number, number[]>();
  for (const line of out.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid || !ppid) continue;
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid)!.push(pid);
  }
  const res: number[] = [];
  const stack = [...(kids.get(root) ?? [])];
  while (stack.length) {
    const p = stack.pop()!;
    if (p === process.pid) continue;
    res.push(p);
    stack.push(...(kids.get(p) ?? []));
  }
  return res;
}

export function signal(pids: number[], sig: NodeJS.Signals): void {
  for (const p of pids) {
    try {
      process.kill(p, sig);
    } catch {}
  }
}

export function saveTty(): string | undefined {
  if (process.platform === "win32" || !process.stdin.isTTY) return undefined;
  const r = spawnSync("stty", ["-g"], { stdio: ["inherit", "pipe", "ignore"], encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

export function restoreTty(saved: string | undefined): void {
  if (!process.stdout.isTTY) return;
  if (saved) spawnSync("stty", [saved], { stdio: ["inherit", "ignore", "ignore"] });
  try {
    fs.writeSync(1, "\x1b[=0u\x1b[<u\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1049l\x1b[?25h");
  } catch {}
}

export function claudeBin(): string {
  return process.env.J2C_CLAUDE_BIN || "claude";
}

export function claudeVersion(): string | undefined {
  try {
    const out = execFileSync(claudeBin(), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 });
    return out.match(/\d+\.\d+\.\d+/)?.[0];
  } catch {
    return undefined;
  }
}

export function versionAtLeast(v: string | undefined, min: string): boolean {
  if (!v) return false;
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
