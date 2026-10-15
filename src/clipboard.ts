import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";

export function isWsl(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft/i.test(fs.readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function has(cmd: string): boolean {
  return spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;
}

export function copyToClipboard(text: string): boolean {
  if (process.env.J2C_NO_CLIPBOARD) return false;
  const candidates: [string, string[]][] =
    process.platform === "darwin" ? [["pbcopy", []]]
    : process.platform === "win32" ? [["clip", []]]
    : isWsl() ? [["clip.exe", []]]
    : [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
  for (const [cmd, args] of candidates) {
    if (!has(cmd)) continue;
    const r = spawnSync(cmd, args, { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 5_000 });
    if (r.status === 0) return true;
  }
  return false;
}

export function openInBrowser(url: string): boolean {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["explorer.exe", [url]]
    : isWsl() ? (has("wslview") ? ["wslview", [url]] : ["explorer.exe", [url]])
    : ["xdg-open", [url]];
  if (!has(cmd)) return false;
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}
