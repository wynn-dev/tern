import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { Window } from "happy-dom";
import type { Action, Message, Thread } from "../src/web/lib/api";
import { makeActions, staysInView } from "../src/web/hooks/data";
import { keyHandler } from "../src/web/hooks/keyboard";
import { useStore } from "../src/web/lib/store";

const thread = (id: string, p: Partial<Thread> = {}): Thread => ({
  account_id: "a", thread_id: id, subject: id, snippet: "", last_date: 0, participants: [], count: 1, unread: 0, starred: 0,
  in_inbox: 1, in_sent: 0, in_trash: 0, in_spam: 0, has_attachments: 0, labels: [], category: null, priority: null,
  summary: null, needs_reply: null, ai_at: null, ...p,
});
const message = (t: Thread): Message => ({
  id: "m1", account_id: t.account_id, thread_id: t.thread_id, internal_date: 0, from_name: "Bo", from_email: "bo@x.io", to: [], cc: [],
  subject: t.subject, snippet: "", text: "Hello", html: "", labels: [], message_id: "", references: "", attachments: [],
});

let win: Window;
let threads: Thread[];
let acted: [string[], Action][];
const qc = new QueryClient();

beforeEach(() => {
  win = new Window();
  threads = [thread("first"), thread("linear"), thread("last")];
  acted = [];
  const act = (async (ts: Thread[], action: Action) => void acted.push([ts.map((t) => t.thread_id), action])) as ReturnType<typeof makeActions>;
  win.addEventListener("keydown", keyHandler(() => ({ threads, act, qc })) as unknown as (e: Event) => void);
  useStore.setState({ view: "inbox", selected: null, compose: null });
});
afterEach(() => void win.happyDOM.close());

/** Press `key` on `el` (the page when absent); true when the app took it (preventDefault). */
function press(key: string, el: Element = win.document.body) {
  const e = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e.defaultPrevented;
}
/** The list as thread-list renders it: one button per row. */
function rows() {
  return threads.map((t) => {
    const b = win.document.createElement("button");
    b.dataset.thread = `a:${t.thread_id}`;
    win.document.body.append(b);
    return b;
  });
}
const button = () => win.document.body.appendChild(win.document.createElement("button"));

test("Enter on a focused row is the row's own click, not 'open the first'", () => {
  const [, linear] = rows();
  linear.focus();
  expect(press("Enter", linear)).toBe(false); // the browser goes on to click it
  expect(useStore.getState().selected).toBe(null);
});

test("Enter on a focused button with a thread open still clicks it", () => {
  useStore.setState({ selected: "a:first" });
  const reply = button();
  expect(press("Enter", reply)).toBe(false);
  const link = win.document.body.appendChild(win.document.createElement("a"));
  link.href = "#sent";
  expect(press("Enter", link)).toBe(false);
});

test("Enter and o with nothing focused open the first conversation", () => {
  expect(press("Enter")).toBe(true);
  expect(useStore.getState().selected).toBe("a:first");
  useStore.setState({ selected: null });
  press("o");
  expect(useStore.getState().selected).toBe("a:first");
});

test("o on a focused row opens that row", () => {
  const [, linear] = rows();
  expect(press("o", linear)).toBe(true);
  expect(useStore.getState().selected).toBe("a:linear");
});

test("after a click, j/k take the focus along, so Enter and o don't jump back to the clicked row", () => {
  const [first] = rows();
  first.focus(); // a click focuses the row's button
  useStore.setState({ selected: "a:first" });
  const focused = () => win.document.activeElement as HTMLElement;
  press("j", focused());
  press("j", focused());
  expect(focused().dataset.thread).toBe("a:last");
  press("Enter", focused()); // the browser clicks the focused row: the one selected
  press("o", focused());
  expect(useStore.getState().selected).toBe("a:last");
  // a row the list hasn't rendered: the clicked row loses focus rather than keep it
  win.document.querySelector<HTMLElement>('[data-thread="a:last"]')!.remove();
  first.focus();
  useStore.setState({ selected: "a:linear" });
  press("j", first);
  expect(focused()).toBe(win.document.body);
  press("o");
  expect(useStore.getState().selected).toBe("a:last");
});

test("other shortcuts still work with a row or button focused", () => {
  const [first] = rows();
  useStore.setState({ selected: "a:first" });
  press("j", first);
  expect(useStore.getState().selected).toBe("a:linear");
  press("e", button());
  expect(acted).toEqual([[["linear"], "archive"]]);
});

test("# restores in Trash, and ⇧E takes a thread out of Trash or Spam", () => {
  threads = [thread("t1", { in_trash: 1, in_inbox: 0 }), thread("s1", { in_spam: 1, in_inbox: 0 }), thread("plain", { in_inbox: 0 })];
  useStore.setState({ view: "trash", selected: "a:t1" });
  press("#");
  expect(acted.at(-1)).toEqual([["t1"], "untrash"]);
  useStore.setState({ selected: "a:t1" });
  press("E");
  expect(acted.at(-1)).toEqual([["t1"], "untrash"]);
  useStore.setState({ selected: "a:s1" });
  press("E");
  expect(acted.at(-1)).toEqual([["s1"], "notspam"]);
  useStore.setState({ selected: "a:plain" });
  press("E");
  expect(acted.at(-1)).toEqual([["plain"], "inbox"]);
});

