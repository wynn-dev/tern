import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.TERN_HOME = mkdtempSync(join(tmpdir(), "tern-update-api-"));
const { createApp } = await import("../src/server/app");

const demo = createApp({ demo: true });
const live = createApp({ demo: false });
const call = (app: ReturnType<typeof createApp>, method: string, path: string) => app.request(path, { method, headers: { "x-tern": "1" } });

test("the demo shows an update to offer, and won't install it", async () => {
  const s = await (await call(demo, "GET", "/api/update")).json();
  expect(s).toMatchObject({ available: true, demo: true });
  expect(s.current.sha).not.toBe(s.latest.sha);
  const res = await call(demo, "POST", "/api/update");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toBe("Updating is off in the demo.");
});

test("run from source, Tern has no build to compare and says it updates with git", async () => {
  const s = await (await call(live, "GET", "/api/update")).json();
  expect(s).toMatchObject({ current: null, available: false });
  const res = await call(live, "POST", "/api/update");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/runs from source/);
});

test("installing takes a click: a cross-site POST without the X-Tern header is refused", async () => {
  expect((await live.request("/api/update", { method: "POST" })).status).toBe(403);
});
