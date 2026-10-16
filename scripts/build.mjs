import { build } from "esbuild";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const outfile = "dist/j2c.mjs";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile,
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node" },
});

const code = fs
  .readFileSync(outfile, "utf8")
  .split("\n")
  .filter((line) => !/^\s*\/\/ (src|node_modules)\//.test(line))
  .join("\n")
  .replaceAll("/* @__PURE__ */ ", "")
  .replace(/\n{3,}/g, "\n\n");
fs.writeFileSync(outfile, code);
fs.chmodSync(outfile, 0o755);

const guide = fs.readFileSync("docs/AGENT-SETUP.md", "utf8").replace(/^# .*\n+/, "");
fs.writeFileSync(
  "plugin/skills/setup/SKILL.md",
  [
    "---",
    "name: setup",
    "description: Install and configure julius2claude so the user can use several Claude accounts (personal Pro/Max, company Team/Enterprise, Amazon Bedrock, Google Vertex, API key) in Claude Code and switch automatically when one hits its 5-hour or weekly usage limit. Use when the user asks to set up julius2claude, add another Claude account, or keep working when a usage limit is reached.",
    "---",
    "",
    "# Set up julius2claude",
    "",
    guide,
  ].join("\n"),
);
const manifest = JSON.parse(fs.readFileSync("plugin/.claude-plugin/plugin.json", "utf8"));
manifest.version = pkg.version;
fs.writeFileSync("plugin/.claude-plugin/plugin.json", JSON.stringify(manifest, null, 2) + "\n");
