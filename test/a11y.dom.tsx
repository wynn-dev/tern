// Run by a11y.test.ts in a process of its own: Radix decides at import time whether there's a DOM,
// so the page has to exist before any component is imported, and in a shared run other test files import them first.
import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";

// a page for React to render into; the components read window, document and friends as globals
const win = new GlobalWindow({ url: "http://localhost/" });
const g = globalThis as Record<string, unknown>;
for (const k of Object.getOwnPropertyNames(win)) {
  // Bun has its own Event classes; the page's events must be the page's
  if (k in globalThis && !/^(Event|EventTarget|\w+Event)$/.test(k)) continue;
  try {
    g[k] = (win as unknown as Record<string, unknown>)[k];
  } catch {}
}
Object.assign(g, { window: win, document: win.document, navigator: win.navigator, location: win.location, history: win.history, IS_REACT_ACT_ENVIRONMENT: true });
// motion animates in JS without the Web Animations API, whose canceled animations reject here
for (let p = win.HTMLElement.prototype; p; p = Object.getPrototypeOf(p)) delete (p as { animate?: unknown }).animate;
// nothing here talks to a server: every query is seeded below
g.fetch = async () => new Response("{}", { status: 404 });
afterAll(() => void win.happyDOM.close());

const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { Sidebar } = await import("../src/web/components/sidebar");
const { ThreadList } = await import("../src/web/components/thread-list");
const { Reader, replyDraft } = await import("../src/web/components/reader");
const { Composer } = await import("../src/web/components/composer");
const { SettingsDialog } = await import("../src/web/components/settings");
const { CommandPalette } = await import("../src/web/components/command-palette");
const { TooltipProvider } = await import("../src/web/components/ui/tooltip");
const { useStore } = await import("../src/web/lib/store");
type Api = typeof import("../src/web/lib/api");
type Thread = import("../src/web/lib/api").Thread;
type Message = import("../src/web/lib/api").Message;

const account = (id: string, email: string, p: Partial<Awaited<ReturnType<Api["api"]["accounts"]>>["accounts"][number]> = {}) => ({
  id, email, name: "", color: "oklch(0.6 0.17 260)", status: "idle", error: null, connected: true, ...p,
});
const thread: Thread = {
  account_id: "a", thread_id: "t1", subject: "Roadmap", snippet: "Can we meet?", last_date: Date.now(), participants: [{ name: "Priya", email: "priya@x.io" }],
  count: 2, unread: 0, starred: 0, in_inbox: 1, in_sent: 0, in_trash: 0, in_spam: 0, has_attachments: 0, labels: [], category: "work", priority: 2,
  summary: "Priya asks to meet Thursday.", needs_reply: 1, ai_at: 1,
};
const message = (id: string, text: string): Message => ({
  id, account_id: "a", thread_id: "t1", internal_date: Date.now(), from_name: "Priya", from_email: "priya@x.io", to: [{ name: "", email: "me@x.io" }],
  cc: [], subject: "Roadmap", snippet: text, text, html: "", labels: [], message_id: "", references: "", attachments: [],
});
const messages = [message("m1", "First"), message("m2", "Thursday?\n\nOn Mon, Priya wrote:\n> First")];

const accounts = [account("a", "me@x.io"), account("b", "broken@x.io", { status: "error", error: "Sign-in expired. Reconnect this account." })];

function client(accs = accounts) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  qc.setQueryData(["session"], { authed: true, passwordRequired: true, demo: false });
  qc.setQueryData(["accounts"], {
    accounts: accs,
    counts: { accounts: { a: { inboxUnread: 1, needsReply: 1, categories: { work: 1 } } }, categories: { work: 1 } },
    labels: [{ account_id: "a", id: "L1", name: "Clients" }],
  });
  qc.setQueryData(["ai-status"], { enabled: true, claudePath: "/bin/claude", busy: false, lastError: null, lastErrorCode: null, classified: 3 });
  qc.setQueryData(["settings"], { google: { configured: false, clientId: "" }, redirectUri: "http://localhost:7420/oauth/callback", ai: { enabled: true, classifyModel: "claude-haiku-5-5", writeModel: "claude-sonnet-5-5" } });
  qc.setQueryData(["threads", "inbox", null, ""], { pages: [{ threads: [thread], next: null }], pageParams: [undefined] });
  qc.setQueryData(["thread", "a:t1"], { thread, messages });
  return qc;
}

