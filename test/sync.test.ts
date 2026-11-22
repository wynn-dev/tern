import { afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeGmail, PER_MINUTE } from "./fake-gmail";

const dir = mkdtempSync(join(tmpdir(), "tern-sync-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { seal } = await import("../src/server/crypto");
const { events } = await import("../src/server/events");
const { gmail, quota } = await import("../src/server/gmail");
const { syncAccount, CATCHING_UP } = await import("../src/server/sync");

beforeAll(() => db.openDb(join(dir, "sync.db")));

let uninstall = () => {};
afterEach(() => uninstall());

/** A fake Gmail with a minute `minuteMs` long, and Tern's limiter on the same clock. */
function fake(opts: ConstructorParameters<typeof FakeGmail>[0]) {
  const g = new FakeGmail(opts);
  quota.minuteMs = g.minuteMs;
  uninstall = g.install();
  return g;
}

let n = 0;
/** A connected account with its own share of the quota. */
function connect() {
  const id = `acc${++n}`;
  const token = seal(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3_600_000 }));
  db.upsertAccount({ id, email: `${id}@example.com`, name: id, token });
  return id;
}

/** Every status the account shows while `fn` runs, as the UI would read it. */
async function watch(id: string, fn: () => Promise<unknown>) {
  const seen: { status: string; error: string | null }[] = [];
  const off = events.on((e) => {
    const a = db.getAccount(id);
    if (e.type === "account" && a) seen.push({ status: a.status, error: a.error });
  });
  try {
    await fn();
  } finally {
    off();
  }
  return seen;
}

test("a 1,500-message first sync stays under Gmail's quota and finishes", async () => {
  // a tenth of a minute, so the test takes seconds; the fake and the limiter scale together
  const g = fake({ messages: 1500, spam: 200, minuteMs: 6_000 });
  const id = connect();
  await syncAccount(id);
  expect(db.getAccount(id)).toMatchObject({ status: "idle", error: null, history_id: "100" });
  expect([...g.inbox, ...g.spam].filter((m) => !db.hasMessage(id, m))).toEqual([]);
  expect(g.refused).toBe(0);
  expect(g.peakMinute).toBeLessThanOrEqual(PER_MINUTE);
  // and not slower than it has to be: 8,500-odd units at 12,000 a minute is about 0.7 of one
  expect(g.calls.at(-1)!.at - g.calls[0].at).toBeLessThan(g.minuteMs);
}, 30_000);

test("when Gmail refuses with a 403 rate limit, sync waits it out, says so plainly and finishes", async () => {
  const g = fake({ messages: 100, minuteMs: 2_000 });
  g.refusal = "403";
  const id = connect();
  g.blockAfter = { served: 20, ms: 600 };
  let archived: Promise<unknown> | undefined;
  const seen = await watch(id, async () => {
    const sync = syncAccount(id);
    // a user action while Gmail is refusing waits for it rather than failing
    while (!g.refused) await Bun.sleep(5);
    archived = gmail.modifyThread(id, "tm1", [], ["INBOX"]);
    await sync;
  });
  await expect(archived!).resolves.toBeDefined();
  expect(g.refused).toBeGreaterThan(0);
  expect(seen).toContainEqual({ status: "limited", error: CATCHING_UP });
  expect(seen.map((s) => s.error).filter((e) => e && e !== CATCHING_UP)).toEqual([]);
  expect(db.getAccount(id)).toMatchObject({ status: "idle", error: null });
  expect(g.inbox.filter((m) => !db.hasMessage(id, m))).toEqual([]);
}, 15_000);

test("Retry-After is honoured instead of the minute-long backoff", async () => {
  // a real minute: without Retry-After the first wait alone would be 15 s
  const g = fake({ messages: 10, minuteMs: 60_000 });
  g.retryAfter = 1;
  g.blockedUntil = Date.now() + 300;
  const id = connect();
  const start = Date.now();
  await syncAccount(id);
  expect(db.getAccount(id)).toMatchObject({ status: "idle", error: null });
  expect(g.calls[0].at - start).toBeGreaterThanOrEqual(990);
  expect(Date.now() - start).toBeLessThan(4_000);
}, 10_000);

test("a sync Gmail keeps refusing pauses with what it stored, then resumes on the next run", async () => {
  const g = fake({ messages: 300, minuteMs: 400 });
  const id = connect();
  g.blockAfter = { served: 150, ms: 60_000 };
  await syncAccount(id);
  // Google's own words never reach the account
  expect(db.getAccount(id)).toMatchObject({ status: "limited", error: CATCHING_UP, history_id: null });
  const stored = g.inbox.filter((m) => db.hasMessage(id, m)).length;
  expect(stored).toBeGreaterThan(100);
  expect(stored).toBeLessThan(300);

  g.blockedUntil = 0;
  await syncAccount(id);
  expect(db.getAccount(id)).toMatchObject({ status: "idle", error: null, history_id: "100" });
  expect(g.inbox.filter((m) => !db.hasMessage(id, m))).toEqual([]);
  // nothing it already had was fetched again
  expect(g.calls.filter((c) => c.path.startsWith("messages/")).length).toBe(300);
}, 15_000);

test("a user action goes ahead of the sync's queued calls", async () => {
  const g = fake({ messages: 1500, minuteMs: 60_000 });
  const id = connect();
  const sync = syncAccount(id);
  // once the burst is spent, sync's calls are all waiting on the limiter
  while (g.calls.filter((c) => c.path.startsWith("messages/")).length < 60) await Bun.sleep(5);
  const before = g.calls.length;
  await gmail.modifyThread(id, "tm1", [], ["INBOX"]);
  const at = g.calls.findIndex((c) => c.path.endsWith("/modify"));
  // only the couple already on their way got in first, not the sync's eight queued ones as well
  expect(at - before).toBeLessThanOrEqual(3);
  // let the rest of the sync through quickly
  g.minuteMs = quota.minuteMs = 600;
  await sync;
}, 30_000);
