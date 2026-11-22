import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");

const ids = (view: string, account?: string) => db.queryThreads({ view, account }).map((t) => t.thread_id).sort();

beforeAll(() => {
  db.openDb(join(dir, "labels.db"));
  db.upsertAccount({ id: "a", email: "a@x.io", name: "A", token: null });
  db.upsertAccount({ id: "b", email: "b@x.io", name: "B", token: null });
  // Gmail label ids are per account: Label_1 means different labels in a and b
  db.replaceLabels("a", [{ id: "Label_1", name: "Clients", type: "user" }, { id: "INBOX", name: "INBOX", type: "system" }]);
  db.replaceLabels("b", [{ id: "Label_1", name: "Receipts", type: "user" }, { id: "Label_2", name: "Clients", type: "user" }]);
  const msg = (account_id: string, thread_id: string, labels: string[], internal_date: number) => ({
    account_id, thread_id, id: thread_id, internal_date, labels, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
    subject: thread_id, snippet: "", text: "", html: "", message_id: "", references: "", attachments: [],
  });
  db.upsertMessages([
    msg("a", "a-client", ["INBOX", "Label_1"], 1),
    msg("a", "a-archived-client", ["Label_1"], 2),
    msg("a", "a-trashed-client", ["TRASH", "Label_1"], 3),
    msg("a", "a-spam", ["SPAM", "UNREAD"], 4),
    msg("b", "b-receipt", ["INBOX", "Label_1"], 5),
    msg("b", "b-client", ["INBOX", "Label_2"], 6),
    msg("b", "b-spam-client", ["SPAM", "Label_2"], 7),
  ]);
});

test("a label view matches the label by name in every account", () => {
  expect(ids("label:Clients")).toEqual(["a-archived-client", "a-client", "b-client"]);
  expect(ids("label:Receipts")).toEqual(["b-receipt"]);
  expect(ids("label:Clients", "b")).toEqual(["b-client"]);
  expect(ids("label:Nope")).toEqual([]);
});

test("spam only shows in Spam", () => {
  expect(ids("spam")).toEqual(["a-spam", "b-spam-client"]);
  expect(ids("spam", "a")).toEqual(["a-spam"]);
  for (const view of ["inbox", "all", "label:Clients"]) expect(ids(view).filter((t) => t.includes("spam"))).toEqual([]);
});

test("only user labels are listed", () => {
  expect(db.userLabels().map((l) => `${l.account_id}:${l.name}`)).toEqual(["a:Clients", "b:Clients", "b:Receipts"]);
});
