import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { replyDraft } from "@/components/reader";
import { useVisibleThreads } from "@/components/thread-list";
import { api, threadKey, type Message, type Thread } from "@/lib/api";
import { useStore } from "@/lib/store";
import { prefetchThread, useAccounts, useActions } from "./data";

const GOTO: Record<string, string> = { i: "inbox", r: "needs-reply", s: "starred", t: "sent", a: "all", "!": "spam", "#": "trash" };

export const SHORTCUTS: [string, string][] = [
  ["J / K", "Next / previous conversation"],
  ["Enter / O", "Open"],
  ["Esc", "Close"],
  ["E", "Archive"],
  ["⇧ E", "Move to inbox"],
  ["#", "Trash"],
  ["S", "Star"],
  ["U", "Mark read / unread"],
  ["R", "Reply"],
  ["A", "Reply all"],
  ["C", "New message"],
  ["/", "Search"],
  ["⌘ K", "Command menu"],
  ["G then I · R · S · T · A · !", "Go to Inbox, Needs reply, Starred, Sent, All, Spam"],
  [",", "Settings"],
  ["?", "This list"],
];

export function useKeyboard() {
  const { threads } = useVisibleThreads();
  const act = useActions();
  const qc = useQueryClient();
  const { data } = useAccounts();
  const latest = useRef({ threads, act, data });
  latest.current = { threads, act, data };
  const pendingG = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.set({ paletteOpen: !s.paletteOpen });
        return;
      }
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (s.compose && el.closest(".fixed")) return;

      const { threads, act, data } = latest.current;
      const i = threads.findIndex((t) => threadKey(t) === s.selected);
      const current: Thread | undefined = threads[i];
      const move = (d: number) => {
        const next = threads[Math.max(0, Math.min(threads.length - 1, (i < 0 ? -1 : i) + d))] ?? threads[0];
        if (next) {
          s.select(threadKey(next));
          const after = threads[threads.indexOf(next) + d];
          if (after) prefetchThread(qc, after);
        }
      };
      // after archiving, land on the next conversation, as in a queue
      const removeAndAdvance = (action: "archive" | "trash" | "spam" | "notspam") => {
        if (!current) return;
        const next = threads[i + 1] ?? threads[i - 1];
        s.select(next ? threadKey(next) : null);
        void act([current], action);
      };

      if (Date.now() - pendingG.current < 900 && GOTO[e.key]) {
        pendingG.current = 0;
        s.setView(GOTO[e.key]);
        e.preventDefault();
        return;
      }

      const reply = async (all: boolean) => {
        if (!current) return;
        const t = qc.getQueryData<{ thread: Thread; messages: Message[] }>(["thread", threadKey(current)]) ?? (await api.thread(current.account_id, current.thread_id));
        const me = data?.accounts.find((a) => a.id === current.account_id)?.email;
        s.openCompose(replyDraft(t.thread, t.messages, me, all));
      };

      const handlers: Record<string, () => void> = {
        j: () => move(1),
        ArrowDown: () => move(1),
        k: () => move(-1),
        ArrowUp: () => move(-1),
        Enter: () => !current && move(1),
        o: () => !current && move(1),
        Escape: () => s.select(null),
        e: () => removeAndAdvance("archive"),
        E: () => current && void act([current], "inbox"),
        "#": () => removeAndAdvance("trash"),
        "!": () => (current?.in_spam ? removeAndAdvance("notspam") : removeAndAdvance("spam")),
        s: () => current && void act([current], current.starred ? "unstar" : "star"),
        u: () => current && void act([current], current.unread ? "read" : "unread"),
        r: () => void reply(false),
        a: () => void reply(true),
        c: () => s.openCompose(),
        "/": () => document.getElementById("search")?.focus(),
        g: () => (pendingG.current = Date.now()),
        ",": () => s.set({ settingsOpen: true }),
        "?": () => s.set({ helpOpen: true }),
      };
      const h = handlers[e.key];
      if (h) {
        e.preventDefault();
        h();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qc]);
}
