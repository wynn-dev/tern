import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { dataDir } from "../server/config";
import type { ServiceControl } from "../server/update";

const LABEL = "dev.tern.server";
const isMac = platform() === "darwin";

export const binDir = () => join(homedir(), ".local", "bin");
export const installedBin = () => join(binDir(), "tern");
export const logPath = () => join(dataDir(), "tern.log");
const unitPath = () =>
  isMac ? join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`) : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user", "tern.service");

const run = (cmd: string, args: string[], quiet = false) => {
  const r = spawnSync(cmd, args, { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
};

/** Copy the running binary to ~/.local/bin/tern (no-op when it already is that file). */
export function installBinary(): string {
  const self = process.execPath;
  const target = installedBin();
  if (self === target) return target;
  if (!/tern$/.test(self)) throw new Error("Run install from the compiled tern binary (bun run build), not from source.");
  mkdirSync(binDir(), { recursive: true });
  const tmp = `${target}.new`;
  copyFileSync(self, tmp);
  chmodSync(tmp, 0o755);
  // rename over the old binary so a running service keeps its file
  spawnSync("mv", ["-f", tmp, target]);
  return target;
}

export function writeUnit(bin: string) {
  const path = unitPath();
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(dataDir(), { recursive: true });
  // the service needs PATH to find the `claude` CLI used for AI features
  const PATH = [binDir(), join(homedir(), ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH]
    .filter(Boolean)
    .join(":");
  if (isMac) {
    writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${bin}</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${PATH}</string></dict>
  <key>StandardOutPath</key><string>${logPath()}</string>
  <key>StandardErrorPath</key><string>${logPath()}</string>
</dict>
</plist>
`);
  } else {
    writeFileSync(path, `[Unit]
Description=Tern mail
After=network-online.target

[Service]
ExecStart=${bin} serve
Restart=on-failure
RestartSec=3
Environment=PATH=${PATH}

[Install]
WantedBy=default.target
`);
  }
  return path;
}

const uid = () => String(process.getuid?.() ?? 501);

export const service = {
  start() {
    if (isMac) {
      run("launchctl", ["bootout", `gui/${uid()}/${LABEL}`], true);
      return run("launchctl", ["bootstrap", `gui/${uid()}`, unitPath()]).ok;
    }
    run("systemctl", ["--user", "daemon-reload"]);
    return run("systemctl", ["--user", "enable", "--now", "tern.service"]).ok;
  },
  stop() {
    if (isMac) return run("launchctl", ["bootout", `gui/${uid()}/${LABEL}`]).ok;
    return run("systemctl", ["--user", "stop", "tern.service"]).ok;
  },
  restart() {
    if (isMac) return run("launchctl", ["kickstart", "-k", `gui/${uid()}/${LABEL}`]).ok;
    return run("systemctl", ["--user", "restart", "tern.service"]).ok;
  },
  status(): { installed: boolean; running: boolean; detail: string } {
    const installed = existsSync(unitPath());
    if (!installed) return { installed, running: false, detail: "not installed" };
    if (isMac) {
      const r = run("launchctl", ["print", `gui/${uid()}/${LABEL}`], true);
      const state = r.out.match(/state = (\w+)/)?.[1] ?? "stopped";
      return { installed, running: state === "running", detail: state };
    }
    const r = run("systemctl", ["--user", "is-active", "tern.service"], true);
    return { installed, running: r.out === "active", detail: r.out };
  },
  logs(follow: boolean) {
    if (isMac) return run("tail", [follow ? "-f" : "-n200", logPath()]).ok;
    return run("journalctl", ["--user", "-u", "tern.service", "--no-pager", "-o", "cat", ...(follow ? ["-f"] : ["-n", "200"])]).ok;
  },
  uninstall() {
    this.stop();
    if (!isMac) run("systemctl", ["--user", "disable", "tern.service"], true);
    rmSync(unitPath(), { force: true });
    if (!isMac) run("systemctl", ["--user", "daemon-reload"], true);
  },
  /** On Linux, keep the user service running after logout. */
  linger() {
    if (isMac) return;
    const user = process.env.USER;
    if (user) run("loginctl", ["enable-linger", user], true);
  },
};

/** The service as the updater sees it (src/server/update.ts), the same from the CLI and from inside the service. */
export const serviceControl: ServiceControl = {
  state() {
    const manager = isMac ? "launchd" : "systemd";
    const installed = existsSync(unitPath());
    if (!installed) return { installed, running: false, reachable: false, manager };
    const reachable = isMac ? run("launchctl", ["print", `gui/${uid()}`], true).ok : run("systemctl", ["--user", "show-environment"], true).ok;
    return { installed, running: reachable && service.status().running, reachable, manager };
  },
  // detached and not waited on by the manager: run from inside the service, it outlives the stop it asks for
  restart: () =>
    new Promise((resolve) => {
      const [cmd, args] = isMac ? ["launchctl", ["kickstart", "-k", `gui/${uid()}/${LABEL}`]] : ["systemctl", ["--user", "--no-block", "restart", "tern.service"]];
      const p = spawn(cmd, args as string[], { detached: true, stdio: "ignore" });
      p.on("error", () => resolve(false));
      p.on("exit", (code) => resolve(code === 0));
    }),
};
