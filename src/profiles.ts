import fs from "node:fs";
import path from "node:path";
import { type Config, type Profile } from "./config.js";
import { defaultClaudeDir, defaultClaudeJson, j2cHome } from "./paths.js";
import { readJson, writeJson, log } from "./store.js";

const GROUP_DIRS = ["projects", "file-history", "todos", "tasks", "plans"];
const GLOBAL_DIRS = ["commands", "skills", "agents", "output-styles", "rules"];
const SYNCED_FILES = ["CLAUDE.md", "keybindings.json"];

export const PROVIDER_ENV_KEYS = [
  "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_MANTLE",
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN",
  "AWS_PROFILE", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_BEDROCK_REGION_PREFIX",
  "ANTHROPIC_VERTEX_PROJECT_ID", "CLOUD_ML_REGION", "ANTHROPIC_FOUNDRY_RESOURCE", "ANTHROPIC_FOUNDRY_API_KEY",
  "ANTHROPIC_FOUNDRY_BASE_URL", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL",
];

const PROFILE_OWNED_SETTINGS = ["awsAuthRefresh", "awsCredentialExport", "gcpAuthRefresh", "apiKeyHelper", "modelOverrides"];

const ACCOUNT_KEYS = ["oauthAccount", "userID", "primaryApiKey", "customApiKeyResponses", "s1mAccessCache", "passesEligibilityCache"];

export function groupStore(group: string | undefined): string {
  return !group || group === "default" ? defaultClaudeDir() : path.join(j2cHome(), "groups", group);
}

export function claudeJsonPath(p: Profile): string {
  return p.isMain ? defaultClaudeJson() : path.join(p.configDir, ".claude.json");
}

export function ensureProfileDir(p: Profile): void {
  if (p.isMain) return;
  fs.mkdirSync(p.configDir, { recursive: true, mode: 0o700 });
  const store = groupStore(p.group);
  for (const d of GROUP_DIRS) linkDir(path.join(store, d), path.join(p.configDir, d));
  for (const d of GLOBAL_DIRS) linkDir(path.join(defaultClaudeDir(), d), path.join(p.configDir, d));
  for (const f of SYNCED_FILES) copyIfNewer(path.join(defaultClaudeDir(), f), path.join(p.configDir, f));
  syncSettings(p);
  seedClaudeJson(p);
}

export function linkDir(target: string, link: string): void {
  fs.mkdirSync(target, { recursive: true });
  const resolvedTarget = fs.realpathSync(target);
  let st: fs.Stats | undefined;
  try {
    st = fs.lstatSync(link);
  } catch {}
  if (st?.isSymbolicLink()) {
    let cur = "";
    try {
      cur = fs.realpathSync(link);
    } catch {}
    if (cur === resolvedTarget) return;
    fs.unlinkSync(link);
  } else if (st?.isDirectory()) {
    mergeInto(link, resolvedTarget);
    fs.rmSync(link, { recursive: true, force: true });
  } else if (st) {
    fs.renameSync(link, `${link}.j2c-backup-${Date.now()}`);
  }
  fs.symlinkSync(resolvedTarget, link, process.platform === "win32" ? "junction" : "dir");
}

function mergeInto(src: string, dst: string): void {
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    let to = path.join(dst, name);
    const fromStat = fs.lstatSync(from);
    if (fs.existsSync(to)) {
      if (fromStat.isDirectory() && fs.lstatSync(to).isDirectory()) {
        mergeInto(from, to);
        continue;
      }
      if (fromStat.isFile() && sameFile(from, to)) continue;
      to = `${to}.j2c-conflict-${Date.now()}`;
    }
    fs.renameSync(from, to);
    log(`merged ${from} -> ${to}`);
  }
}

