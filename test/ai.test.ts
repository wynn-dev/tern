import { beforeAll, beforeEach, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "tern-ai-"));
process.env.TERN_HOME = dir;
const db = await import("../src/server/db");
const { saveConfig, loadConfig } = await import("../src/server/config");
const { AiError, aiStatus, classifyPending, claudeEnv, explainAiError } = await import("../src/server/ai");
const { seal } = await import("../src/server/crypto");
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

// ---------- your own endpoint ----------

// a `claude` that writes down the environment it was started with, then fails
const envDump = join(dir, "env.txt");
const envClaude = join(dir, "claude-env");
writeFileSync(envClaude, `#!/bin/sh\nenv > "${envDump}"\nexit 1\n`);
chmodSync(envClaude, 0o755);
const setEndpoint = (ai: Partial<ReturnType<typeof loadConfig>["ai"]>) =>
  saveConfig({ ...loadConfig(), ai: { ...loadConfig().ai, baseUrl: undefined, apiKey: undefined, keyHeader: undefined, enabled: true, claudePath: envClaude, ...ai } });
const dumpedEnv = () => Object.fromEntries(readFileSync(envDump, "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const inherited = { PATH: "/bin", HOME: "/home/me", ANTHROPIC_API_KEY: "sk-ant-billing", ANTHROPIC_AUTH_TOKEN: "inherited-token", ANTHROPIC_BASE_URL: "https://elsewhere.example" };

test("with no endpoint set, Claude Code gets no API key, token or base URL from the server's environment", async () => {
  setEndpoint({});
  const saved = { ...process.env };
  Object.assign(process.env, { ANTHROPIC_API_KEY: "sk-ant-billing", ANTHROPIC_AUTH_TOKEN: "inherited-token", ANTHROPIC_BASE_URL: "https://elsewhere.example" });
  try {
    rmSync(envDump, { force: true });
    await post("/api/ai/summarize", thread);
    const env = dumpedEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("tern/0.1");
  } finally {
    for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  expect(claudeEnv(loadConfig().ai, inherited)).toEqual({ PATH: "/bin", HOME: "/home/me", CLAUDE_AGENT_SDK_CLIENT_APP: "tern/0.1" });
  expect(aiStatus()).toMatchObject({ mode: "login", endpoint: null });
});

test("with an endpoint set, Claude Code gets its URL and its key as x-api-key", async () => {
  setEndpoint({ baseUrl: "http://127.0.0.1:9999", apiKey: seal("sk-mine") });
  const saved = process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.ANTHROPIC_AUTH_TOKEN = "inherited-token";
  try {
    rmSync(envDump, { force: true });
    await post("/api/ai/summarize", thread);
    const env = dumpedEnv();
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:9999");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-mine");
    expect(env.CLAUDE_CODE_MAX_RETRIES).toBe("2");
    // an inherited token would win over the key, so it's gone
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = saved;
  }
  expect(aiStatus()).toMatchObject({ mode: "endpoint", endpoint: "http://127.0.0.1:9999" });
});

test("with an endpoint set to Bearer, the key goes as ANTHROPIC_AUTH_TOKEN", () => {
  const env = claudeEnv({ ...loadConfig().ai, baseUrl: "https://llm.example.com", apiKey: seal("tok-mine"), keyHeader: "bearer" }, inherited);
  expect(env).toMatchObject({ ANTHROPIC_BASE_URL: "https://llm.example.com", ANTHROPIC_AUTH_TOKEN: "tok-mine" });
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
});

test("an endpoint without a key never starts Claude Code, which would send it the login's token", async () => {
  setEndpoint({ baseUrl: "https://llm.example.com" });
  expect(() => claudeEnv(loadConfig().ai, inherited)).toThrow(AiError);
  rmSync(envDump, { force: true });
  const res = await post("/api/ai/summarize", thread);
  expect(res.status).toBe(503);
  expect(((await res.json()) as { error: string }).error).toContain("API key");
  expect(existsSync(envDump)).toBe(false);
});

test("a refused key on your endpoint says so, not to sign in to Claude", () => {
  const raw = "Not logged in · Please run /login";
  const err = explainAiError(new Error(raw), "https://llm.example.com");
  expect(err.code).toBe("signed_out");
  expect(err.message).toContain("https://llm.example.com");
  expect(err.message).toContain("rejected the API key");
  expect(err.message).not.toContain("/login");
  expect(explainAiError(new Error("API Error: 401 authentication_error"), "https://llm.example.com").message).toContain("rejected the API key");
  expect(explainAiError(new Error("API Error: 429 rate_limit_error"), "https://llm.example.com").code).toBe("rate_limited");
  const model = "There's an issue with the selected model (claude-haiku-5-5). It may not exist or you may not have access to it.";
  expect(explainAiError(new Error(model), "https://llm.example.com").message).toContain("doesn't serve that model");
});

test("Settings seal the key at rest and only ever say whether one is set", async () => {
  setEndpoint({});
  const put = (ai: unknown) => app.request("/api/settings", { method: "PUT", headers: { "x-tern": "1", "content-type": "application/json" }, body: JSON.stringify({ ai }) });
  const get = async () => ((await (await app.request("/api/settings", { headers: { "x-tern": "1" } })).json()) as { ai: Record<string, unknown> }).ai;

  expect((await put({ baseUrl: "https://llm.example.com/", apiKey: " sk-secret-1 ", keyHeader: "bearer" })).status).toBe(200);
  const file = readFileSync(join(dir, "config.json"), "utf8");
  expect(file).not.toContain("sk-secret-1");
  expect(claudeEnv(loadConfig().ai, {}).ANTHROPIC_AUTH_TOKEN).toBe("sk-secret-1");
  const ai = await get();
  expect(ai).toMatchObject({ baseUrl: "https://llm.example.com", keyHeader: "bearer", apiKeySet: true });
  expect(ai.apiKey).toBeUndefined();
  expect(JSON.stringify(ai)).not.toContain(loadConfig().ai.apiKey!);

  // saving other fields keeps the key; a browser echoing apiKeySet back can't write it
  await put({ writeModel: "my-model", apiKeySet: false });
  expect(await get()).toMatchObject({ writeModel: "my-model", apiKeySet: true });

  expect((await put({ baseUrl: "ftp://nope" })).status).toBe(400);
  expect((await put({ keyHeader: "cookie" })).status).toBe(400);

  await put({ baseUrl: "", apiKey: "" });
  expect(await get()).toMatchObject({ apiKeySet: false });
  expect(loadConfig().ai.baseUrl).toBeUndefined();
  expect(loadConfig().ai.apiKey).toBeUndefined();
});
