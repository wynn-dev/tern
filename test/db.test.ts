import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");

beforeAll(() => {
  db.openDb(join(dir, "t.db"));
  db.upsertAccount({ id: "a", email: "me@x.io", name: "Me", token: null });
  const base = { account_id: "a", thread_id: "t", from_name: "Bo", from_email: "bo@x.io", to: [], cc: [], html: "", references: "", attachments: [] };
  db.upsertMessages([
    { ...base, id: "1", internal_date: 1, subject: "Quarterly invoice", snippet: "", text: "please pay the invoice", labels: ["INBOX", "UNREAD"], message_id: "" },
    { ...base, id: "2", internal_date: 2, subject: "Re: Quarterly invoice", snippet: "paid", text: "paid it", labels: ["INBOX", "SENT"], message_id: "", from_email: "me@x.io" },
  ]);
});

test("folds messages into one thread row", () => {
  const [t] = db.queryThreads({ view: "inbox" });
  expect(t.count).toBe(2);
  expect(t.unread).toBe(1);
  expect(t.in_sent).toBe(1);
  expect(t.snippet).toBe("paid");
});

test("full-text search with prefixes", () => {
  expect(db.queryThreads({ view: "all", q: "invo" })).toHaveLength(1);
  expect(db.queryThreads({ view: "all", q: "nothing" })).toHaveLength(0);
});

test("archiving drops it from the inbox, keeps it in all mail", () => {
  for (const m of db.threadMessages("a", "t")) db.setMessageLabels("a", m.id, m.labels.filter((l) => l !== "INBOX"));
  expect(db.queryThreads({ view: "inbox" })).toHaveLength(0);
  expect(db.queryThreads({ view: "all" })).toHaveLength(1);
});

test("a new message clears the AI verdict so it gets re-triaged", () => {
  db.setThreadAi("a", "t", { category: "finance", priority: 1, summary: "x", needs_reply: false });
  expect(db.getThread("a", "t")!.thread.ai_at).not.toBeNull();
  db.upsertMessages([{ ...db.threadMessages("a", "t")[0], id: "3", internal_date: 3, labels: ["INBOX"] }]);
  expect(db.getThread("a", "t")!.thread.ai_at).toBeNull();
});

test("paging walks every thread even when many share a timestamp", () => {
  db.upsertAccount({ id: "b", email: "bulk@x.io", name: "Bulk", token: null });
  const base = { account_id: "b", from_name: "Me", from_email: "bulk@x.io", to: [], cc: [], html: "", references: "", attachments: [], snippet: "", text: "", message_id: "" };
  // 500 sent threads over 20 distinct timestamps: 25 threads per millisecond, so ties cross every page boundary
  db.upsertMessages(Array.from({ length: 500 }, (_, i) => ({
    ...base, id: `m${i}`, thread_id: `s${i}`, internal_date: 1_000 + (i % 20), subject: `Bulk ${i}`, labels: ["SENT"],
  })));
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = db.queryThreads({ view: "sent", account: "b", cursor, limit: 60 });
    seen.push(...page.map((t) => t.thread_id));
    if (page.length < 60) break;
    cursor = db.threadCursor(page.at(-1)!);
  }
  expect(seen).toHaveLength(500);
  expect(new Set(seen).size).toBe(500);
  // newest first
  const dates = seen.map((id) => 1_000 + (Number(id.slice(1)) % 20));
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
});

