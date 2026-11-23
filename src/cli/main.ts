#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { platform } from "node:os";

import { parseArgs } from "node:util";
import pkg from "../../package.json";
import { dataDir, EFFORTS, type Effort, loadConfig, publicUrl, saveConfig, type Config } from "../server/config";
import { seal } from "../server/crypto";
import { describeBuild, thisBuild } from "../server/build";
import { dropBackup, finish, update, UpdateError } from "../server/update";
import { binDir, installBinary, installedBin, logPath, service, serviceControl, writeUnit } from "./service";

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
};
const ok = (s: string) => console.log(`${c.green("✓")} ${s}`);
const warn = (s: string) => console.log(`${c.yellow("!")} ${s}`);
const fail = (s: string): never => {
  console.error(`${c.red("✗")} ${s}`);
  process.exit(1);
};

const HELP = `${c.bold("tern")} ${c.dim(pkg.version)} — a fast, self-hosted client for your Gmail accounts

${c.bold("Usage")}
  tern install [--port 7420] [--host 127.0.0.1] [--public-url URL]
                          install the binary and run Tern as a background service
  tern update             install the newest edge build and restart the service
  tern setup google       connect Tern to your own Google OAuth client
  tern open               open Tern in your browser
  tern status             is the service running, and where
  tern start | stop | restart
  tern logs [-f]          show (or follow) the service log
  tern password [--off]   require a password for the web UI (or stop requiring one)
  tern config [key] [value]
                          show or change settings (port, host, publicUrl, ai.enabled, ai.classifyModel,
                          ai.baseUrl, ai.apiKey, ai.keyHeader, ...)
  tern doctor             check Google, Claude and the service
  tern uninstall [--purge]
                          remove the service (--purge also deletes mail data and settings)
  tern serve [--demo]     run in the foreground (what the service runs)

Data lives in ${c.dim(dataDir())}`;

async function main() {
  const [cmd = "help", ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      port: { type: "string" }, host: { type: "string" }, "public-url": { type: "string" },
      demo: { type: "boolean" }, dev: { type: "boolean" }, follow: { type: "boolean", short: "f" },
      off: { type: "boolean" }, purge: { type: "boolean" }, yes: { type: "boolean", short: "y" },
    },
  });

  switch (cmd) {
    case "serve": {
      const { serve } = await import("../server/index");
      await serve({ demo: !!values.demo, port: values.port ? Number(values.port) : undefined, host: values.host as string | undefined });
      return;
    }
    case "update":
      return selfUpdate();
    case "install":
      return install(values as Record<string, string | boolean | undefined>);
    case "setup":
      if (positionals[0] !== "google") fail("Usage: tern setup google");
      return setupGoogle();
    case "open":
      return openUrl(publicUrl(loadConfig()));
    case "status": {
      const s = service.status();
      const cfg = loadConfig();
      console.log(`${s.running ? c.green("●") : c.red("●")} service ${s.detail}`);
      console.log(`  url     ${publicUrl(cfg)}`);
      console.log(`  data    ${dataDir()}`);
      console.log(`  google  ${cfg.google?.clientId ? "configured" : c.yellow("not set up — run `tern setup google`")}`);
      return;
    }
    case "start":
      return void (service.start() ? ok("started") : fail("couldn't start the service; run `tern install` first"));
    case "stop":
      return void (service.stop() ? ok("stopped") : fail("couldn't stop the service"));
    case "restart":
      return void (service.restart() ? ok("restarted") : fail("couldn't restart the service"));
    case "logs":
      service.logs(!!values.follow);
      return;
    case "password":
      return setPassword(!!values.off);
    case "config":
      return config(positionals);
    case "doctor":
      return doctor();
    case "uninstall": {
      service.uninstall();
      ok("service removed");
      if (values.purge) {
        rmSync(dataDir(), { recursive: true, force: true });
        ok(`deleted ${dataDir()}`);
      }
      if (existsSync(installedBin())) console.log(c.dim(`The binary is still at ${installedBin()}; delete it to finish.`));
      return;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(`${pkg.version} (${describeBuild(thisBuild)})`);
      return;
    default:
      console.log(HELP);
  }
}

