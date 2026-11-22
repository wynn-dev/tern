import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { api, threadKey, type Action, type Thread } from "@/lib/api";
import { useStore } from "@/lib/store";

export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: api.accounts, staleTime: 10_000 });

type Page = { threads: Thread[] };

export function useThreads() {
  const view = useStore((s) => s.view);
  const account = useStore((s) => s.account);
  const q = useStore((s) => s.query);
  return useInfiniteQuery({
    queryKey: ["threads", view, account, q],
    queryFn: ({ pageParam }) => api.threads({ view, account: account ?? undefined, q, before: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => (last.threads.length >= 60 ? last.threads.at(-1)!.last_date : undefined),
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
function staysInView(view: string, action: Action) {
  if (action === "archive" || action === "trash" || action === "spam") return (view === "all" || view.startsWith("label:")) && action === "archive";
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

const UNDO: Partial<Record<Action, Action>> = { archive: "inbox", trash: "untrash", spam: "notspam", notspam: "spam" };
const VERB: Partial<Record<Action, string>> = { archive: "Archived", trash: "Moved to trash", spam: "Marked as spam", notspam: "Moved to inbox" };

export function useActions() {
  const qc = useQueryClient();

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
          threads: p.threads.flatMap((t) => (!keys.has(threadKey(t)) ? [t] : staysInView(view, action) ? [patch(t, action)] : [])),
        })),
      };
    });
    for (const t of threads) qc.setQueryData<{ thread: Thread }>(["thread", threadKey(t)], (d) => (d ? { ...d, thread: patch(d.thread, action) } : d));

    try {
      await Promise.all(threads.map((t) => api.act(t.account_id, t.thread_id, action)));
      const undo = UNDO[action];
      if (undo && !opts.quiet)
        toast(VERB[action] + (threads.length > 1 ? ` ${threads.length} conversations` : ""), {
          action: { label: "Undo", onClick: () => void act(threads, undo, { quiet: true }) },
        });
    } catch (e) {
      for (const [k, v] of snapshot) qc.setQueryData(k, v);
      toast.error(`Couldn't ${action}: ${(e as Error).message}`);
    } finally {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
    }
  };
}

/** Server-sent events keep every list fresh without polling. */
export function useLiveUpdates() {
  const qc = useQueryClient();
  useEffect(() => {
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
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as { type: string; keys?: [string, string][] };
      for (const [a, t] of e.keys ?? []) pendingThreads.add(`${a}:${t}`);
      timer ??= setTimeout(flush, 250);
    };
    return () => {
      es.close();
      clearTimeout(timer);
    };
  }, [qc]);
}
