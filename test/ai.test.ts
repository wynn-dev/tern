import { beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-ai-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { saveConfig, loadConfig } = await import("../src/server/config");
const { aiStatus, classifyPending, explainAiError } = await import("../src/server/ai");
const { createApp } = await import("../src/server/app");

// a `claude` that isn't signed in: it logs each call, then fails the way Claude Code does
const calls = join(dir, "calls.log");
const fakeClaude = join(dir, "claude");
writeFileSync(fakeClaude, `#!/bin/sh\necho called >> "${calls}"\necho "Invalid API key · Please run /login" >&2\nexit 1\n`);
chmodSync(fakeClaude, 0o755);

const app = createApp({ demo: false });
const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "x-tern": "1", "content-type": "application/json" }, body: JSON.stringify(body) });
const thread = { accountId: "a", threadId: "t" };
const setAi = (enabled: boolean) => saveConfig({ ...loadConfig(), ai: { ...loadConfig().ai, enabled, claudePath: fakeClaude } });

beforeAll(() => {
  db.openDb(join(dir, "t.db"));
  db.upsertAccount({ id: "a", email: "me@x.io", name: "Me", token: null });
  db.upsertMessages([
    {
      id: "1", account_id: "a", thread_id: "t", internal_date: 1, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
      subject: "Lunch?", snippet: "", text: "lunch on friday?", html: "", labels: ["INBOX", "UNREAD"], message_id: "", references: "", attachments: [],
    },
  ]);
});

beforeEach(() => rmSync(calls, { force: true }));

test("with AI off, summarize, draft and classify refuse and nothing reaches Claude", async () => {
  setAi(false);
  for (const [path, body] of [["/api/ai/summarize", thread], ["/api/ai/draft", { ...thread, instruction: "yes" }], ["/api/ai/classify", {}]] as const) {
    const res = await post(path, body);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "off", error: "AI is turned off in Settings." });
  }
  await classifyPending();
  expect(existsSync(calls)).toBe(false);
});

test("not signed in to Claude reads as a sign-in hint, and the status shows it", async () => {
  setAi(true);
  const res = await post("/api/ai/summarize", thread);
  expect(res.status).toBe(503);
  const { error, code } = (await res.json()) as { error: string; code: string };
  expect(code).toBe("signed_out");
  expect(error).toContain("claude /login");
  expect(error).not.toContain("exited with code");
  expect(readFileSync(calls, "utf8")).toContain("called");
  expect(aiStatus()).toMatchObject({ lastErrorCode: "signed_out", lastError: error });
});

test("a background sort that finds nothing to do doesn't clear the last failure", async () => {
  setAi(true);
  await post("/api/ai/summarize", thread);
  db.setThreadAi("a", "t", { category: "personal", priority: 1, summary: "Lunch", needs_reply: true });
  await classifyPending();
  expect(aiStatus().lastErrorCode).toBe("signed_out");
});

// a fresh inbox thread, so the background sort has something to do
const freshThread = (id: string) =>
  db.upsertMessages([
    {
      id, account_id: "a", thread_id: id, internal_date: Date.now(), from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
      subject: "Dinner?", snippet: "", text: "dinner on saturday?", html: "", labels: ["INBOX"], message_id: "", references: "", attachments: [],
    },
  ]);

test("a sort with nothing to do doesn't stop later sorts", async () => {
  setAi(true);
  db.setThreadAi("a", "t", { category: "personal", priority: 1, summary: "Lunch", needs_reply: true });
  await classifyPending();
  freshThread("t2");
  await classifyPending();
  expect(existsSync(calls) && readFileSync(calls, "utf8")).toContain("called");
});

test("a failed background sort logs its error once", async () => {
  setAi(true);
  freshThread("t3");
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    await classifyPending();
    expect(log.mock.calls.filter(([tag]) => tag === "[ai]")).toHaveLength(1);
  } finally {
    log.mockRestore();
  }
});

test("maps Claude Code failures to plain messages", () => {
  const cases: [string, string][] = [
    ["Claude Code process exited with code 1. stderr: Invalid API key · Please run /login", "signed_out"],
    ["Claude Code executable not found at /usr/bin/claude. Is options.pathToClaudeCodeExecutable set?", "missing"],
    ["spawn claude ENOENT", "missing"],
    ["Claude AI usage limit reached|1764000000", "rate_limited"],
    ["API Error: 429 rate_limit_error", "rate_limited"],
    ["Claude: error_max_turns", "failed"],
  ];
  for (const [raw, code] of cases) {
    const err = explainAiError(new Error(raw));
    expect(err.code).toBe(code as typeof err.code);
    expect(err.message).not.toContain(raw);
    expect(err.detail).toBe(raw);
  }
});