function sameFile(a: string, b: string): boolean {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

function copyIfNewer(src: string, dst: string): void {
  try {
    const s = fs.statSync(src);
    let d: fs.Stats | undefined;
    try {
      d = fs.lstatSync(dst);
    } catch {}
    if (d && d.mtimeMs >= s.mtimeMs) return;
    fs.copyFileSync(src, dst);
  } catch {}
}

type Settings = Record<string, any>;

export function buildProfileSettings(main: Settings, existing: Settings, p: Profile): Settings {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(main.env ?? {})) if (!PROVIDER_ENV_KEYS.includes(k)) env[k] = v as string;
  for (const [k, v] of Object.entries(existing.env ?? {})) if (PROVIDER_ENV_KEYS.includes(k)) env[k] = v as string;
  Object.assign(env, p.env ?? {});
  const out: Settings = { ...main };
  for (const k of PROFILE_OWNED_SETTINGS) {
    if (k in existing) out[k] = existing[k];
    else delete out[k];
  }
  if (p.provider !== "claude" && "model" in existing) out.model = existing.model;
  if (Object.keys(env).length) out.env = env;
  else delete out.env;
  return out;
}

export function syncSettings(p: Profile): void {
  if (p.isMain) return;
  const main = readJson<Settings>(path.join(defaultClaudeDir(), "settings.json"), {});
  const file = path.join(p.configDir, "settings.json");
  const existing = readJson<Settings>(file, {});
  const next = buildProfileSettings(main, existing, p);
  if (JSON.stringify(next) !== JSON.stringify(existing)) writeJson(file, next);
}

export function seedClaudeJson(p: Profile): void {
  if (p.isMain) return;
  const main = readJson<Settings>(defaultClaudeJson(), {});
  const file = claudeJsonPath(p);
  const cur = readJson<Settings | null>(file, null);
  let next: Settings;
  if (!cur) {
    next = { ...main };
    for (const k of ACCOUNT_KEYS) delete next[k];
  } else {
    next = { ...cur, mcpServers: { ...(main.mcpServers ?? {}), ...(cur.mcpServers ?? {}) } };
    const projects = { ...(cur.projects ?? {}) };
    for (const [dir, info] of Object.entries<any>(main.projects ?? {})) {
      projects[dir] = { ...(projects[dir] ?? {}) };
      if (info?.hasTrustDialogAccepted) projects[dir].hasTrustDialogAccepted = true;
      if (info?.mcpServers) projects[dir].mcpServers = { ...info.mcpServers, ...(projects[dir].mcpServers ?? {}) };
    }
    next.projects = projects;
  }
  if (JSON.stringify(next) !== JSON.stringify(cur)) writeJson(file, next);
}

export interface Identity {
  email?: string;
  org?: string;
  orgUuid?: string;
  uuid?: string;
  plan?: string;
}

export function readIdentity(p: Profile): Identity {
  const j = readJson<Settings>(claudeJsonPath(p), {});
  const a = j.oauthAccount ?? {};
  const creds = readCredentials(p);
  return {
    email: a.emailAddress,
    org: a.organizationName,
    orgUuid: a.organizationUuid,
    uuid: a.accountUuid,
    plan: creds?.subscriptionType ?? a.organizationType,
  };
}

export interface CredInfo {
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  subscriptionType?: string;
  hasRefresh: boolean;
}

export function readCredentials(p: Profile): CredInfo | undefined {
  const c = readJson<any>(path.join(p.configDir, ".credentials.json"), null)?.claudeAiOauth;
  if (!c) return undefined;
  return {
    expiresAt: c.expiresAt,
    refreshTokenExpiresAt: c.refreshTokenExpiresAt,
    subscriptionType: c.subscriptionType,
    hasRefresh: typeof c.refreshToken === "string" && c.refreshToken.length > 0,
  };
}

export type LoginState = "ok" | "needs-login" | "unknown" | "n/a";

export function loginState(p: Profile, now = Date.now()): LoginState {
  if (p.provider !== "claude") return "n/a";
  const c = readCredentials(p);
  if (!c) return process.platform === "darwin" ? "unknown" : "needs-login";
  if (!c.hasRefresh || c.expiresAt === 0) return "needs-login";
  if (c.refreshTokenExpiresAt && c.refreshTokenExpiresAt < now) return "needs-login";
  return "ok";
}

export function profileFor(cfg: Config, name: string): Profile | undefined {
  return cfg.profiles.find((p) => p.name === name);
}
