import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-send-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { createApp } = await import("../src/server/app");

const app = createApp({ demo: true });
const send = async (body: Record<string, string>) => {
  const res = await app.request("/api/send", {
    method: "POST",
    headers: { "x-tern": "1", "content-type": "application/json" },
    body: JSON.stringify({ accountId: "a", subject: "Hi", text: "hello", ...body }),
  });
  return { status: res.status, ...((await res.json()) as { error?: string; threadId?: string }) };
};

beforeAll(() => {
  db.openDb(join(dir, "t.db"));
  db.upsertAccount({ id: "a", email: "me@x.io", name: "Me", token: null });
  db.upsertAccount({ id: "b", email: "me@y.io", name: "Me", token: null });
  db.upsertMessages([
    {
      id: "1", account_id: "a", thread_id: "t", internal_date: 1, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
      subject: "Lunch?", snippet: "", text: "lunch?", html: "", labels: ["INBOX"], message_id: "<1@x.io>", references: "", attachments: [],
    },
  ]);
});

test("a recipient that isn't an address is refused with a 400 that names it", async () => {
  expect(await send({ to: "not-an-address" })).toEqual({ status: 400, error: "“not-an-address” isn't an email address" });
  expect(await send({ to: "bo@x.io", cc: "ann, cy@" })).toEqual({ status: 400, error: "“ann”, “cy@” aren't email addresses" });
  expect((await send({ to: " " })).status).toBe(400);
});

test("a semicolon-separated list sends to each address", async () => {
  const { status, threadId } = await send({ to: "a@b.com; c@d.com" });
  expect(status).toBe(200);
  expect(db.threadMessages("a", threadId!)[0].to.map((a) => a.email)).toEqual(["a@b.com", "c@d.com"]);
});

test("a reply sent from an account the thread isn't in is refused", async () => {
  const res = await send({ accountId: "b", threadId: "t", to: "bo@x.io" });
  expect(res.status).toBe(400);
  expect(res.error).toContain("me@y.io");
  expect((await send({ threadId: "t", to: "bo@x.io" })).status).toBe(200);
});
