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
