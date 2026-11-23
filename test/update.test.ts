import { afterAll, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksumFor, finish, isNewer, platformAsset, update, UpdateError, type ServiceControl } from "../src/server/update";

const old = { sha: "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", time: "2026-11-20T10:00:00Z" };
const edge = { sha: "2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", time: "2026-11-23T09:30:00Z" };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// a fake edge release: build.json, checksums.txt and the binary, each one changeable per test
let release: Record<string, string | null>;
const server = Bun.serve({
  port: 0,
  fetch: (req) => {
    const body = release[new URL(req.url).pathname.slice(1)];
    return body == null ? new Response("not found", { status: 404 }) : new Response(body);
  },
});
const base = `http://127.0.0.1:${server.port}`;
afterAll(() => void server.stop(true));

let dir: string;
let target: string;
beforeEach(() => {
  release = {
    "build.json": JSON.stringify(edge),
    "tern-linux-x64": "new binary",
    "checksums.txt": `${sha256("new binary")}  tern-linux-x64\n${sha256("other")}  tern-darwin-arm64\n`,
  };
  dir = mkdtempSync(join(tmpdir(), "tern-update-"));
  target = join(dir, "tern");
  writeFileSync(target, "old binary", { mode: 0o755 });
});

/** A service manager that does what it's told, and remembers being asked. */
function fakeService(s: Partial<ReturnType<ServiceControl["state"]>> = {}, restarts = true) {
  const svc = { restarted: 0, state: () => ({ installed: false, running: false, reachable: false, manager: "systemd", ...s }), restart: async () => (svc.restarted++, restarts) };
  return svc;
}
const run = (svc = fakeService(), o: Partial<Parameters<typeof update>[0]> = {}) => update({ service: svc, target, current: old, base, asset: "tern-linux-x64", ...o });
const leftovers = () => readdirSync(dir).filter((f) => f !== "tern");

test("a different commit built later than this one is an update; the same one, an older one or a build from source isn't", () => {
  expect(isNewer(old, edge)).toBe(true);
  expect(isNewer(edge, edge)).toBe(false);
  expect(isNewer(edge, old)).toBe(false);
  expect(isNewer(null, edge)).toBe(false);
  expect(isNewer(old, null)).toBe(false);
  // with no date to go on, edge being on another commit is enough
  expect(isNewer({ ...old, time: "" }, edge)).toBe(true);
});

test("each machine gets the asset install.sh would download", () => {
  expect(platformAsset("linux", "x64", false)).toBe("tern-linux-x64");
  expect(platformAsset("linux", "arm64", false)).toBe("tern-linux-arm64");
  expect(platformAsset("darwin", "arm64", false)).toBe("tern-darwin-arm64");
  expect(platformAsset("darwin", "x64", false)).toBe("tern-darwin-x64");
  expect(platformAsset("darwin", "x64", true)).toBe("tern-darwin-arm64");
  expect(() => platformAsset("win32", "x64", false)).toThrow(/no prebuilt Tern for win32/);
  expect(() => platformAsset("linux", "ia32", false)).toThrow(/no prebuilt Tern for ia32/);
});

test("checksums.txt is read the way sha256sum writes it", () => {
  const sums = `${"a".repeat(64)}  tern-linux-x64\n${"B".repeat(64)} *tern-darwin-arm64\n`;
  expect(checksumFor(sums, "tern-linux-x64")).toBe("a".repeat(64));
  expect(checksumFor(sums, "tern-darwin-arm64")).toBe("b".repeat(64));
  expect(checksumFor(sums, "tern-linux-arm64")).toBeNull();
});

test("an update puts the new binary in place, executable, and says what comes next", async () => {
  const r = await run();
  expect(r).toMatchObject({ build: edge, next: "manual", backup: null });
  expect(readFileSync(target, "utf8")).toBe("new binary");
  expect(statSync(target).mode & 0o777).toBe(0o755);
  expect(leftovers()).toEqual([]);
});

test("already on the edge build, nothing is downloaded or replaced", async () => {
  release["tern-linux-x64"] = null;
  expect(await run(fakeService(), { current: edge })).toEqual({ upToDate: edge });
  expect(readFileSync(target, "utf8")).toBe("old binary");
});

test("a download that doesn't match its checksum replaces nothing", async () => {
  release["tern-linux-x64"] = "tampered binary";
  const err = await run().catch((e) => e);
  expect(err).toBeInstanceOf(UpdateError);
  expect(err.message).toMatch(/didn't match its checksum.*nothing was replaced/);
  expect(readFileSync(target, "utf8")).toBe("old binary");
  expect(leftovers()).toEqual([]);
});

test("a release with no checksum for this machine replaces nothing", async () => {
  release["checksums.txt"] = `${sha256("other")}  tern-darwin-arm64\n`;
  await expect(run()).rejects.toThrow(/no entry for tern-linux-x64/);
  expect(readFileSync(target, "utf8")).toBe("old binary");
});

test("with no network, the update says so plainly and replaces nothing", async () => {
  const err = await run(fakeService(), { base: "http://127.0.0.1:9" }).catch((e) => e);
  expect(err).toBeInstanceOf(UpdateError);
  expect(err.message).toMatch(/Couldn't reach GitHub/);
  expect(readFileSync(target, "utf8")).toBe("old binary");
});

test("a missing release file is a plain error too", async () => {
  release["build.json"] = null;
  await expect(run()).rejects.toThrow(/GitHub answered 404 for build.json/);
});

// root writes anywhere, so there the folder can't be made unwritable
test.skipIf(process.getuid?.() === 0)("when the binary's folder can't be written, the old binary stays as it was", async () => {
  chmodSync(dir, 0o555);
  try {
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(UpdateError);
    expect(err.message).toMatch(/can't write to .* \(permission denied\), so nothing was replaced/);
    expect(readFileSync(target, "utf8")).toBe("old binary");
    expect(leftovers()).toEqual([]);
  } finally {
    chmodSync(dir, 0o755);
  }
});

test("a running service is restarted onto the new binary", async () => {
  const svc = fakeService({ installed: true, running: true, reachable: true });
  const r = await run(svc);
  if ("upToDate" in r) throw new Error("expected an update");
  expect(r.next).toBe("restart");
  expect(readFileSync(target, "utf8")).toBe("new binary");
  await finish(r, svc);
  expect(svc.restarted).toBe(1);
});

test("when the service manager won't restart Tern, the old binary goes back", async () => {
  const svc = fakeService({ installed: true, running: true, reachable: true }, false);
  const r = await run(svc);
  if ("upToDate" in r) throw new Error("expected an update");
  await expect(finish(r, svc)).rejects.toThrow(/wouldn't restart Tern, so the old one was put back/);
  expect(readFileSync(target, "utf8")).toBe("old binary");
  expect(existsSync(`${target}.old`)).toBe(false);
});

test("a service whose manager can't be reached isn't touched", async () => {
  const svc = fakeService({ installed: true, running: false, reachable: false });
  await expect(run(svc)).rejects.toThrow(/systemd can't be reached to restart it, so nothing was replaced/);
  expect(readFileSync(target, "utf8")).toBe("old binary");
  expect(svc.restarted).toBe(0);
});

test("a stopped service gets the new binary for its next start, without a restart", async () => {
  const r = await run(fakeService({ installed: true, running: false, reachable: true }));
  expect(r).toMatchObject({ next: "start" });
  expect(readFileSync(target, "utf8")).toBe("new binary");
});

test("a build from source doesn't update itself", async () => {
  await expect(run(fakeService(), { current: null })).rejects.toThrow(/runs from source/);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
