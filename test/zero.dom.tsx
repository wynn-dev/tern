// Run by zero.test.ts in a process of its own, for the same reason as a11y.dom.tsx: the page has to exist before any component is imported.
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
// a page with room: the list's virtualizer renders rows only into space it can see
for (const [k, v] of [["clientWidth", 400], ["clientHeight", 800]] as const) Object.defineProperty(win.HTMLElement.prototype, k, { get: () => v, configurable: true });
// live updates aren't under test: a stream that never says anything
g.EventSource = class { close() {} };
afterAll(() => void win.happyDOM.close());

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("../src/web/app");
const { TooltipProvider } = await import("../src/web/components/ui/tooltip");
const { resetZeroMoment } = await import("../src/web/components/inbox-zero");
const { useStore } = await import("../src/web/lib/store");
type Thread = import("../src/web/lib/api").Thread;
type Stats = import("../src/web/lib/api").Stats;
type AccountsResponse = import("../src/web/lib/api").AccountsResponse;

const thread = (i: number, unread: number): Thread => ({
  account_id: "a", thread_id: `t${i}`, subject: `Thread ${i}`, snippet: "", last_date: 1000 - i, participants: [{ name: "Bo", email: "bo@x.io" }],
  count: 1, unread, starred: 0, in_inbox: 1, in_sent: 0, in_trash: 0, in_spam: 0, has_attachments: 0, labels: [], category: "work", priority: 2,
  summary: null, needs_reply: 0, ai_at: 1,
});

let server: Thread[];
let stats: Stats;
const clearedIds = new Set<string>();
let statsHeld = false;
/** Actions wait on this before the server answers: what shows meanwhile is the client's own. */
let answered: Promise<void> = Promise.resolve();
let answer = () => {};
const holdAnswers = () => void (answered = new Promise<void>((r) => (answer = r)));
const accounts = (): AccountsResponse => {
  const inbox = server.filter((t) => t.in_inbox), n = inbox.filter((t) => t.unread).length;
  return {
    accounts: [{ id: "a", email: "me@x.io", name: "", color: "oklch(0.6 0.17 260)", status: "idle", error: null, connected: true }],
    counts: { accounts: { a: { inbox: inbox.length, inboxUnread: n, needsReply: 0, categories: { work: n } } }, categories: { work: n } },
    labels: [],
  };
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
g.fetch = async (url: string, init?: RequestInit) => {
  const path = new URL(url, "http://localhost").pathname;
  const act = path.match(/^\/api\/threads\/(\w+)\/(\w+)\/(\w+)$/);
  if (act && init?.method === "POST") {
    await answered;
    // as the server counts: a thread read or archived today, once
    if ((act[3] === "archive" || server.find((t) => t.thread_id === act[2])?.unread) && !clearedIds.has(act[2])) {
      clearedIds.add(act[2]);
      stats = { ...stats, cleared: stats.cleared + 1 };
    }
    server = server.map((t) => (t.thread_id !== act[2] ? t : act[3] === "read" ? { ...t, unread: 0 } : act[3] === "archive" ? { ...t, in_inbox: 0 } : act[3] === "inbox" ? { ...t, in_inbox: 1 } : t));
    return json({ ok: true });
  }
  const one = path.match(/^\/api\/threads\/(\w+)\/(\w+)$/);
  if (one) {
    const t = server.find((t) => t.thread_id === one[2])!;
    const m = {
      id: "m1", account_id: "a", thread_id: t.thread_id, internal_date: t.last_date, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
      subject: t.subject, snippet: "", text: "Hello", html: "", labels: [], message_id: "", references: "", attachments: [],
    };
    return json({ thread: t, messages: [m] });
  }
  if (path === "/api/threads") return json({ threads: server.filter((t) => t.in_inbox), next: null });
  if (path === "/api/accounts") return json(accounts());
  // held: the count shown is the client's own, never a refetch
  if (path === "/api/stats") return statsHeld ? new Promise<Response>(() => {}) : json(stats);
  if (path === "/api/session") return json({ authed: true, passwordRequired: false, demo: true });
  return new Response("{}", { status: 404 });
};

let qc: InstanceType<typeof QueryClient>;
let unmount: (() => Promise<void>) | undefined;
async function render() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["session"], { authed: true, passwordRequired: false, demo: true });
  qc.setQueryData(["accounts"], accounts());
  qc.setQueryData(["stats", null], stats);
  qc.setQueryData(["ai-status"], { enabled: false, claudePath: null, busy: false, lastError: null, lastErrorCode: null, classified: 0 });
  qc.setQueryData(["threads", "inbox", null, ""], { pages: [{ threads: server.filter((t) => t.in_inbox), next: null }], pageParams: [undefined] });
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
  resetZeroMoment();
  stats = { today: "2026-11-22", cleared: 0, zeroToday: false, streak: 2, days: [] };
  statsHeld = false;
  // the All view, as the inbox was before Unread: these are about the list as it is
  useStore.setState({ view: "inbox", account: null, query: "", selected: null, compose: null, settingsOpen: false, paletteOpen: false, inboxShows: { "": "all" } });
});
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
/**
 * A key, and what it renders: React Query hands cache updates to React on a timer (its notifyManager), which a
 * synchronous act() doesn't always wait for. Every action's server answer is held where a test says "at once",
 * so this little wait never lets one in.
 */
