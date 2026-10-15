import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isWsl } from "./clipboard.js";
import { loadConfig } from "./config.js";
import { paths } from "./paths.js";
import { log, updateJson } from "./store.js";

const DEDUPE_MS = 60 * 60_000;

function has(cmd: string): boolean {
  return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
}

function systemNotify(title: string, body: string): boolean {
  const env: NodeJS.ProcessEnv = { ...process.env, J2C_TITLE: title, J2C_BODY: body };
  let cmd: string;
  let args: string[];
  if (process.platform === "darwin") {
    cmd = "osascript";
    args = ["-e", 'display notification (system attribute "J2C_BODY") with title (system attribute "J2C_TITLE")'];
  } else if (process.platform === "win32" || isWsl()) {
    cmd = process.platform === "win32" ? "powershell" : "powershell.exe";
    args = [
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(8000, $env:J2C_TITLE, $env:J2C_BODY, 'Info'); Start-Sleep -Seconds 9; $n.Dispose()",
    ];
    if (process.platform !== "win32") env.WSLENV = [process.env.WSLENV, "J2C_TITLE/u", "J2C_BODY/u"].filter(Boolean).join(":");
  } else if (has("notify-send")) {
    cmd = "notify-send";
    args = ["--app-name=julius2claude", title, body];
  } else {
    return false;
  }
  try {
    spawn(cmd, args, { env, stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

async function webhook(url: string, title: string, body: string): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `${title}: ${body}`, content: `${title}: ${body}`, title, body }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e: any) {
    log(`notify webhook failed: ${e?.message ?? e}`);
  }
}

export async function notify(key: string, title: string, body: string, force = false): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.notify?.enabled && !force) return;
  let fresh = true;
  if (!force)
    updateJson<Record<string, number>>(path.join(paths.stateDir(), "notified.json"), {}, (m) => {
      if (m[key] && Date.now() - m[key] < DEDUPE_MS) fresh = false;
      else m[key] = Date.now();
    });
  if (!fresh) return;
  if (process.env.J2C_NOTIFY_FILE) {
    fs.appendFileSync(process.env.J2C_NOTIFY_FILE, JSON.stringify({ key, title, body }) + "\n");
    return;
  }
  systemNotify(title, body);
  if (cfg.notify?.webhook) await webhook(cfg.notify.webhook, title, body);
}
