// Self-update from the rolling `edge` release: the same release and the same
// per-platform binary install.sh downloads, checked against its checksums.txt.
// The edge build's identity is its build.json ({ sha, time }), which the release
// workflow publishes beside the binaries. Everything here reads release
// downloads, never api.github.com, so it costs nothing of GitHub's API limit.
//
// `tern update` (the CLI) and Settings › Update (POST /api/update) both go
// through `update()` and then `finish()`.
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname } from "node:path";
import { type Build, shortSha, thisBuild } from "./build";

export const RELEASE_URL = "https://github.com/wynn-dev/tern/releases/download/edge";
/** Where to fetch build.json, checksums.txt and the binaries from; TERN_DOWNLOAD_URL points it elsewhere, as it does install.sh. */
export const releaseUrl = () => (process.env.TERN_DOWNLOAD_URL || RELEASE_URL).replace(/\/$/, "");

/** A failed update, in words for the person: nothing was replaced (or it was put back). */
export class UpdateError extends Error {}

/** ~/.local/bin rather than /home/me/.local/bin, for messages. */
const tilde = (p: string) => (p.startsWith(homedir() + "/") ? `~${p.slice(homedir().length)}` : p);

/**
 * The release asset for this machine, named as install.sh names it. A shell under Rosetta
 * runs the x64 build on Apple silicon; the native one is what install.sh would pick.
 */
export function platformAsset(os: string = platform(), arch: string = process.arch, rosetta = os === "darwin" && arch === "x64" && translated()): string {
  const o = os === "linux" ? "linux" : os === "darwin" ? "darwin" : null;
  const a = arch === "x64" ? (rosetta ? "arm64" : "x64") : arch === "arm64" ? "arm64" : null;
  if (!o) throw new UpdateError(`There's no prebuilt Tern for ${os}. Build it from source to update.`);
  if (!a) throw new UpdateError(`There's no prebuilt Tern for ${arch} CPUs. Build it from source to update.`);
  return `tern-${o}-${a}`;
}
const translated = () => spawnSync("sysctl", ["-n", "sysctl.proc_translated"], { encoding: "utf8" }).stdout?.trim() === "1";

/**
 * Is `latest` (the edge build) newer than the running build? A different commit built later is.
 * A build from source (null) never is: it updates with git. A different commit built later than
 * edge (a local build of a newer main, say) isn't either, so it isn't offered an older one.
 */
export function isNewer(current: Build | null, latest: Build | null): boolean {
  if (!current || !latest || current.sha === latest.sha) return false;
  const now = Date.parse(current.time);
  const then = Date.parse(latest.time);
  // with a date missing, edge being on another commit is all there is to go on
  return Number.isNaN(now) || Number.isNaN(then) || then > now;
}

/** The sha256 that checksums.txt (sha256sum's format) gives `asset`, or null. */
export function checksumFor(text: string, asset: string): string | null {
  for (const line of text.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === asset || name === `*${asset}`) return /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : null;
  }
  return null;
}

async function get(url: string, timeoutMs: number): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "tern-updater" } });
  } catch (e) {
    const timedOut = (e as Error).name === "TimeoutError";
    throw new UpdateError(timedOut ? `GitHub took too long to answer (${basename(url)}). Try again later.` : "Couldn't reach GitHub. Check the internet connection and try again.");
  }
  if (!res.ok) throw new UpdateError(`GitHub answered ${res.status} for ${basename(url)}. Try again in a few minutes.`);
  return res;
}

/** The edge release's build, from its build.json. */
export async function fetchLatest(base = releaseUrl()): Promise<Build> {
  const res = await get(`${base}/build.json`, 15_000);
  const b = (await res.json().catch(() => null)) as Partial<Build> | null;
  if (typeof b?.sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(b.sha)) throw new UpdateError("The edge release's build.json doesn't name a commit. Try again in a few minutes.");
  return { sha: b.sha, time: typeof b.time === "string" ? b.time : "" };
}

/**
 * Put `bytes` at `target` if their sha256 is `want`: written to a temp file beside it, then
 * renamed over it, so the target is the old binary or the new one and never half of one.
 * Any failure removes the temp file and leaves the target as it was.
 */