test("replying takes a thread out of Needs reply, and the AI can't put it back", () => {
  db.upsertAccount({ id: "r", email: "Me@Reply.io", name: "Me", token: null });
  const base = { account_id: "r", thread_id: "rt", to: [], cc: [], html: "", references: "", attachments: [], snippet: "", text: "", message_id: "" };
  db.upsertMessages([{ ...base, id: "r1", internal_date: 1, from_name: "Linda", from_email: "linda@x.io", subject: "Sunday dinner?", labels: ["INBOX", "UNREAD"] }]);
  db.setThreadAi("r", "rt", { category: "personal", priority: 2, summary: "Dinner?", needs_reply: true });
  expect(db.queryThreads({ view: "needs-reply", account: "r" })).toHaveLength(1);
  expect(db.counts().accounts.r.needsReply).toBe(1);

  db.upsertMessages([{ ...base, id: "r2", internal_date: 2, from_name: "Me", from_email: "me@reply.io", subject: "Re: Sunday dinner?", labels: ["SENT"] }]);
  expect(db.getThread("r", "rt")!.thread.needs_reply).toBe(0);
  expect(db.queryThreads({ view: "needs-reply", account: "r" })).toHaveLength(0);
  expect(db.counts().accounts.r.needsReply).toBe(0);
  // the reply cleared ai_at, so triage runs again; its verdict can't re-flag a thread you answered last
  db.setThreadAi("r", "rt", { category: "personal", priority: 2, summary: "You said yes", needs_reply: true });
  expect(db.getThread("r", "rt")!.thread.needs_reply).toBe(0);

  // a new message from them makes it theirs again
  db.upsertMessages([{ ...base, id: "r3", internal_date: 3, from_name: "Linda", from_email: "linda@x.io", subject: "Re: Sunday dinner?", labels: ["INBOX"] }]);
  db.setThreadAi("r", "rt", { category: "personal", priority: 2, summary: "Bring wine?", needs_reply: true });
  expect(db.getThread("r", "rt")!.thread.needs_reply).toBe(1);

  // a reply saved as a draft (in Gmail on the web or a phone) hasn't been sent: still waiting on you
  db.upsertMessages([{ ...base, id: "r4", internal_date: 4, from_name: "Me", from_email: "me@reply.io", subject: "Re: Sunday dinner?", labels: ["DRAFT"] }]);
  expect(db.getThread("r", "rt")!.thread.needs_reply).toBe(1);
  db.setThreadAi("r", "rt", { category: "personal", priority: 2, summary: "Bring wine?", needs_reply: true });
  expect(db.getThread("r", "rt")!.thread.needs_reply).toBe(1);
});

test("Starred and Needs reply leave out spam", () => {
  db.upsertAccount({ id: "sp", email: "spam@x.io", name: "Spam", token: null });
  const base = { account_id: "sp", from_name: "X", from_email: "x@spam.io", to: [], cc: [], html: "", references: "", attachments: [], snippet: "", text: "", message_id: "" };
  db.upsertMessages([
    { ...base, id: "s1", thread_id: "st1", internal_date: 1, subject: "Starred spam", labels: ["SPAM", "STARRED"] },
    { ...base, id: "s2", thread_id: "st2", internal_date: 2, subject: "Spam that wants a reply", labels: ["SPAM", "INBOX"] },
  ]);
  db.setThreadAi("sp", "st2", { category: "work", priority: 1, summary: "", needs_reply: true });
  expect(db.queryThreads({ view: "starred", account: "sp" })).toHaveLength(0);
  expect(db.queryThreads({ view: "needs-reply", account: "sp" })).toHaveLength(0);
  expect(db.counts().accounts.sp.needsReply).toBe(0);
  expect(db.queryThreads({ view: "spam", account: "sp" })).toHaveLength(2);
});

test("category counts are kept per account, too", () => {
  db.upsertAccount({ id: "c1", email: "c1@x.io", name: "C1", token: null });
  db.upsertAccount({ id: "c2", email: "c2@x.io", name: "C2", token: null });
  const msg = (account_id: string, id: string) => ({
    id, account_id, thread_id: id, internal_date: 5, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [], subject: id, snippet: "",
    text: "", html: "", labels: ["INBOX", "UNREAD"], message_id: "", references: "", attachments: [],
  });
  db.upsertMessages([msg("c1", "w1"), msg("c1", "w2"), msg("c2", "w3")]);
  for (const [a, t] of [["c1", "w1"], ["c1", "w2"], ["c2", "w3"]]) db.setThreadAi(a, t, { category: "travel", priority: 1, summary: "", needs_reply: false });
  const c = db.counts();
  expect(c.categories.travel).toBe(3);
  expect(c.accounts.c1.categories).toEqual({ travel: 2 });
  expect(c.accounts.c2.categories).toEqual({ travel: 1 });
});
