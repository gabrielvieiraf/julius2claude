import fs from "node:fs";
import path from "node:path";
import { type Config } from "./config.js";

const MARKER = "julius2claude-shim";

export function shimDir(): string {
  if (process.env.J2C_SHIM_DIR) return process.env.J2C_SHIM_DIR;
  return path.dirname(process.argv[1] ?? process.execPath);
}

function shimPath(dir: string, profile: string): string {
  return path.join(dir, process.platform === "win32" ? `claude-${profile}.cmd` : `claude-${profile}`);
}

function body(dir: string, profile: string): string {
  if (process.platform === "win32") return `@echo off\r\nrem ${MARKER}\r\nj2c -P ${profile} %*\r\n`;
  const j2c = fs.existsSync(path.join(dir, "j2c")) ? path.join(dir, "j2c") : "j2c";
  return `#!/bin/sh\n# ${MARKER}\nexec "${j2c}" -P ${profile} "$@"\n`;
}

function ours(file: string): boolean {
  try {
    return fs.readFileSync(file, "utf8").includes(MARKER);
  } catch {
    return false;
  }
}

export interface ShimResult {
  created: string[];
  skipped: string[];
  removed: string[];
}

export function syncShims(cfg: Config, dir = shimDir()): ShimResult {
  const res: ShimResult = { created: [], skipped: [], removed: [] };
  const wanted = new Set(cfg.profiles.map((p) => shimPath(dir, p.name)));
  for (const p of cfg.profiles) {
    const file = shimPath(dir, p.name);
    if (fs.existsSync(file) && !ours(file)) {
      res.skipped.push(file);
      continue;
    }
    const content = body(dir, p.name);
    let cur = "";
    try {
      cur = fs.readFileSync(file, "utf8");
    } catch {}
    if (cur !== content) {
      try {
        fs.writeFileSync(file, content, { mode: 0o755 });
        res.created.push(file);
      } catch {
        res.skipped.push(file);
      }
    }
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.startsWith("claude-"));
  } catch {}
  for (const n of names) {
    const file = path.join(dir, n);
    if (!wanted.has(file) && ours(file)) {
      fs.rmSync(file, { force: true });
      res.removed.push(file);
    }
  }
  return res;
}

export function removeAllShims(dir = shimDir()): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.startsWith("claude-"));
  } catch {}
  for (const n of names) {
    const file = path.join(dir, n);
    if (ours(file)) {
      fs.rmSync(file, { force: true });
      removed.push(file);
    }
  }
  return removed;
}
