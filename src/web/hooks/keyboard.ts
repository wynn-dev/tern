import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { forwardDraft, replyDraft } from "@/components/reader";
import { useVisibleThreads } from "@/components/thread-list";
import { type Account, type Action, api, threadKey, type Message, type Thread } from "@/lib/api";
import { useStore } from "@/lib/store";
import { prefetchThread, staysInView, undoLast, useAccounts, useActions } from "./data";

const GOTO: Record<string, string> = { i: "inbox", r: "needs-reply", s: "starred", t: "sent", a: "all", "!": "spam", "#": "trash" };

export const SHORTCUTS: [string, string][] = [
  ["J / K", "Next / previous conversation"],
  ["Enter / O", "Open"],
  ["Esc", "Close"],
  ["E", "Archive"],
  ["⇧ E", "Move to inbox"],
  ["#", "Trash, or restore from Trash"],
  ["!", "Spam / not spam"],
  ["S", "Star"],
  ["U", "Mark read / unread"],
  ["Z", "Undo"],
  ["R", "Reply"],
  ["A", "Reply all"],
  ["F", "Forward"],
  ["C", "New message"],
  ["/", "Search"],
  ["⌘ K", "Command menu"],
  ["G then I · R · S · T · A · ! · #", "Go to Inbox, Needs reply, Starred, Sent, All, Spam, Trash"],
  [",", "Settings"],
  ["?", "This list"],
];

/** A focused control that Enter (or Space) activates by itself: the browser's click must not be cancelled. */
const ACTIVATES = "button, a[href], summary, [role=button], [role=link], [role=menuitem], [role=option], [role=tab], [role=switch], [role=checkbox]";

/**
 * j/k with a row focused (after a click, or Tab): the focus moves with the selection, so Enter and `o`
 * act on the row moved to, not the one clicked. A row the list hasn't rendered gets no focus instead.
 */
function followFocus(el: HTMLElement, key: string) {
  const row = el.closest<HTMLElement>("[data-thread]");
  if (!row) return;
  const to = el.ownerDocument.querySelector<HTMLElement>(`[data-thread=${JSON.stringify(key)}]`);
  if (to) to.focus({ preventScroll: true });
  else row.blur();
}

type Ctx = { threads: Thread[]; act: ReturnType<typeof useActions>; accounts?: Account[]; qc: QueryClient };

/** The global shortcut handler; `get` reads the latest list and actions at each key press. */
export function keyHandler(get: () => Ctx) {
  let pendingG = 0;
  return (e: KeyboardEvent) => {
    const s = useStore.getState();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      s.set({ paletteOpen: !s.paletteOpen });
      return;
    }
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (s.compose && el.closest(".fixed")) return;
    // Enter on a focused row or button is that element's own click
    if (e.key === "Enter" && el.closest(ACTIVATES)) return;

    const { threads, act, accounts, qc } = get();
    const i = threads.findIndex((t) => threadKey(t) === s.selected);
    const current: Thread | undefined = threads[i];
    const move = (d: number) => {
      const next = threads[Math.max(0, Math.min(threads.length - 1, (i < 0 ? -1 : i) + d))] ?? threads[0];
      if (next) {
        s.select(threadKey(next));
        followFocus(el, threadKey(next));
        const after = threads[threads.indexOf(next) + d];
        if (after) prefetchThread(qc, after);
      }
    };
    // after archiving, land on the next conversation, as in a queue; unless it stays in this view (archiving in Starred)
    const removeAndAdvance = (action: Action) => {
      if (!current) return;
      if (!staysInView(s.view, action)) {
        const next = threads[i + 1] ?? threads[i - 1];
        s.select(next ? threadKey(next) : null);
      }
      void act([current], action);
    };
    // `o` on a focused row opens that row, not the first one
    const open = () => {
      const key = el.closest<HTMLElement>("[data-thread]")?.dataset.thread;
      if (key) s.select(key);
      else if (!current) move(1);
    };

    if (Date.now() - pendingG < 900 && GOTO[e.key]) {
      pendingG = 0;
      s.setView(GOTO[e.key]);
      e.preventDefault();
      return;
    }

    const compose = async (draft: (t: { thread: Thread; messages: Message[] }) => Parameters<typeof s.openCompose>[0]) => {
      if (!current) return;
      const t = qc.getQueryData<{ thread: Thread; messages: Message[] }>(["thread", threadKey(current)]) ?? (await api.thread(current.account_id, current.thread_id));
      // nothing to reply to or forward
      if (t.messages.length) s.openCompose(draft(t));
    };
    const me = () => accounts?.find((a) => a.id === current?.account_id)?.email;

    const handlers: Record<string, () => void> = {
      j: () => move(1),
      ArrowDown: () => move(1),
      k: () => move(-1),
      ArrowUp: () => move(-1),
      Enter: open,
      o: open,
      Escape: () => s.select(null),
      e: () => removeAndAdvance("archive"),
      // out of Trash or Spam too, or it would stay stuck there
      E: () => removeAndAdvance(current?.in_trash ? "untrash" : current?.in_spam ? "notspam" : "inbox"),
      "#": () => removeAndAdvance(current?.in_trash ? "untrash" : "trash"),
      "!": () => removeAndAdvance(current?.in_spam ? "notspam" : "spam"),
      s: () => current && void act([current], current.starred ? "unstar" : "star"),
      u: () => current && void act([current], current.unread ? "read" : "unread"),
      z: () => void undoLast(),
      r: () => void compose((t) => replyDraft(t.thread, t.messages, me(), false)),
      a: () => void compose((t) => replyDraft(t.thread, t.messages, me(), true)),
      f: () => void compose((t) => forwardDraft(t.thread, t.messages.at(-1)!)),
      c: () => s.openCompose(),
      "/": () => document.getElementById("search")?.focus(),
      g: () => (pendingG = Date.now()),
      ",": () => s.set({ settingsOpen: true }),
      "?": () => s.set({ helpOpen: true }),
    };
    const h = handlers[e.key];
    if (h) {
      e.preventDefault();
      h();
    }
  };
}

export function useKeyboard() {
  const { threads } = useVisibleThreads();
  const act = useActions();
  const qc = useQueryClient();
  const { data } = useAccounts();
  const latest = useRef<Ctx>({ threads, act, accounts: data?.accounts, qc });
  latest.current = { threads, act, accounts: data?.accounts, qc };

  useEffect(() => {
    const onKey = keyHandler(() => latest.current);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
