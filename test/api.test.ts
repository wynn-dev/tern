import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-api-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { createApp } = await import("../src/server/app");
const { defaults, publicUrl, setServeAddress } = await import("../src/server/config");

const app = createApp({ demo: true });
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "x-tern": "1", "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

beforeAll(() => {
  db.openDb(join(dir, "t.db"));
  db.upsertAccount({ id: "a", email: "me@x.io", name: "Me", token: null });
  db.upsertMessages([{
    id: "1", account_id: "a", thread_id: "t", internal_date: 1, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [], subject: "Hi",
    snippet: "", text: "", html: "", labels: ["INBOX"], message_id: "", references: "", attachments: [],
  }]);
});

const expectError = async (res: Response, status: number, error: RegExp) => {
  expect(res.status).toBe(status);
  expect(((await res.json()) as { error: string }).error).toMatch(error);
};

test("bad input is a 400 that says what's wrong", async () => {
  await expectError(await call("POST", "/api/login", "not json"), 400, /JSON/);
  await expectError(await call("POST", "/api/accounts/complete", { url: "garbage" }), 400, /sign-in URL/);
  await expectError(await call("POST", "/api/accounts/complete", {}), 400, /sign-in URL/);
  await expectError(await call("PUT", "/api/settings", "{"), 400, /JSON/);
  await expectError(await call("GET", "/api/threads?cursor=garbage"), 400, /cursor/);
  await expectError(await call("GET", "/api/threads?limit=lots"), 400, /limit/);
  await expectError(await call("POST", "/api/threads/a/t/explode"), 400, /Unknown action/);
});

test("unknown ids are a 404", async () => {
  await expectError(await call("PATCH", "/api/accounts/nope", { name: "x" }), 404, /account/);
  await expectError(await call("DELETE", "/api/accounts/nope"), 404, /account/);
  await expectError(await call("POST", "/api/accounts/nope/sync"), 404, /account/);
  await expectError(await call("POST", "/api/threads/nope/nope/archive"), 404, /conversation/);
  await expectError(await call("POST", "/api/threads/a/nope/archive"), 404, /conversation/);
  await expectError(await call("POST", "/api/send", { accountId: "nope", to: "bo@x.io", subject: "", text: "" }), 404, /account/);
  await expectError(await call("POST", "/api/ai/summarize", { accountId: "a", threadId: "nope" }), 404, /conversation/);
  await expectError(await call("POST", "/api/ai/draft", { accountId: "a", threadId: "nope" }), 404, /conversation/);
});

test("good input still works", async () => {
  expect((await call("GET", "/api/threads?limit=1")).status).toBe(200);
  expect((await call("POST", "/api/threads/a/t/star")).status).toBe(200);
  expect((await call("PATCH", "/api/accounts/a", { name: "Me too" })).status).toBe(200);
  expect(db.getAccount("a")!.name).toBe("Me too");
});

test("the OAuth redirect uses the port Tern serves on", () => {
  const cfg = structuredClone(defaults);
  expect(publicUrl(cfg)).toBe("http://localhost:7420");
  setServeAddress({ hostname: "127.0.0.1", port: 7421 });
  expect(publicUrl(cfg)).toBe("http://localhost:7421");
  // an explicit public URL (a proxy in front) still wins
  expect(publicUrl({ ...cfg, publicUrl: "https://mail.example.com/" })).toBe("https://mail.example.com");
});
