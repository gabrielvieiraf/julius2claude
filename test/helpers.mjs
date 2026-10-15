import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const BIN = path.join(ROOT, "dist", "j2c.mjs");
export const FAKE = path.join(here, "fake-claude.mjs");
export const lib = (m) => import(path.join(ROOT, ".test-build", `${m}.js`));

export function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "j2c-test-"));
  const env = {
    J2C_HOME: path.join(root, "j2c"),
    J2C_CLAUDE_DIR: path.join(root, "claude"),
    J2C_CLAUDE_JSON: path.join(root, "claude.json"),
    J2C_CLAUDE_BIN: FAKE,
    FAKE_LOG: path.join(root, "fake.log"),
    FAKE_ID: path.basename(root),
    J2C_NO_CLIPBOARD: "1",
    J2C_SHIM_DIR: path.join(root, "shims"),
  };
  fs.mkdirSync(env.J2C_CLAUDE_DIR, { recursive: true });
  fs.mkdirSync(env.J2C_SHIM_DIR, { recursive: true });
  const work = path.join(root, "repo");
  fs.mkdirSync(work);
  return {
    root,
    env,
    work,
    activate() {
      Object.assign(process.env, env);
    },
    j2c(args, extraEnv = {}, opts = {}) {
      const r = spawnSync(process.execPath, [BIN, ...args], {
        cwd: opts.cwd ?? work,
        env: { ...cleanEnv(), ...env, ...extraEnv },
        encoding: "utf8",
        input: opts.input ?? "",
        timeout: opts.timeout ?? 60_000,
      });
      return { code: r.status, out: r.stdout, err: r.stderr };
    },
    j2cAsync(args, extraEnv = {}, opts = {}) {
      return new Promise((resolve) => {
        const c = spawn(process.execPath, [BIN, ...args], { cwd: opts.cwd ?? work, env: { ...cleanEnv(), ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
        let out = "", err = "";
        c.stdout.on("data", (d) => (out += d));
        c.stderr.on("data", (d) => (err += d));
        const t = setTimeout(() => c.kill("SIGKILL"), opts.timeout ?? 60_000);
        c.on("exit", (code) => {
          clearTimeout(t);
          resolve({ code, out, err });
        });
      });
    },
    events() {
      try {
        return fs.readFileSync(env.FAKE_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    read(rel) {
      return JSON.parse(fs.readFileSync(path.join(env.J2C_HOME, rel), "utf8"));
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function cleanEnv() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (/^(ANTHROPIC_|CLAUDE_|J2C_|FAKE_|AWS_)/.test(k)) delete e[k];
  return e;
}

export function withAccounts(sb, names = ["work"]) {
  sb.j2c(["setup"]);
  spawnSync(process.execPath, [FAKE, "auth", "login"], { env: { ...cleanEnv(), ...sb.env, FAKE_ACCOUNT: "me@personal.dev" } });
  sb.j2c(["setup"]);
  for (const n of names) {
    const r = sb.j2c(["add", n], { FAKE_ACCOUNT: `me@${n}.dev` });
    if (r.code !== 0) throw new Error(`add ${n} failed: ${r.err}${r.out}`);
  }
}
