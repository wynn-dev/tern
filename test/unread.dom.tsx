// Run by unread.test.ts in a process of its own, for the same reason as a11y.dom.tsx: the page has to exist before any component is imported.
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
const { storedShows, useStore } = await import("../src/web/lib/store");
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
/** The lists the client asked the server for: `unread` or `all`. */
let asked: string[];
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
  const u = new URL(url, "http://localhost");
  const path = u.pathname;
  const act = path.match(/^\/api\/threads\/(\w+)\/(\w+)\/(\w+)$/);
  if (act && init?.method === "POST") {
    if (server.find((t) => t.thread_id === act[2])?.unread && act[3] === "read") stats = { ...stats, cleared: stats.cleared + 1 };
    server = server.map((t) => (t.thread_id !== act[2] ? t : act[3] === "read" ? { ...t, unread: 0 } : act[3] === "unread" ? { ...t, unread: 1 } : act[3] === "archive" ? { ...t, in_inbox: 0 } : t));
    // as the server marks the day: zero unread reached by something done here
    if (!stats.zeroToday && !accounts().counts.accounts.a.inboxUnread) stats = { ...stats, zeroToday: true, streak: stats.streak + 1 };
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
  if (path === "/api/threads") {
    const unread = u.searchParams.get("unread") === "1";
    asked.push(unread ? "unread" : "all");
    return json({ threads: server.filter((t) => t.in_inbox && (!unread || t.unread)), next: null });
  }
  if (path === "/api/accounts") return json(accounts());
  if (path === "/api/stats") return json(stats);
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
  qc.setQueryData(["threads", "inbox", null, "", "unread"], { pages: [{ threads: server.filter((t) => t.in_inbox && t.unread), next: null }], pageParams: [undefined] });
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
  localStorage.clear();
  server = [thread(0, 1), thread(1, 1), thread(2, 0), thread(3, 1)];
  stats = { today: "2026-11-22", cleared: 3, zeroToday: false, streak: 2, days: [] };
  asked = [];
  // as a first visit: nothing saved, so the Inbox is Unread
  useStore.setState({ view: "inbox", account: null, query: "", selected: null, compose: null, settingsOpen: false, paletteOpen: false, inboxShows: storedShows() });
});
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
});

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
async function press(key: string) {
  act(() => void document.body.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }) as unknown as Event));
  await wait(10);
}
const list = () => document.querySelector('section[aria-label="Conversations"]')!;
/** The rows listed, not the ones drawn leaving. */
const rows = () => [...list().querySelectorAll("[data-thread]")].filter((r) => !r.closest(".row-out")).map((r) => r.getAttribute("data-thread"));
const leaving = () => [...list().querySelectorAll(".row-out [data-thread]")].map((r) => r.getAttribute("data-thread"));
const toggle = (name: string) => [...list().querySelectorAll<HTMLButtonElement>('[role="group"] button')].find((b) => b.textContent === name)!;
const zeroScreen = () => list().querySelector("[data-zero]");

test("the Inbox opens on Unread: only unread threads are listed, and the toggle says so", async () => {
  await render();
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t3"]);
  expect(toggle("Unread").getAttribute("aria-pressed")).toBe("true");
  expect(toggle("All").getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelector("main")?.textContent).toContain("Pick a conversation");
});

test("an opened thread stays listed, read, while it's open, and leaves when you move on", async () => {
  await render();
  await press("j");
  expect(useStore.getState().selected).toBe("a:t0");
  // read at once, and still where it was
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t3"]);
  expect(list().querySelector('[data-thread="a:t0"] .bg-brand')).toBeNull();
  // the server's list no longer has it (read there too): it stays while it's open
  await act(() => qc.invalidateQueries({ queryKey: ["threads"] }));
  await wait(50);
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t3"]);

  await press("j");
  expect(useStore.getState().selected).toBe("a:t1");
  // gone from the list, drawn sliding out where it was; the next one is now where the cursor was
  expect(rows()).toEqual(["a:t1", "a:t3"]);
  expect(leaving()).toEqual(["a:t0"]);
  await wait(300);
  expect(leaving()).toEqual([]);

  // closing it is moving on too
  await press("Escape");
  expect(rows()).toEqual(["a:t3"]);
});