async function install(v: Record<string, string | boolean | undefined>) {
  const cfg = loadConfig();
  if (v.port) cfg.port = Number(v.port);
  if (v.host) cfg.host = String(v.host);
  if (v["public-url"]) cfg.publicUrl = String(v["public-url"]);
  saveConfig(cfg);

  const bin = installBinary();
  ok(`installed ${bin}`);
  if (!(process.env.PATH ?? "").split(":").includes(binDir())) warn(`add ${binDir()} to your PATH to run \`tern\` from anywhere`);

  const unit = writeUnit(bin);
  ok(`wrote ${unit}`);
  if (!service.start()) fail("the service didn't start; see `tern logs`");
  service.linger();
  ok(`Tern is running at ${c.bold(publicUrl(cfg))}`);

  if (!cfg.google?.clientId && process.stdin.isTTY && !v.yes) {
    console.log();
    if ((prompt("Set up the Google connection now? [Y/n]") ?? "y").toLowerCase() !== "n") await setupGoogle();
  }
  if (cfg.host !== "127.0.0.1" && !cfg.passwordHash) warn("Tern is reachable from your network without a password. Run `tern password`.");
  if (!Bun.which("claude")) warn("Claude Code isn't installed, so AI features are off. Install it and run `claude` once to sign in with your Claude subscription.");
}

/** The same path as Settings › Update: download, verify, replace, then restart the service onto it. */
async function selfUpdate() {
  const target = installedBin();
  try {
    console.log(c.dim(`this build: ${describeBuild(thisBuild)}`));
    const r = await update({ service: serviceControl, target, onStep: (s) => console.log(c.dim(`  ${s}…`)) });
    if ("upToDate" in r) return ok(`Tern is up to date (edge is ${describeBuild(r.upToDate)})`);
    ok(`installed ${describeBuild(r.build)} at ${target}`);
    if (r.next === "restart") {
      await finish(r, serviceControl);
      dropBackup(target);
      ok("restarted the service; open pages reconnect on their own");
    } else if (r.next === "start") console.log("The service is stopped; `tern start` runs the new build.");
    else warn("Tern isn't running as the installed service. Restart it to use the new build, or run `tern install` to make it a service.");
  } catch (e) {
    fail(e instanceof UpdateError ? e.message : `The update failed: ${(e as Error).message}. Nothing was replaced.`);
  }
}

async function setupGoogle() {
  const cfg = loadConfig();
  const redirect = `${publicUrl(cfg)}/oauth/callback`;
  console.log(`
${c.bold("Connect Tern to Google")} ${c.dim("(once; every Gmail account then signs in through it)")}

  1. Open ${c.bold("https://console.cloud.google.com/projectcreate")} and create a project (any name, e.g. "Tern").
  2. Enable the Gmail API: ${c.bold("https://console.cloud.google.com/apis/library/gmail.googleapis.com")}
  3. OAuth consent screen → External → add your Gmail addresses as test users → Publish app
     (in Testing, Google signs you out every 7 days; unverified is fine for personal use).
  4. Credentials → Create credentials → OAuth client ID → ${c.bold("Web application")}
     Authorized redirect URI: ${c.bold(redirect)}
  5. Paste the client ID and secret below.
`);
  const clientId = prompt("Client ID:")?.trim();
  const clientSecret = prompt("Client secret:")?.trim();
  if (!clientId || !clientSecret) fail("Both the client ID and secret are needed.");
  cfg.google = { clientId: clientId!, clientSecret: clientSecret! };
  saveConfig(cfg);
  ok("Google client saved");
  if (service.status().running) service.restart();
  console.log(`Open ${c.bold(publicUrl(cfg))} and add your accounts.`);
}