async function press(key: string) {
  act(() => void document.body.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as unknown as Event));
  await wait(10);
}
const list = () => document.querySelector('section[aria-label="Conversations"]')!;
const header = () => list().querySelector("header")?.textContent ?? "";
const band = () => list().querySelector('[role="status"][aria-label="Zero unread"]');
const pane = () => document.querySelector("main [data-zero]");

test("with unread mail there's no zero moment, and nothing cleared yet says nothing", async () => {
  server = [thread(0, 1), thread(1, 0)];
  await render();
  expect(header()).toContain("1 unread");
  expect(header()).not.toContain("cleared");
  expect(band()).toBeNull();
  expect(pane()).toBeNull();
  expect(document.querySelector("main")?.textContent).toContain("Pick a conversation");
});

test("at zero unread, with read mail still listed, the list has the band and the reader the day's art and stats", async () => {
  server = [thread(0, 0), thread(1, 0)];
  stats = { ...stats, cleared: 7, zeroToday: true, streak: 3 };
  await render();
  expect(band()?.textContent).toContain("Zero unread");
  expect(band()?.textContent).toContain("7 cleared today · 3-day streak");
  expect(pane()?.textContent).toContain("Zero unread");
  expect(pane()?.textContent).toContain("7 cleared today");
  expect(pane()?.textContent).toContain("3-day streak");
  expect(pane()?.querySelector("svg.zero-art")?.getAttribute("data-art")).toMatch(/^\w+-\w+$/);
  // the first time this page is at zero, it comes in once
  expect(pane()?.querySelector("svg.zero-enter")).not.toBeNull();
});

test("an empty inbox is Inbox zero", async () => {
  server = [];
  await render();
  expect(pane()?.textContent).toContain("Inbox zero");
});

test("reading the last unread thread brings the moment at once, and counts toward today", async () => {
  server = [thread(0, 1), thread(1, 0)];
  stats = { ...stats, cleared: 4, streak: 2 };
  await render();
  expect(band()).toBeNull();
  holdAnswers();
  await press("j");
  // before the server answers: the count is down, today has one more, and the streak counts today
  expect(header()).not.toContain("unread");
  expect(header()).toContain("5 cleared today");
  expect(band()?.textContent).toContain("5 cleared today · 3-day streak");
  // back to the list: the reader is the moment
  await press("Escape");
  await wait(200);
  expect(pane()?.textContent).toContain("Zero unread");
  answer();
  await wait(50);
  expect(header()).toContain("5 cleared today");
});

test("archiving moves on to the next thread at once, counts it, and draws the row leaving", async () => {
  // threads of its own: one read here earlier today would count once, as it does on the server
  server = [thread(10, 1), thread(11, 1), thread(12, 1)];
  await render();
  holdAnswers();
  await press("j");
  expect(header()).toContain("2 unread");
  await press("e");
  // the next one is open (and read) straight away; the archived row is drawn leaving, not in the list
  expect(useStore.getState().selected).toBe("a:t11");
  expect(header()).toContain("1 unread");
  expect(header()).toContain("2 cleared today");
  const leaving = list().querySelectorAll(".row-out");
  expect(leaving.length).toBe(1);
  expect(leaving[0].getAttribute("aria-hidden")).toBe("true");
  expect(leaving[0].querySelector("[data-thread]")?.getAttribute("data-thread")).toBe("a:t10");
  await wait(300);
  expect(list().querySelectorAll(".row-out").length).toBe(0);
  answer();
  await wait(50);
  // read and archived is one thread cleared, and the next one read is another
  expect(header()).toContain("2 cleared today");
});

test("undoing an archive takes it back off today's count at once, and archiving it again counts it again", async () => {
  // already read: only the archive counts
  server = [thread(20, 0), thread(21, 0)];
  stats = { ...stats, cleared: 2 };
  statsHeld = true;
  await render();
  await press("j");
  expect(header()).toContain("2 cleared today");
  await press("e");
  expect(header()).toContain("3 cleared today");
  // the undo is there once the archive has been answered
  await wait(50);
  await press("z");
  expect(header()).toContain("2 cleared today");
  await wait(50);
  // the list refetched, as the live updates have it: the thread is back
  await act(() => qc.invalidateQueries({ queryKey: ["threads"] }));
  await wait(50);
  await press("k");
  expect(useStore.getState().selected).toBe("a:t20");
  await press("e");
  expect(header()).toContain("3 cleared today");
});
