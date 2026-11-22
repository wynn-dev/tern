import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-star-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { applyAction } = await import("../src/server/actions");

beforeAll(() => {
  db.openDb(join(dir, "t.db"));
  db.upsertAccount({ id: "a", email: "me@x.io", name: "Me", token: null });
  const base = { account_id: "a", thread_id: "t", from_name: "Bo", from_email: "bo@x.io", to: [], cc: [], subject: "Hi", snippet: "", text: "", html: "", message_id: "", references: "", attachments: [] };
  // starred in Gmail on the first message, not the last
  db.upsertMessages([
    { ...base, id: "1", internal_date: 1, labels: ["INBOX", "STARRED"] },
    { ...base, id: "2", internal_date: 2, labels: ["INBOX"] },
  ]);
});

const starredOn = () => db.threadMessages("a", "t").filter((m) => m.labels.includes("STARRED")).map((m) => m.id);

test("unstar removes a star from an earlier message", async () => {
  expect(db.getThread("a", "t")!.thread.starred).toBe(1);
  await applyAction("a", "t", "unstar", true);
  expect(starredOn()).toEqual([]);
  expect(db.getThread("a", "t")!.thread.starred).toBe(0);
});

test("star marks the latest message only", async () => {
  await applyAction("a", "t", "star", true);
  expect(starredOn()).toEqual(["2"]);
  expect(db.getThread("a", "t")!.thread.starred).toBe(1);
});
