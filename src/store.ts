import fs from "node:fs";
import path from "node:path";
import { paths } from "./paths.js";

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown, mode = 0o600): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
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

export function updateJson<T>(file: string, fallback: T, fn: (cur: T) => T | void): T {
  return withLock(file, () => {
    const cur = readJson(file, fallback);
    const next = (fn(cur) ?? cur) as T;
    writeJson(file, next);
    return next;
  });
}

const LOCK_STALE_MS = 10_000;

export function withLock<R>(target: string, fn: () => R): R {
  const lock = `${target}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { force: true });
      } catch {}
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

export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function log(msg: string): void {
  try {
    fs.mkdirSync(path.dirname(paths.log()), { recursive: true });
    fs.appendFileSync(paths.log(), `${new Date().toISOString()} [${process.pid}] ${msg}\n`);
  } catch {}
}
