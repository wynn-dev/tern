import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-stats-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { applyAction } = await import("../src/server/actions");
const { createApp } = await import("../src/server/app");
const { dayKey, recordAction, stats, streak } = await import("../src/server/stats");

const msg = (account_id: string, thread_id: string, labels: string[]) => ({
  account_id, thread_id, id: thread_id, internal_date: 1, labels, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
  subject: thread_id, snippet: "", text: "", html: "", message_id: "", references: "", attachments: [],
});

let n = 0;
beforeEach(() => {
  // a fresh database each test, so days and counts start from nothing
  db.openDb(join(dir, `stats-${n++}.db`));
  db.upsertAccount({ id: "a", email: "a@x.io", name: "A", token: null });
  db.upsertAccount({ id: "b", email: "b@x.io", name: "B", token: null });
  db.upsertMessages([msg("a", "a1", ["INBOX"]), msg("a", "a2", ["INBOX", "UNREAD"]), msg("a", "old", []), msg("b", "b1", ["INBOX"])]);
});

test("a day key is the local calendar day", () => {
  expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  expect(dayKey(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
});

test("a streak counts days in a row at zero, up to today or, while today isn't done, yesterday", () => {
  const days = new Set(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
  expect(streak(days, "2026-11-21")).toBe(4);
  // not at zero yet today: still alive
  expect(streak(days, "2026-11-22")).toBe(4);
  // a day missed breaks it
  expect(streak(days, "2026-11-23")).toBe(0);
  expect(streak(new Set(["2026-11-20", "2026-11-22"]), "2026-11-22")).toBe(1);
  // across a month and a year
  expect(streak(new Set(["2025-12-31", "2026-01-01", "2026-02-28", "2026-03-01"]), "2026-03-01")).toBe(2);
  expect(streak(new Set(["2025-12-31", "2026-01-01"]), "2026-01-01")).toBe(2);
  expect(streak(new Set(), "2026-11-22")).toBe(0);
});

test("reading unread inbox mail and taking mail out of the inbox clear it, once a thread a day", async () => {
  await applyAction("a", "a2", "read", true);
  await applyAction("a", "a2", "archive", true);
  await applyAction("b", "b1", "trash", true);
  expect(stats("a")).toMatchObject({ cleared: 1 });
  expect(stats("a").days[0]).toMatchObject({ read: 1, archived: 1, trashed: 0, cleared: 1 });
  expect(stats("b")).toMatchObject({ cleared: 1 });
  expect(stats(null)).toMatchObject({ cleared: 2 });
  expect(stats(null).days[0]).toMatchObject({ read: 1, archived: 1, trashed: 1, spammed: 0, cleared: 2 });
});

test("what doesn't touch the inbox doesn't count: archived mail, starring, reading read mail", async () => {
  await applyAction("a", "old", "archive", true);
  await applyAction("a", "old", "trash", true);
  await applyAction("a", "a1", "read", true);
  await applyAction("a", "a2", "star", true);
  expect(stats("a").cleared).toBe(0);
  expect(stats(null).days).toEqual([]);
});

test("zero unread in the inbox is the milestone: read mail can stay", async () => {
  // b has no unread mail, but nothing was done there in Tern yet
  expect(stats("b").zeroToday).toBe(false);
  await applyAction("a", "a1", "archive", true);
  expect(stats("a").zeroToday).toBe(false);
  // reading the last unread thread reaches it, with a2 still in the inbox
  await applyAction("a", "a2", "read", true);
  expect(stats("a")).toMatchObject({ cleared: 2, zeroToday: true, streak: 1 });
  // and every inbox has no unread mail, so All accounts has too
  expect(stats(null)).toMatchObject({ zeroToday: true, streak: 1 });
  expect(stats("b").zeroToday).toBe(false);
});

test("All accounts reaches zero only once no inbox has unread mail", async () => {
  db.upsertMessages([msg("b", "b2", ["INBOX", "UNREAD"])]);
  await applyAction("a", "a2", "read", true);
  expect(stats("a").zeroToday).toBe(true);
  expect(stats(null).zeroToday).toBe(false);
  await applyAction("b", "b2", "archive", true);
  expect(stats("b").zeroToday).toBe(true);
  expect(stats(null)).toMatchObject({ cleared: 2, zeroToday: true });
});

test("undo and Mark unread take a thread back off the count; a day reached at zero stays reached", async () => {
  await applyAction("a", "a1", "archive", true);
  await applyAction("a", "a2", "spam", true);
  expect(stats("a")).toMatchObject({ cleared: 2, zeroToday: true, streak: 1 });
  await applyAction("a", "a2", "notspam", true, true);
  expect(stats("a")).toMatchObject({ cleared: 1, zeroToday: true });
  await applyAction("a", "a1", "inbox", true, true);
  expect(stats("a").cleared).toBe(0);
  // read, then archived, then the archive undone: still read today
  await applyAction("a", "a2", "read", true);
  await applyAction("a", "a2", "archive", true);
  await applyAction("a", "a2", "inbox", true, true);
  expect(stats("a").days[0]).toMatchObject({ read: 1, archived: 0, cleared: 1 });
  await applyAction("a", "a2", "unread", true);
  expect(stats("a").cleared).toBe(0);
  // moving mail into the inbox on purpose isn't an undo
  await applyAction("a", "a1", "archive", true);
  await applyAction("a", "old", "inbox", true);
  expect(stats("a").cleared).toBe(1);
});

test("the streak is kept in the database, day by day", () => {
  const at = (d: number) => new Date(2026, 10, d, 12);
  db.upsertMessages([msg("a", "a2", ["INBOX"])]);
  for (const d of [19, 20, 21]) recordAction("a", "a1", "archive", { wasInInbox: true, wasUnread: false, now: at(d) });
  expect(stats("a", at(21))).toMatchObject({ cleared: 1, zeroToday: true, streak: 3 });
  expect(stats("a", at(22))).toMatchObject({ today: "2026-11-22", cleared: 0, zeroToday: false, streak: 3 });
  expect(stats("a", at(23)).streak).toBe(0);
  expect(stats("a", at(22)).days.map((d) => d.day)).toEqual(["2026-11-21", "2026-11-20", "2026-11-19"]);
  // a fresh open of the database still has it
  db.openDb(join(dir, `stats-${n - 1}.db`));
  expect(stats("a", at(22)).streak).toBe(3);
});

test("the API serves stats per account and for All accounts, and the action route takes undo", async () => {
  const app = createApp({ demo: true });
  const post = (path: string) => app.request(path, { method: "POST", headers: { "x-tern": "1" } });
  expect((await post("/api/threads/a/a1/archive")).status).toBe(200);
  expect(((await (await app.request("/api/stats?account=a")).json()) as { cleared: number }).cleared).toBe(1);
  expect(((await (await app.request("/api/stats")).json()) as { cleared: number }).cleared).toBe(1);
  await post("/api/threads/a/a1/inbox?undo=1");
  expect(((await (await app.request("/api/stats")).json()) as { cleared: number }).cleared).toBe(0);
});