export function replaceBinary(target: string, bytes: Uint8Array, want: string) {
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want) throw new UpdateError(`The download didn't match its checksum (expected ${want.slice(0, 12)}…, got ${got.slice(0, 12)}…), so nothing was replaced. The release may be mid-upload; try again in a few minutes.`);
  const tmp = `${target}.update-${randomBytes(4).toString("hex")}`;
  try {
    writeFileSync(tmp, bytes, { mode: 0o755 });
    chmodSync(tmp, 0o755);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code;
    const dir = tilde(dirname(target));
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") throw new UpdateError(`Tern can't write to ${dir} (${code === "EROFS" ? "read-only" : "permission denied"}), so nothing was replaced.`);
    if (code === "ENOSPC") throw new UpdateError(`There's no space left in ${dir}, so nothing was replaced.`);
    throw new UpdateError(`Couldn't put the new binary in ${dir}: ${(e as Error).message}. Nothing was replaced.`);
  }
}

/**
 * What happens once the new binary is in place:
 * - `restart`: the service is running; restart it through systemd or launchd.
 * - `start`: the service is installed but stopped; it runs the new build when it starts.
 * - `manual`: Tern isn't the installed service (a foreground `tern serve`); the person restarts it.
 */
export type Next = "restart" | "start" | "manual";

/** How Tern runs, as the updater needs to know it; service.ts provides it (tests pass their own). */
export type ServiceControl = {
  /** Is the service unit installed, is it running, and can its manager be reached right now? */
  state(): { installed: boolean; running: boolean; reachable: boolean; manager: string };
  /** Ask the service manager to restart the service; false when it refused. */
  restart(): Promise<boolean>;
};

export type UpdateOptions = {
  service: ServiceControl;
  /** The binary to replace: ~/.local/bin/tern, which the service runs. */
  target: string;
  current?: Build | null;
  base?: string;
  asset?: string;
  /** Called at each step, for the CLI to print. */
  onStep?: (step: string) => void;
};

export type Installed = { build: Build; next: Next; target: string; backup: string | null };

/**
 * Download the edge build for this machine, check it against checksums.txt and put it at
 * `target`. Nothing is replaced when it isn't newer, the download fails or doesn't match, or
 * Tern runs as a service whose manager can't be reached to restart it.
 */
export async function update(o: UpdateOptions): Promise<Installed | { upToDate: Build }> {
  const step = o.onStep ?? (() => {});
  const current = o.current === undefined ? thisBuild : o.current;
  if (!current) throw new UpdateError("This Tern runs from source, so it updates with git: `git pull`, then `bun run build`.");
  const base = o.base ?? releaseUrl();
  const asset = o.asset ?? platformAsset();

  step("Checking the edge release");
  const latest = await fetchLatest(base);
  if (!isNewer(current, latest)) return { upToDate: latest };

  // a service that runs on can't be restarted onto the new build: find that out before replacing anything
  const svc = o.service.state();
  if (svc.installed && !svc.reachable) {
    throw new UpdateError(`Tern runs as a ${svc.manager} service, but ${svc.manager} can't be reached to restart it, so nothing was replaced. Run \`tern update\` from a terminal on this machine.`);
  }
  const next: Next = !svc.installed ? "manual" : svc.running ? "restart" : "start";

  step(`Downloading ${asset} (${shortSha(latest.sha)})`);
  const sums = await (await get(`${base}/checksums.txt`, 15_000)).text();
  const want = checksumFor(sums, asset);
  if (!want) throw new UpdateError(`The edge release's checksums.txt has no entry for ${asset}, so nothing was replaced.`);
  const bytes = new Uint8Array(await (await get(`${base}/${asset}`, 300_000)).arrayBuffer().catch(() => {
    throw new UpdateError("The download broke off. Check the internet connection and try again.");
  }));

  step("Verifying and installing");
  // keep the old binary until the restarted service is up on the new one
  let backup: string | null = null;
  if (next === "restart" && existsSync(o.target)) {
    backup = `${o.target}.old`;
    rmSync(backup, { force: true });
    try {
      linkSync(o.target, backup);
    } catch {
      backup = null;
    }
  }
  try {
    replaceBinary(o.target, bytes, want);
  } catch (e) {
    if (backup) rmSync(backup, { force: true });
    throw e;
  }
  return { build: latest, next, target: o.target, backup };
}

/**
 * Restart onto the new binary when Tern runs as a service. If the service manager refuses,
 * the old binary goes back, so what runs is what's installed, and this throws why.
 */