async function setPassword(off: boolean) {
  const cfg = loadConfig();
  if (off) {
    delete cfg.passwordHash;
    saveConfig(cfg);
    return ok("password removed");
  }
  const pw = prompt("New password:");
  if (!pw || pw.length < 8) fail("Use at least 8 characters.");
  cfg.passwordHash = await Bun.password.hash(pw!);
  saveConfig(cfg);
  ok("password set");
}

function config(args: string[]) {
  const cfg = loadConfig() as Record<string, any>;
  const [key, value] = args;
  const redacted = () =>
    JSON.stringify(
      { ...cfg, passwordHash: cfg.passwordHash && "•••", google: cfg.google && { ...cfg.google, clientSecret: "•••" }, ai: { ...cfg.ai, apiKey: cfg.ai.apiKey && "•••" } },
      null,
      2,
    );
  if (!key) return console.log(redacted());
  const path = key.split(".");
  let obj = cfg;
  for (const p of path.slice(0, -1)) obj = obj[p] ??= {};
  const last = path.at(-1)!;
  // the endpoint's key is kept sealed, as Settings › AI keeps it, and never printed
  const isKey = key === "ai.apiKey";
  if (value === undefined) return console.log(isKey ? (obj[last] ? "set" : "not set") : JSON.stringify(obj[last], null, 2));
  if (isKey) obj[last] = value ? seal(value) : undefined;
  else if (key === "ai.classifyEffort" || key === "ai.writeEffort") {
    // "" puts it back to the default: Tern sends no effort
    if (value && !EFFORTS.includes(value as Effort)) fail(`${key} must be one of ${EFFORTS.join(", ")}, or "" for the default`);
    obj[last] = value || undefined;
  } else obj[last] = value === "true" ? true : value === "false" ? false : /^\d+$/.test(value) ? Number(value) : value;
  saveConfig(cfg as Config);
  ok(`${key} = ${isKey ? "•••" : value}${service.status().running ? c.dim("  (run `tern restart` to apply)") : ""}`);
}

async function doctor() {
  const cfg = loadConfig();
  const s = service.status();
  (s.running ? ok : warn)(`service: ${s.detail}`);
  (cfg.google?.clientId ? ok : warn)(`google client: ${cfg.google?.clientId ? "configured" : "missing — run `tern setup google`"}`);
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}/api/session`);
    (res.ok ? ok : warn)(`web: ${res.ok ? "answering" : res.status} on port ${cfg.port}`);
  } catch {
    warn(`web: nothing on port ${cfg.port}`);
  }
  const claude = cfg.ai.claudePath || Bun.which("claude");
  if (!claude) return warn("claude: not found — install Claude Code and sign in to turn on AI features");
  ok(`claude: ${claude}`);
  if (!cfg.ai.enabled) return warn("ai: turned off (`tern config ai.enabled true`)");
  const endpoint = cfg.ai.baseUrl;
  if (endpoint) (cfg.ai.apiKey ? ok : warn)(`ai mode: your endpoint ${endpoint}, key ${cfg.ai.apiKey ? "set" : "missing"}, sent as ${cfg.ai.keyHeader === "bearer" ? "a Bearer token" : "x-api-key"}`);
  else ok("ai mode: your Claude Code login (Claude subscription)");
  process.stdout.write(c.dim("  asking Claude… "));
  try {
    const { ping } = await import("../server/ai");
    await ping();
    console.log();
    ok(endpoint ? `ai: your endpoint answers (${cfg.ai.classifyModel})` : "ai: Claude answers on your subscription");
  } catch (e) {
    console.log();
    // ping() throws an AiError: a message to act on, plus what Claude Code printed
    const { message, detail } = e as Error & { detail?: string };
    warn(`ai: ${message}`);
    if (detail) console.log(c.dim(`    ${detail}`));
  }
  console.log(c.dim(`log: ${logPath()}`));
}

function openUrl(url: string) {
  const cmd = platform() === "darwin" ? "open" : "xdg-open";
  if (spawnSync(cmd, [url], { stdio: "ignore" }).status !== 0) console.log(url);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
