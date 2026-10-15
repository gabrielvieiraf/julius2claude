import os from "node:os";
import path from "node:path";

export function j2cHome(): string {
  return process.env.J2C_HOME || path.join(os.homedir(), ".julius2claude");
}

export function defaultClaudeDir(): string {
  return process.env.J2C_CLAUDE_DIR || path.join(os.homedir(), ".claude");
}

export function defaultClaudeJson(): string {
  return process.env.J2C_CLAUDE_JSON || path.join(os.homedir(), ".claude.json");
}

export const paths = {
  config: () => path.join(j2cHome(), "config.json"),
  profilesDir: () => path.join(j2cHome(), "profiles"),
  profileDir: (name: string) => path.join(j2cHome(), "profiles", name),
  stateDir: () => path.join(j2cHome(), "state"),
  usage: () => path.join(j2cHome(), "state", "usage.json"),
  runsDir: () => path.join(j2cHome(), "state", "runs"),
  run: (id: string) => path.join(j2cHome(), "state", "runs", `${id}.json`),
  sessionsDir: () => path.join(j2cHome(), "state", "sessions"),
  session: (id: string) => path.join(j2cHome(), "state", "sessions", `${id}.json`),
  log: () => path.join(j2cHome(), "j2c.log"),
};