export async function finish(r: Installed, service: ServiceControl): Promise<void> {
  if (r.next !== "restart") return;
  if (await service.restart()) return;
  if (r.backup) renameSync(r.backup, r.target);
  throw new UpdateError(`The new build is downloaded, but ${service.state().manager} wouldn't restart Tern, so the old one was put back and is still running. Try \`tern restart\`, then update again.`);
}

/** The new service, up on the new binary, drops the copy of the old one `update()` kept. */
export const dropBackup = (target: string) => rmSync(`${target}.old`, { force: true });

// ---------- in the server: what Settings and the notice show ----------

export type UpdateStatus = {
  /** This binary's build; null from source. */
  current: Build | null;
  /** The edge release's build, as of the last check. */
  latest: Build | null;
  available: boolean;
  checkedAt: number | null;
  checking: boolean;
  /** Why the last check failed; quiet, Settings shows it. */
  checkError: string | null;
  /** Downloading, or restarting onto the new build. */
  updating: boolean;
  /** Why the last update failed. Nothing was replaced (or it was put back). */
  error: string | null;
  /** Installed, but this Tern isn't the service, so it waits for the person to restart it. */
  installed: Build | null;
  /** The demo: its builds are made up and Update is off. */
  demo?: boolean;
};

/** Startup checks wait this long, so a restart loop never adds up to many; then one every six hours. */
const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 3600_000;

const state = { latest: null as Build | null, checkedAt: null as number | null, checkError: null as string | null, error: null as string | null, installed: null as Build | null, updating: false };
let checking: Promise<void> | null = null;

export function updateStatus(): UpdateStatus {
  return { current: thisBuild, ...state, available: !state.installed && isNewer(thisBuild, state.latest), checking: !!checking };
}

/** Look at the edge release now; checks already under way are shared. A build from source has nothing to check. */
export function checkForUpdate(): Promise<void> {
  if (!thisBuild) return Promise.resolve();
  checking ??= fetchLatest()
    .then(
      (b) => void ((state.latest = b), (state.checkError = null)),
      (e) => void (state.checkError = e instanceof UpdateError ? e.message : String(e)),
    )
    .finally(() => {
      state.checkedAt = Date.now();
      checking = null;
    });
  return checking;
}

export function startUpdateChecks() {
  if (!thisBuild) return;
  setTimeout(() => void checkForUpdate(), FIRST_CHECK_MS).unref?.();
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS).unref?.();
}

/**
 * Settings › Update: install the edge build, then restart onto it when Tern is the service.
 * The restart waits a moment so the answer reaches the page first; the page then sees the
 * stream drop and come back on the new build. If it fails, `error` says so on the old one.
 */
export async function installUpdate(service: ServiceControl, target: string): Promise<{ next: Next | "none"; build: Build }> {
  if (state.updating) throw new UpdateError("An update is already under way.");
  state.updating = true;
  state.error = null;
  try {
    const r = await update({ service, target });
    state.checkedAt = Date.now();
    if ("upToDate" in r) {
      state.latest = r.upToDate;
      state.updating = false;
      return { next: "none", build: r.upToDate };
    }
    state.latest = r.build;
    if (r.next === "restart") {
      setTimeout(() => finish(r, service).catch((e: Error) => void ((state.error = e.message), (state.updating = false))), 300);
    } else {
      state.installed = r.build;
      state.updating = false;
    }
    return { next: r.next, build: r.build };
  } catch (e) {
    state.updating = false;
    state.error = e instanceof UpdateError ? e.message : `The update failed: ${(e as Error).message}. Nothing was replaced.`;
    throw new UpdateError(state.error);
  }
}

/** The demo's made-up builds: one from a few days ago, and a newer edge. */
export function demoUpdateStatus(): UpdateStatus {
  const day = 86400_000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  return {
    current: { sha: "4f1c2ab7d93e0c5b8a61f2e4d7c9b0a3e5f8c1d2", time: iso(Date.now() - 3 * day) },
    latest: { sha: "9b54edf0a1c2e3f4b5d6c7a8e9f0b1c2d3e4f5a6", time: iso(Date.now() - day / 4) },
    available: true, checkedAt: Date.now() - 12 * 60_000, checking: false, checkError: null, updating: false, error: null, installed: null, demo: true,
  };
}