test("reading through every unread thread with j empties the list, and the zero moment takes the list's and the reader's place", async () => {
  await render();
  for (let i = 0; i < 3; i++) await press("j");
  expect(useStore.getState().selected).toBe("a:t3");
  // the last one, read and open: still listed, still in the reader, no moment over it yet
  expect(rows()).toEqual(["a:t3"]);
  expect(zeroScreen()).toBeNull();
  expect(document.querySelector("main")).not.toBeNull();

  // j once more: nowhere to go, so it closes and leaves
  await press("j");
  expect(useStore.getState().selected).toBeNull();
  expect(rows()).toEqual([]);
  expect(document.querySelector("main")).toBeNull();
  expect(zeroScreen()?.textContent).toContain("Zero unread");
  expect(zeroScreen()?.textContent).toContain("6 cleared today");
  expect(zeroScreen()?.textContent).toContain("3-day streak");
  expect(zeroScreen()?.querySelector("svg.zero-art")).not.toBeNull();
  // the header keeps its counts and the way back to All
  expect(list().querySelector("header")?.textContent).toContain("6 cleared today");
  expect(list().querySelector("header")?.textContent).not.toContain("unread");
  expect(toggle("All")).toBeTruthy();
});

test("new mail shows up in the Unread view as soon as the list refreshes, and the moment gives way to it", async () => {
  server = [thread(2, 0)];
  await render();
  await wait(20);
  expect(zeroScreen()).not.toBeNull();
  server = [{ ...thread(9, 1), last_date: 5000 }, ...server];
  await act(async () => {
    await qc.invalidateQueries({ queryKey: ["threads"] });
    await qc.invalidateQueries({ queryKey: ["accounts"] });
  });
  await wait(50);
  expect(rows()).toEqual(["a:t9"]);
  expect(zeroScreen()).toBeNull();
  expect(document.querySelector("main")).not.toBeNull();
});

test("All shows the read Inbox mail again, by the toggle or V, and the choice survives a reload", async () => {
  await render();
  await act(async () => toggle("All").click());
  await wait(50);
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t2", "a:t3"]);
  expect(asked).toContain("all");
  expect(toggle("All").getAttribute("aria-pressed")).toBe("true");
  expect(JSON.parse(localStorage.getItem("tern-inbox-shows")!)).toEqual({ "": "all" });

  // a reload starts from what was saved
  await unmount!();
  useStore.setState({ inboxShows: storedShows(), selected: null });
  qc.clear();
  await render();
  await wait(50);
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t2", "a:t3"]);

  // V goes back to Unread
  await press("v");
  await wait(50);
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t3"]);
  expect(JSON.parse(localStorage.getItem("tern-inbox-shows")!)).toEqual({ "": "unread" });
});

test("the choice is per account: All for one account leaves All accounts on Unread", async () => {
  await render();
  await act(async () => useStore.getState().setView("inbox", "a"));
  await press("v");
  expect(useStore.getState().inboxShows).toEqual({ a: "all" });
  await act(async () => useStore.getState().setView("inbox", null));
  await wait(20);
  expect(toggle("Unread").getAttribute("aria-pressed")).toBe("true");
  // and V does nothing outside the Inbox
  await act(async () => useStore.getState().setView("starred"));
  await press("v");
  expect(useStore.getState().inboxShows).toEqual({ a: "all" });
});

test("switching to Unread with a read thread open keeps it listed until you move on", async () => {
  useStore.setState({ inboxShows: { "": "all" } });
  await render();
  qc.setQueryData(["threads", "inbox", null, ""], { pages: [{ threads: server, next: null }], pageParams: [undefined] });
  await act(async () => useStore.setState({ selected: "a:t2" }));
  await press("v");
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t2", "a:t3"]);
  await press("j");
  expect(useStore.getState().selected).toBe("a:t3");
  expect(rows()).toEqual(["a:t0", "a:t1", "a:t3"]);
});
