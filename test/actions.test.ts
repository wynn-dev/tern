import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { applyAction } = await import("../src/server/actions");

const ids = (view: string) => db.queryThreads({ view }).map((t) => t.thread_id).sort();

beforeAll(() => {
  db.openDb(join(dir, "actions.db"));
  db.upsertAccount({ id: "a", email: "a@x.io", name: "A", token: null });
  const msg = (thread_id: string, labels: string[], internal_date: number) => ({
    account_id: "a", thread_id, id: thread_id, internal_date, labels, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
    subject: thread_id, snippet: "", text: "", html: "", message_id: "", references: "", attachments: [],
  });
  db.upsertMessages([msg("trashed", ["TRASH"], 1), msg("spam", ["SPAM"], 2), msg("archived", [], 3)]);
});

test("Move to inbox takes a thread out of Trash or Spam", async () => {
  for (const id of ["trashed", "spam", "archived"]) await applyAction("a", id, "inbox", true);
  expect(ids("inbox")).toEqual(["archived", "spam", "trashed"]);
  expect(ids("trash")).toEqual([]);
  expect(ids("spam")).toEqual([]);
});