test("archiving in Starred, Sent or a label keeps the thread selected; in the Inbox it moves on", () => {
  for (const view of ["starred", "sent", "label:Clients", "all"]) {
    expect(staysInView(view, "archive")).toBe(true);
    useStore.setState({ view, selected: "a:linear" });
    press("e");
    expect(useStore.getState().selected).toBe("a:linear");
  }
  for (const view of ["inbox", "needs-reply", "category:work"]) expect(staysInView(view, "archive")).toBe(false);
  useStore.setState({ view: "inbox", selected: "a:linear" });
  press("e");
  expect(useStore.getState().selected).toBe("a:last");
});

test("f forwards the open conversation", async () => {
  const t = threads[0];
  qc.setQueryData(["thread", "a:first"], { thread: t, messages: [message(t)] });
  useStore.setState({ selected: "a:first" });
  expect(press("f")).toBe(true);
  await Promise.resolve();
  const d = useStore.getState().compose;
  expect(d?.mode).toBe("forward");
  expect(d?.subject).toBe("Fwd: first");
  expect(d?.text).toContain("Hello");
});

test("z undoes the last archive, once", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0) as unknown as number; // sonner dismisses toasts on a frame
  globalThis.fetch = (async (url: string) => (calls.push(url), new Response("{}"))) as typeof fetch;
  try {
    const act = makeActions(new QueryClient());
    await act([threads[1]], "archive");
    press("z");
    press("z");
    await Bun.sleep(0);
    expect(calls).toEqual(["/api/threads/a/linear/archive", "/api/threads/a/linear/inbox?undo=1"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("⇧E in Trash or Spam moves on to the next conversation, as archive does", () => {
  for (const [view, p] of [["trash", { in_trash: 1 }], ["spam", { in_spam: 1 }]] as const) {
    threads = [thread("first", { ...p, in_inbox: 0 }), thread("linear", { ...p, in_inbox: 0 }), thread("last", { ...p, in_inbox: 0 })];
    useStore.setState({ view, selected: "a:linear" });
    press("E");
    expect(useStore.getState().selected).toBe("a:last");
  }
  // in the Inbox it was already there: it stays selected
  useStore.setState({ view: "inbox", selected: "a:first" });
  threads = [thread("first", { in_inbox: 0 }), thread("last")];
  press("E");
  expect(useStore.getState().selected).toBe("a:first");
});

test("f, r and a on a conversation with no messages do nothing", async () => {
  const t = threads[0];
  qc.setQueryData(["thread", "a:first"], { thread: t, messages: [] });
  useStore.setState({ selected: "a:first" });
  const errors: unknown[] = [];
  const onError = (e: unknown) => void errors.push(e);
  process.on("unhandledRejection", onError);
  try {
    for (const key of ["f", "r", "a"]) press(key);
    await Bun.sleep(0);
  } finally {
    process.off("unhandledRejection", onError);
  }
  expect(errors).toEqual([]);
  expect(useStore.getState().compose).toBe(null);
});

/** Run `body` with fetch answering `{}` and recording each URL. */
async function withFetch(body: (calls: string[]) => Promise<void>) {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0) as unknown as number; // sonner dismisses toasts on a frame
  globalThis.fetch = (async (url: string) => (calls.push(url), new Response("{}"))) as typeof fetch;
  try {
    await body(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("z undoes only the most recent action: not an archive from before it", async () => {
  await withFetch(async (calls) => {
    const act = makeActions(new QueryClient());
    await act([threads[1]], "archive");
    await act([threads[0]], "star");
    press("z");
    await Bun.sleep(0);
    expect(calls).toEqual(["/api/threads/a/linear/archive", "/api/threads/a/first/star"]);
  });
});

test("z undoes the later of two archives, even when the earlier one answers last", async () => {
  await withFetch(async (calls) => {
    const act = makeActions(new QueryClient());
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const fetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => (url.includes("/first/") && (await slow), fetch(url))) as typeof fetch;
    const first = act([threads[0]], "archive");
    await act([threads[1]], "archive");
    release();
    await first;
    press("z");
    await Bun.sleep(0);
    expect(calls.at(-1)).toBe("/api/threads/a/linear/inbox?undo=1");
    expect(calls.filter((c) => c.endsWith("/inbox?undo=1"))).toHaveLength(1);
  });
});

test("Move to inbox in Trash or Spam takes the row out of the list at once", async () => {
  await withFetch(async (calls) => {
    const qc = new QueryClient();
    const act = makeActions(qc);
    for (const [view, p, restore] of [["trash", { in_trash: 1 }, "untrash"], ["spam", { in_spam: 1 }, "notspam"]] as const) {
      const ts = [thread("x", { ...p, in_inbox: 0 }), thread("y", { ...p, in_inbox: 0 })];
      const key = ["threads", view, null, ""];
      qc.setQueryData(key, { pages: [{ threads: ts, next: null }], pageParams: [undefined] });
      qc.setQueryData(["thread", "a:x"], { thread: ts[0], messages: [] });
      useStore.setState({ view });
      calls.length = 0;
      const done = act([ts[0]], "inbox"); // the reader's button
      const left = qc.getQueryData<{ pages: { threads: Thread[] }[] }>(key)!.pages[0].threads;
      expect(left.map((t) => t.thread_id)).toEqual(["y"]);
      const open = qc.getQueryData<{ thread: Thread }>(["thread", "a:x"])!.thread;
      expect([open.in_trash, open.in_spam, open.in_inbox]).toEqual([0, 0, 1]);
      await done;
      expect(calls).toEqual([`/api/threads/a/x/${restore}`]);
    }
  });
});
