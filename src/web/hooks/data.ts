import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, onSignedOut, threadKey, type Action, type Session, type Thread } from "@/lib/api";
import { useStore } from "@/lib/store";

export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: api.accounts, staleTime: 10_000 });

type Page = { threads: Thread[]; next: string | null };

export function useThreads() {
  const view = useStore((s) => s.view);
  const account = useStore((s) => s.account);
  const q = useStore((s) => s.query);
  return useInfiniteQuery({
    queryKey: ["threads", view, account, q],
    queryFn: ({ pageParam }) => api.threads({ view, account: account ?? undefined, q, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === view && prevQuery?.queryKey[2] === account ? prev : undefined),
    staleTime: 5_000,
  });
}

export function useThread(key: string | null) {
  const [account, thread] = key?.split(":") ?? [];
  return useQuery({
    queryKey: ["thread", key],
    queryFn: () => api.thread(account, thread),
    enabled: !!key,
    staleTime: 30_000,
  });
}

export function prefetchThread(qc: QueryClient, t: Thread) {
  void qc.prefetchQuery({ queryKey: ["thread", threadKey(t)], queryFn: () => api.thread(t.account_id, t.thread_id), staleTime: 30_000 });
}

/** Does `t` still belong in `view` after this action? */
export function staysInView(view: string, action: Action) {
  // archiving only takes it out of the inbox: Starred, Sent and labels still show it
  if (action === "archive") return view === "all" || view === "starred" || view === "sent" || view.startsWith("label:");
  if (action === "trash" || action === "spam") return false;
  if (action === "unstar") return view !== "starred";
  if (action === "untrash") return view !== "trash";
  if (action === "notspam") return view !== "spam";
  return true;
}

function patch(t: Thread, action: Action): Thread {
  switch (action) {
    case "star": return { ...t, starred: 1 };
    case "unstar": return { ...t, starred: 0 };
    case "read": return { ...t, unread: 0 };
    case "unread": return { ...t, unread: 1 };
    case "archive": return { ...t, in_inbox: 0 };
    case "inbox": return { ...t, in_inbox: 1 };
    case "trash": return { ...t, in_trash: 1, in_inbox: 0 };
    case "untrash": return { ...t, in_trash: 0, in_inbox: 1 };
    case "spam": return { ...t, in_spam: 1, in_inbox: 0 };
    case "notspam": return { ...t, in_spam: 0, in_inbox: 1 };
    default: return t;
  }
}

const UNDO: Partial<Record<Action, Action>> = { archive: "inbox", trash: "untrash", untrash: "trash", spam: "notspam", notspam: "spam" };
const VERB: Partial<Record<Action, string>> = { archive: "Archived", trash: "Moved to trash", untrash: "Restored", spam: "Marked as spam", notspam: "Moved to inbox" };

/** The last action that can be undone, for `z`; the toast's Undo button and `z` run the same thing, once. */
let lastUndo: (() => void) | null = null;
export function undoLast() {
  const undo = lastUndo;
  lastUndo = null;
  undo?.();
  return !!undo;
}

export const useActions = () => makeActions(useQueryClient());

export function makeActions(qc: QueryClient) {
  return async function act(threads: Thread[], action: Action, opts: { quiet?: boolean } = {}) {
    const { view } = useStore.getState();
    const keys = new Set(threads.map(threadKey));
    const snapshot = qc.getQueriesData<InfiniteData<Page>>({ queryKey: ["threads"] });

    // optimistic: patch or drop the threads in every cached list
    qc.setQueriesData<InfiniteData<Page>>({ queryKey: ["threads"] }, (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          threads: p.threads.flatMap((t) => (!keys.has(threadKey(t)) ? [t] : staysInView(view, action) ? [patch(t, action)] : [])),
        })),
      };
    });
    for (const t of threads) qc.setQueryData<{ thread: Thread }>(["thread", threadKey(t)], (d) => (d ? { ...d, thread: patch(d.thread, action) } : d));

    try {
      await Promise.all(threads.map((t) => api.act(t.account_id, t.thread_id, action)));
      const undo = UNDO[action];
      if (undo && !opts.quiet) {
        const run = () => {
          if (lastUndo === run) lastUndo = null;
          void act(threads, undo, { quiet: true });
          toast.dismiss(id);
        };
        const id = toast(VERB[action] + (threads.length > 1 ? ` ${threads.length} conversations` : ""), {
          action: { label: "Undo", onClick: run },
        });
        lastUndo = run;
      }
    } catch (e) {
      for (const [k, v] of snapshot) qc.setQueryData(k, v);
      // a 401 already took them to sign-in
      if (!(e instanceof ApiError && e.status === 401)) toast.error(`Couldn't ${action}: ${(e as Error).message}`);
    } finally {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    }
  };
}

/** When the server says the session has ended, stop fetching and show the sign-in screen. */
export function useSessionGuard() {
  const qc = useQueryClient();
  useEffect(
    () =>
      onSignedOut(() => {
        void qc.cancelQueries({ predicate: (q) => q.queryKey[0] !== "session" });
        qc.setQueryData<Session>(["session"], (s) => s && { ...s, authed: false, expired: true });
      }),
    [qc],
  );
}

/** Server-sent events keep every list fresh without polling. */
export function useLiveUpdates() {
  const qc = useQueryClient();
  // the stream lives as long as the session: it closes on sign-out and a new one opens on signing in again
  const authed = !!useQuery({ queryKey: ["session"], queryFn: api.session }).data?.authed;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!authed) return;
    let dropped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pendingThreads = new Set<string>();
    const flush = () => {
      timer = undefined;
      void qc.invalidateQueries({ queryKey: ["threads"] });
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      for (const k of pendingThreads) void qc.invalidateQueries({ queryKey: ["thread", k] });
      pendingThreads.clear();
    };
    const es = new EventSource("/api/events");
    es.onerror = () => {
      dropped = true;
      // the browser retries on its own after a network drop, but gives up for good on an HTTP error such as a 401:
      // refetch so the request that fails says why (a 401 brings up sign-in), and open a new stream a little later
      if (es.readyState === EventSource.CLOSED) {
        void qc.invalidateQueries({ queryKey: ["accounts"] });
        retry = setTimeout(() => setAttempt((n) => n + 1), 5_000);
      }
    };
    // back after an outage: refetch what failed or went stale while it was down
    es.onopen = () => {
      if (dropped) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "session" });
      dropped = false;
    };
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as { type: string; keys?: [string, string][] };
      for (const [a, t] of e.keys ?? []) pendingThreads.add(`${a}:${t}`);
      timer ??= setTimeout(flush, 250);
    };
    return () => {
      es.close();
      clearTimeout(timer);
      clearTimeout(retry);
    };
  }, [qc, authed, attempt]);
}