async function render(accs = accounts) {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client(accs)}>
        <TooltipProvider>
          <div className="flex h-full">
            <Sidebar />
            <ThreadList />
            <Reader />
            <Composer />
            <CommandPalette />
            <SettingsDialog />
          </div>
        </TooltipProvider>
      </QueryClientProvider>,
    ),
  );
  mounted = async () => {
    await act(async () => root.unmount());
    el.remove();
  };
}
let mounted: (() => Promise<void>) | undefined;
afterEach(async () => {
  await act(async () => useStore.setState({ compose: null, settingsOpen: false, paletteOpen: false }));
  await mounted?.();
  mounted = undefined;
});

/** What a screen reader calls it, near enough: aria-labelledby, aria-label, then its text (sr-only text included), then title. */
function accessibleName(el: Element) {
  const by = el.getAttribute("aria-labelledby");
  if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  return (el.getAttribute("aria-label") ?? el.textContent ?? "").trim() || (el.getAttribute("title") ?? "").trim();
}
/** Every control on the page that has no name, as a short snippet to find it by. */
const unnamed = () =>
  [...document.querySelectorAll("button, [role=button], [role=switch], [role=checkbox], a[href], input:not([type=hidden]), select, textarea")]
    .filter((el) => !accessibleName(el) && !(el.id && document.querySelector(`label[for="${el.id}"]`)) && !el.closest("label"))
    .map((el) => el.outerHTML.slice(0, 160));

test("every button, switch and field on the main screen, the reader and the composer has a name", async () => {
  useStore.setState({ view: "inbox", account: null, query: "", selected: "a:t1", compose: null, settingsOpen: false, paletteOpen: false });
  await render();
  await act(async () => useStore.getState().openCompose(replyDraft(thread, messages, "me@x.io", false)));
  // the reader's quoted-text toggle shows once a message with a quote is open
  expect(document.querySelector('[aria-label="Show quoted text"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Archive"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="More"]')).not.toBeNull();
  expect(unnamed()).toEqual([]);

  // landmarks: the list is a named region, and the composer a named, non-modal dialog
  expect(document.querySelector('section[aria-label="Conversations"]')?.querySelector("#search")).not.toBeNull();
  const composer = document.querySelector('[role=dialog][aria-label="Reply"]');
  expect(composer).not.toBeNull();
  expect(composer!.getAttribute("aria-modal")).toBeNull();

  // minimized, it says so, and its buttons keep their names
  await act(async () => useStore.getState().minimizeCompose(true));
  expect(document.querySelector('[role=dialog][aria-label="Reply (minimized)"]')).not.toBeNull();
  expect(unnamed()).toEqual([]);
});

test("Settings and the palette name their switch, icon buttons and close X", async () => {
  useStore.setState({ selected: null, compose: null, settingsOpen: true, paletteOpen: false });
  await render();
  expect(document.querySelector('[role=switch][aria-label="Sort, summarize and draft with Claude"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Remove broken@x.io"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Copy the redirect URI"]')).not.toBeNull();
  expect([...document.querySelectorAll("[role=dialog] button")].some((b) => accessibleName(b) === "Close")).toBe(true);
  expect(unnamed()).toEqual([]);

  await act(async () => useStore.setState({ settingsOpen: false, paletteOpen: true }));
  expect(unnamed()).toEqual([]);
});

test("the broken account's empty state says 'reconnect' once", async () => {
  const { brokenHint } = await import("../src/web/components/thread-list");
  expect(brokenHint({ error: "Sign-in expired. Reconnect this account." })).toBe("Sign-in expired. Reconnect this account.");
  expect(brokenHint({ error: "invalid_grant" })).toBe("invalid_grant Reconnect it to see its mail.");
  expect(brokenHint({ error: null })).toBe("Tern can't reach this account. Reconnect it to see its mail.");
});

test("an account Gmail is rate-limiting says so plainly in the sidebar, the list and Settings", async () => {
  const catchingUp = "Gmail is rate-limiting Tern, catching up";
  useStore.setState({ view: "inbox", account: null, query: "", selected: null, compose: null, settingsOpen: true, paletteOpen: false });
  await render([account("a", "me@x.io"), account("c", "busy@x.io", { status: "limited", error: catchingUp })]);
  expect(document.querySelector(`nav [role=img][aria-label="busy@x.io: ${catchingUp}"]`)).not.toBeNull();
  expect(document.querySelector('section[aria-label="Conversations"] [role=status]')?.textContent).toBe(`${catchingUp}: busy@x.io`);
  expect(document.querySelector("[role=dialog]")?.textContent).toContain(`busy@x.io${catchingUp}`);
  // not a broken account: nothing asks to reconnect it
  expect(document.body.textContent).not.toContain("Couldn't sync");
  expect(document.querySelector('[role=alert]')).toBeNull();
});
