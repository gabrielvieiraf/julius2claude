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
