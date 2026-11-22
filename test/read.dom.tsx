// Run by read.test.ts in a process of its own, for the same reason as a11y.dom.tsx: the page has to exist before any component is imported.
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";

const win = new GlobalWindow({ url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
for (const k of Object.getOwnPropertyNames(win)) {
  if (k in globalThis && !/^(Event|EventTarget|\w+Event)$/.test(k)) continue;
  try {
    g[k] = (win as unknown as Record<string, unknown>)[k];
  } catch {}
}
Object.assign(g, { window: win, document: win.document, navigator: win.navigator, location: win.location, history: win.history, IS_REACT_ACT_ENVIRONMENT: true });
for (let p = win.HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) delete (p as { animate?: unknown }).animate;
// live updates aren't under test: a stream that never says anything
g.EventSource = class { close() {} };
afterAll(() => void win.happyDOM.close());

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("../src/web/app");
const { TooltipProvider } = await import("../src/web/components/ui/tooltip");
const { useStore } = await import("../src/web/lib/store");
type Thread = import("../src/web/lib/api").Thread;
type Message = import("../src/web/lib/api").Message;
type AccountsResponse = import("../src/web/lib/api").AccountsResponse;

const thread = (i: number): Thread => ({
  account_id: "a", thread_id: `t${i}`, subject: `Thread ${i}`, snippet: "", last_date: 1000 - i, participants: [{ name: "Bo", email: "bo@x.io" }],
  count: 1, unread: 1, starred: 0, in_inbox: 1, in_sent: 0, in_trash: 0, in_spam: 0, has_attachments: 0, labels: [], category: "work", priority: 2,
  summary: null, needs_reply: 0, ai_at: 1,
});
const message = (t: Thread, id = "m1"): Message => ({
  id, account_id: "a", thread_id: t.thread_id, internal_date: t.last_date, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
  subject: t.subject, snippet: "", text: "Hello", html: "", labels: t.unread ? ["UNREAD"] : [], message_id: "", references: "", attachments: [],
});

/** The server: its threads, and every action the client sent it. */
let server: Thread[];
let sent: string[];
/** How long opening a thread takes; flicking through is faster than this. */
let threadDelay: number;
const counts = () => {
  const n = server.filter((t) => t.unread && t.in_inbox).length;
  return { accounts: { a: { inboxUnread: n, needsReply: 0, categories: { work: n } } }, categories: { work: n } };
};
const accounts = (): AccountsResponse => ({
  accounts: [{ id: "a", email: "me@x.io", name: "", color: "oklch(0.6 0.17 260)", status: "idle", error: null, connected: true }],
  counts: counts(),
  labels: [],
});
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
g.fetch = async (url: string, init?: RequestInit) => {
  const path = new URL(url, "http://localhost").pathname;
  const act = path.match(/^\/api\/threads\/(\w+)\/(\w+)\/(\w+)$/);
  if (act && init?.method === "POST") {
    sent.push(`${act[2]}:${act[3]}`);
    server = server.map((t) => (t.thread_id === act[2] ? { ...t, unread: act[3] === "read" ? 0 : act[3] === "unread" ? 1 : t.unread } : t));
    return json({ ok: true });
  }
  const one = path.match(/^\/api\/threads\/(\w+)\/(\w+)$/);
  if (one) {
    await new Promise((r) => setTimeout(r, threadDelay));
    const t = server.find((t) => t.thread_id === one[2])!;
    return json({ thread: t, messages: [message(t)] });
  }
  if (path === "/api/threads") return json({ threads: server, next: null });
  if (path === "/api/accounts") return json(accounts());
  if (path === "/api/session") return json({ authed: true, passwordRequired: false, demo: true });
  return new Response("{}", { status: 404 });
};

let qc: InstanceType<typeof QueryClient>;
let unmount: (() => Promise<void>) | undefined;
async function render() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["session"], { authed: true, passwordRequired: false, demo: true });
  qc.setQueryData(["accounts"], accounts());
  qc.setQueryData(["ai-status"], { enabled: false, claudePath: null, busy: false, lastError: null, lastErrorCode: null, classified: 0 });
  qc.setQueryData(["threads", "inbox", null, ""], { pages: [{ threads: server, next: null }], pageParams: [undefined] });
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  );
  unmount = async () => {
    await act(async () => root.unmount());
    el.remove();
  };
}
beforeEach(() => {
  server = Array.from({ length: 12 }, (_, i) => thread(i));
  sent = [];
  threadDelay = 40;
  useStore.setState({ view: "inbox", account: null, query: "", selected: null, compose: null, settingsOpen: false, paletteOpen: false });
});
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

const press = (key: string) => act(() => void document.body.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as unknown as Event));
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const listed = () => qc.getQueryData<{ pages: { threads: Thread[] }[] }>(["threads", "inbox", null, ""])!.pages[0].threads;
const inboxUnread = () => qc.getQueryData<AccountsResponse>(["accounts"])!.counts.accounts.a.inboxUnread;
const header = () => document.querySelector('section[aria-label="Conversations"] header')?.textContent ?? "";

test("flicking through 10 unread threads with j marks every one read at once, sending each read once", async () => {
  await render();
  expect(header()).toContain("12 unread");
  for (let i = 0; i < 10; i++) await press("j");
  // before any thread has loaded or the server has answered: the list, the counts and the header already say so
  expect(useStore.getState().selected).toBe("a:t9");
  expect(listed().map((t) => t.unread)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  expect(inboxUnread()).toBe(2);
  expect(header()).toContain("2 unread");

  // and once everything has settled, they stay read, each sent once
  await wait(300);
  expect(sent.sort()).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}:read`).sort());
  expect(server.filter((t) => t.unread).map((t) => t.thread_id)).toEqual(["t10", "t11"]);
  expect(listed().filter((t) => t.unread).map((t) => t.thread_id)).toEqual(["t10", "t11"]);
  expect(inboxUnread()).toBe(2);
});

test("Mark unread on the open thread sticks, and new mail in it marks it read again", async () => {
  await render();
  await press("j");
  await wait(150);
  expect(sent).toEqual(["t0:read"]);
  await press("u");
  await wait(150);
  expect(sent).toEqual(["t0:read", "t0:unread"]);
  expect(listed()[0].unread).toBe(1);

  // a reply arrives in the open thread
  const t = { ...server[0], last_date: 2000, count: 2 };
  server = server.map((s) => (s.thread_id === "t0" ? t : s));
  await act(async () => qc.setQueryData(["thread", "a:t0"], { thread: t, messages: [message(t), message(t, "m2")] }));
  await wait(150);
  expect(sent).toEqual(["t0:read", "t0:unread", "t0:read"]);
});

test("a read the server refuses puts back that thread and the count, not the others read since", async () => {
  await render();
  const ok = g.fetch as typeof fetch;
  g.fetch = (async (url: string, init?: RequestInit) =>
    String(url).endsWith("/t1/read") ? new Response(JSON.stringify({ error: "nope" }), { status: 500 }) : ok(url, init)) as typeof fetch;
  try {
    for (let i = 0; i < 3; i++) await press("j");
    await wait(300);
  } finally {
    g.fetch = ok;
  }
  expect(listed().slice(0, 3).map((t) => t.unread)).toEqual([0, 1, 0]);
  expect(inboxUnread()).toBe(10);
});
