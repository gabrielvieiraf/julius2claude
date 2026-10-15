import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { UserError, loadConfig } from "./config.js";
import { j2cHome } from "./paths.js";
import { liveRuns } from "./runs.js";
import { commandsDir } from "./slash.js";
import { removeAllShims, shimDir } from "./shims.js";

const COMMANDS = [
  "setup", "add", "login", "remove", "list", "status", "usage", "stats", "events", "use", "next", "order",
  "pause", "resume", "bind", "unbind", "auto", "notify", "rescue", "recover", "doctor", "shims", "update",
  "uninstall", "completion", "help", "version",
];
const PROFILE_ARG = ["-P", "--profile", "use", "login", "remove", "rm", "pause", "resume", "bind", "--to"];

export function profileNames(): string[] {
  try {
    return loadConfig().profiles.map((p) => p.name);
  } catch {
    return [];
  }
}

export function completionScript(shell: string | undefined): string {
  const cmds = COMMANDS.join(" ");
  if (shell === "fish") {
    return [
      `complete -c j2c -f`,
      `complete -c j2c -n "__fish_use_subcommand" -a "${cmds}"`,
      `complete -c j2c -n "__fish_seen_subcommand_from ${PROFILE_ARG.filter((a) => !a.startsWith("-")).join(" ")}" -a "(j2c __profiles 2>/dev/null)"`,
      `complete -c j2c -s P -l profile -x -a "(j2c __profiles 2>/dev/null)"`,
      "",
    ].join("\n");
  }
  if (shell !== "bash" && shell !== "zsh") throw new UserError("usage: j2c completion bash|zsh|fish");
  const bash = [
    `_j2c() {`,
    `  local cur="\${COMP_WORDS[COMP_CWORD]}" prev="\${COMP_WORDS[COMP_CWORD-1]}"`,
    `  case "$prev" in`,
    `    ${PROFILE_ARG.join("|")}) COMPREPLY=($(compgen -W "$(j2c __profiles 2>/dev/null)" -- "$cur")); return ;;`,
    `    completion) COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur")); return ;;`,
    `  esac`,
    `  if [ "$COMP_CWORD" -eq 1 ]; then COMPREPLY=($(compgen -W "${cmds}" -- "$cur")); fi`,
    `}`,
    `complete -F _j2c j2c`,
    "",
  ].join("\n");
  return shell === "zsh" ? `autoload -U +X bashcompinit && bashcompinit\n${bash}` : bash;
}

function installedVersion(): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(fs.realpathSync(process.argv[1])), "..", "package.json"), "utf8")).version;
  } catch {
    return "unknown";
  }
}

export function update(checkOnly: boolean): number {
  const current = installedVersion();
  let latest = "";
  try {
    latest = execFileSync("npm", ["view", "julius2claude", "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000 }).trim();
  } catch {
    throw new UserError("could not reach the npm registry.");
  }
  if (current === latest) {
    console.log(`julius2claude ${current} is the latest version.`);
    return 0;
  }
  console.log(`julius2claude ${current} → ${latest} available.`);
  if (checkOnly) return 0;
  const real = fs.realpathSync(process.argv[1]);
  if (!real.includes(`${path.sep}node_modules${path.sep}julius2claude${path.sep}`)) {
    console.log(`This copy runs from ${path.dirname(path.dirname(real))} (installed from source). Update it with git pull && npm run build, or install from npm: npm install -g julius2claude`);
    return 0;
  }
  const r = spawnSync("npm", ["install", "-g", `julius2claude@${latest}`], { stdio: "inherit" });
  return r.status ?? 1;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer: string = await new Promise((r) => rl.question(question, r));
  rl.close();
  return /^y/i.test(answer.trim());
}

export async function uninstall(purge: boolean, yes: boolean): Promise<number> {
  if (liveRuns().length) throw new UserError("sessions started with j2c are still running. Close them first.");
  fs.rmSync(commandsDir(), { recursive: true, force: true });
  console.log(`Removed the /j2c:* commands (${commandsDir()}).`);
  const shims = removeAllShims();
  if (shims.length) console.log(`Removed ${shims.length} claude-<profile> command(s) from ${shimDir()}.`);
  if (purge) {
    const ok = yes || (await confirm(`Delete ${j2cHome()}, including every extra profile's login? Logins are not revoked. [y/N] `));
    if (!ok) {
      console.log(`Kept ${j2cHome()}.`);
    } else {
      fs.rmSync(j2cHome(), { recursive: true, force: true });
      console.log(`Deleted ${j2cHome()}. To also sign those accounts out, revoke the sessions at claude.ai (Settings).`);
    }
  } else console.log(`Kept your profiles and history in ${j2cHome()} (add --purge to delete them).`);
  console.log(`Your main login in ~/.claude was not touched.
Finish with: npm uninstall -g julius2claude${process.env.SHELL ? "  (and remove alias claude=j2c from your shell profile if you added it)" : ""}`);
  return 0;
}
