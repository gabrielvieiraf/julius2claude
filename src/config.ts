import { paths, defaultClaudeDir } from "./paths.js";
import { readJson, updateJson, writeJson } from "./store.js";

export type Provider = "claude" | "bedrock" | "vertex" | "foundry" | "apikey";

export interface Profile {
  name: string;
  provider: Provider;
  configDir: string;
  env?: Record<string, string>;
  account?: { email?: string; org?: string; plan?: string; uuid?: string };
  isMain?: boolean;
  group?: string;
}

export interface Binding {
  dir: string;
  profile: string;
  strict?: boolean;
}

export interface AutoSwitch {
  enabled: boolean;
  fiveHourPct: number;
  weeklyPct: number;
  allowPaid: boolean;
  minDwellMin: number;
}

export interface Config {
  version: 1;
  profiles: Profile[];
  order: string[];
  active: string;
  bindings: Binding[];
  autoSwitch: AutoSwitch;
}

export const PAID: ReadonlySet<Provider> = new Set(["bedrock", "vertex", "foundry", "apikey"]);

export function emptyConfig(): Config {
  return {
    version: 1,
    profiles: [{ name: "main", provider: "claude", configDir: defaultClaudeDir(), isMain: true }],
    order: ["main"],
    active: "main",
    bindings: [],
    autoSwitch: { enabled: false, fiveHourPct: 95, weeklyPct: 98, allowPaid: false, minDwellMin: 10 },
  };
}

export function loadConfig(): Config {
  const cfg = readJson<Config | null>(paths.config(), null);
  if (!cfg) return emptyConfig();
  const base = emptyConfig();
  return { ...base, ...cfg, autoSwitch: { ...base.autoSwitch, ...cfg.autoSwitch } };
}

export function saveConfig(cfg: Config): void {
  writeJson(paths.config(), cfg);
}

export function mutateConfig(fn: (cfg: Config) => void): Config {
  return updateJson<Config>(paths.config(), loadConfig(), (cur) => {
    const merged = { ...emptyConfig(), ...cur };
    fn(merged);
    return merged;
  });
}

export function getProfile(cfg: Config, name: string): Profile {
  const p = cfg.profiles.find((x) => x.name === name);
  if (!p) throw new UserError(`unknown profile "${name}". Run \`j2c list\` to see your profiles.`);
  return p;
}

export function ordered(cfg: Config): Profile[] {
  const rank = (n: string) => {
    const i = cfg.order.indexOf(n);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...cfg.profiles].sort((a, b) => rank(a.name) - rank(b.name));
}

export class UserError extends Error {}

export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
