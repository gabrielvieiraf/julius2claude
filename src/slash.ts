import fs from "node:fs";
import path from "node:path";
import { defaultClaudeDir } from "./paths.js";

const J2C = `"\${J2C_NODE:-node}" "\${J2C_BIN:-$(command -v j2c)}"`;

const COMMANDS: Record<string, { description: string; hint?: string; body: string }> = {
  use: {
    description: "julius2claude: move this session to another account (at the end of this turn)",
    hint: "<profile>",
    body: `!\`${J2C} use $ARGUMENTS --from-session 2>&1\`

Reply with one short line confirming what julius2claude said above. Do not do anything else.`,
  },
  next: {
    description: "julius2claude: move this session to the next account with room left",
    body: `!\`${J2C} next --from-session 2>&1\`

Reply with one short line confirming what julius2claude said above. Do not do anything else.`,
  },
  stats: {
    description: "julius2claude: tokens per account and how long each took to reach its limits",
    body: `!\`${J2C} stats 2>&1\`

Show the report above to the user as-is. Do not do anything else.`,
  },
  status: {
    description: "julius2claude: accounts, limits and which one this session is on",
    body: `!\`${J2C} status 2>&1\`

Show the table above to the user as-is. Do not do anything else.`,
  },
};

export function commandsDir(): string {
  return path.join(defaultClaudeDir(), "commands", "j2c");
}

export function installSlashCommands(): string[] {
  const dir = commandsDir();
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, c] of Object.entries(COMMANDS)) {
    const fm = [
      "---",
      `description: ${c.description}`,
      ...(c.hint ? [`argument-hint: ${c.hint}`] : []),
      "allowed-tools: Bash",
      "disable-model-invocation: true",
      "---",
      "",
    ].join("\n");
    const file = path.join(dir, `${name}.md`);
    fs.writeFileSync(file, fm + c.body + "\n");
    written.push(file);
  }
  return written;
}
