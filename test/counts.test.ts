import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scopedCounts, viewUnread } from "../src/web/lib/counts";

// the sidebar's counts from what the server really sends, for the demo's three accounts
const dir = mkdtempSync(join(tmpdir(), "tern-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { seedDemo } = await import("../src/server/demo");

beforeAll(() => {
  db.openDb(join(dir, "t.db"));
  seedDemo();
});

test("smart-view counts from the server follow the selected account", () => {
  const counts = db.counts();
  const all = scopedCounts(counts, null);
  expect(all.categories.work).toBe(2);
  // each account has its own counts, and together they make the global ones
  for (const id of ["personal", "work", "studio"]) expect(counts.accounts[id].categories).toBeDefined();
  expect(scopedCounts(counts, "personal").categories).toEqual({ personal: 1 });
  expect(scopedCounts(counts, "studio").categories).toEqual({ work: 1 });
  expect(viewUnread("category:work", scopedCounts(counts, "work"))).toBe(1);
  const summed: Record<string, number> = {};
  for (const id of ["personal", "work", "studio"])
    for (const [k, n] of Object.entries(scopedCounts(counts, id).categories)) summed[k] = (summed[k] ?? 0) + n;
  expect(summed).toEqual(all.categories);
});
