import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type KeyHeader = "x-api-key" | "bearer";
/** Reasoning effort, as the Agent SDK's `effort` option takes it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

export type Config = {
  host: string;
  port: number;
  /** Public URL the browser reaches Tern at; used for the OAuth redirect. */
  publicUrl?: string;
  /** scrypt hash; when set, the web UI asks for a password. */
  passwordHash?: string;
  google?: { clientId: string; clientSecret: string };
  ai: {
    enabled: boolean;
    /** Model for classification of incoming mail (fast, cheap on quota). */
    classifyModel: string;
    /** Model for summaries and drafts. */
    writeModel: string;
    /** Reasoning effort for sorting and for summaries and drafts; unset leaves it to Claude Code and the model. */
    classifyEffort?: Effort;
    writeEffort?: Effort;
    /** Path to the `claude` executable; found on PATH when empty. */
    claudePath?: string;
    /** An Anthropic-compatible endpoint Claude Code talks to instead of the Claude login; empty means the login. */
    baseUrl?: string;
    /** The endpoint's key, sealed (crypto.ts); never sent to the browser. */
    apiKey?: string;
    /** How the key is sent: as x-api-key (ANTHROPIC_API_KEY, the default) or as a Bearer token (ANTHROPIC_AUTH_TOKEN). */
    keyHeader?: KeyHeader;
  };
  sync: { intervalSec: number; initialDays: number; maxInitial: number };
};

export const defaults: Config = {
  host: "127.0.0.1",
  port: 7420,
  ai: { enabled: true, classifyModel: "claude-haiku-5-5", writeModel: "claude-sonnet-5-5" },
  sync: { intervalSec: 30, initialDays: 60, maxInitial: 1500 },
};

export function dataDir(): string {
  if (process.env.TERN_HOME) return process.env.TERN_HOME;
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "tern");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "tern");
}

export function ensureDataDir(): string {
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const configPath = () => join(dataDir(), "config.json");

export function loadConfig(): Config {
  ensureDataDir();
  const p = configPath();
  if (!existsSync(p)) return structuredClone(defaults);
  const raw = JSON.parse(readFileSync(p, "utf8"));
  return {
    ...defaults,
    ...raw,
    ai: { ...defaults.ai, ...raw.ai },
    sync: { ...defaults.sync, ...raw.sync },
  };
}

export function saveConfig(cfg: Config) {
  ensureDataDir();
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
  chmodSync(configPath(), 0o600);
}

// where this process actually listens: `tern serve --port/--host` override the config file
let serving: { hostname: string; port: number } | null = null;
export const setServeAddress = (addr: { hostname: string; port: number }) => void (serving = addr);

export function publicUrl(cfg: Config): string {
  if (cfg.publicUrl) return cfg.publicUrl.replace(/\/$/, "");
  const h = serving?.hostname ?? cfg.host;
  const host = h === "0.0.0.0" || h === "::" ? "localhost" : h;
  return `http://${host === "127.0.0.1" ? "localhost" : host}:${serving?.port ?? cfg.port}`;
}
