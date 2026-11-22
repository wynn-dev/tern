import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, onSignedOut, threadKey, type AccountsResponse, type Action, type Counts, type Session, type Stats, type Thread } from "@/lib/api";
import { useStore } from "@/lib/store";

export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: api.accounts, staleTime: 10_000 });

/** What you cleared today and your streak, for one account or All accounts (null). */
export const useStats = (account: string | null) =>
  useQuery({ queryKey: ["stats", account], queryFn: () => api.stats(account), staleTime: 30_000 });

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

/** "Move to inbox" on a trashed or spam thread restores it, as the server does: so it leaves Trash or Spam at once */
const resolve = (t: Thread, action: Action): Action =>
  action !== "inbox" ? action : t.in_trash ? "untrash" : t.in_spam ? "notspam" : action;

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

/**
 * The undo of the most recent action, for `z`, while its toast shows; the toast's Undo button and `z` run the same thing, once.
 * Any later action, undoable or not, replaces it: `z` never reaches past the last thing done.
 */
let lastUndo: (() => void) | null = null;
let lastAction = 0;
export function undoLast() {
  const undo = lastUndo;
  lastUndo = null;
  undo?.();
  return !!undo;
}

/** The newest copy of a thread the client holds: its row in a list, else the open thread. */
function cached(qc: QueryClient, key: string): Thread | undefined {
  for (const [, data] of qc.getQueriesData<InfiniteData<Page>>({ queryKey: ["threads"] }))
    for (const p of data?.pages ?? []) for (const t of p.threads) if (threadKey(t) === key) return t;
  return qc.getQueryData<{ thread: Thread }>(["thread", key])?.thread;
}

const FLAGS = ["unread", "starred", "in_inbox", "in_trash", "in_spam"] as const;
/** `cur` with what `action` changed on `orig` put back, and whatever else changed since left alone. */
function unpatch(cur: Thread, orig: Thread, action: Action): Thread {
  const p = patch(orig, resolve(orig, action));
  const back = FLAGS.filter((f) => p[f] !== orig[f]);
  return back.length ? { ...cur, ...Object.fromEntries(back.map((f) => [f, orig[f]])) } : cur;
}

/** Lists run newest first, as the server orders them. */
const newer = (a: Thread, b: Thread) =>
  a.last_date !== b.last_date ? a.last_date > b.last_date : a.account_id !== b.account_id ? a.account_id > b.account_id : a.thread_id > b.thread_id;

/** What a thread adds to the sidebar's counts, as the server counts them. */
const inInbox = (t: Thread) => !!t.in_inbox && !t.in_trash && !t.in_spam;
function tally(t: Thread) {
  const inbox = inInbox(t);
  return { inbox: +inbox, unread: +(inbox && !!t.unread), reply: +(inbox && !!t.needs_reply) };
}
/** The counts once `from` has become `to`. */
function recount(c: Counts, from: Thread, to: Thread): Counts {
  const a = tally(from), b = tally(to);
  const di = b.inbox - a.inbox, du = b.unread - a.unread, dr = b.reply - a.reply;
  const acc = c.accounts[to.account_id];
  if ((!di && !du && !dr) || !acc) return c;
  const cat = to.category;
  const bump = (m: Record<string, number>) => (cat && du ? { ...m, [cat]: Math.max(0, (m[cat] ?? 0) + du) } : m);
  return {
    accounts: { ...c.accounts, [to.account_id]: { inbox: Math.max(0, (acc.inbox ?? 0) + di), inboxUnread: Math.max(0, acc.inboxUnread + du), needsReply: Math.max(0, acc.needsReply + dr), categories: bump(acc.categories) } },
    categories: bump(c.categories),
  };
}
function setCounts(qc: QueryClient, fn: (c: Counts) => Counts) {
  if (!qc.getQueryData(["accounts"])) return;
  // a refetch already on its way would land counts from before this
  void qc.cancelQueries({ queryKey: ["accounts"] });
  qc.setQueryData<AccountsResponse>(["accounts"], (d) => d && { ...d, counts: fn(d.counts) });
}

/**
 * Threads counted as cleared today on this page, and why: read, taken out of the inbox, or both. As on the server,
 * a thread counts once, and stops counting only once neither holds (Mark unread, undoing the removal).
 */
const cleared = new Map<string, { read: boolean; removed: boolean }>();
/** Taking a thread out of the inbox, and what an undo of each sends (src/server/stats.ts has the same). */
const REMOVES = new Set<Action>(["archive", "trash", "spam"]);
const UNREMOVES = new Set<Action>(["inbox", "untrash", "notspam"]);

/**
 * The day's stats once these actions land, before the server says so: a thread cleared (read while unread
 * in the inbox, or taken out of it) counts once, in its account and All accounts; zero unread, once reached, marks the day.
 */
function bumpStats(qc: QueryClient, before: Thread[], action: Action, undo: boolean) {
  const delta = new Map<string | null, number>();
  for (const t of before) {
    const k = threadKey(t);
    const was = cleared.get(k) ?? { read: false, removed: false };
    const now = { ...was };
    if (action === "unread") now.read = false;
    else if (undo && UNREMOVES.has(action)) now.removed = false;
    else if (!undo && inInbox(t) && action === "read" && t.unread) now.read = true;
    else if (!undo && inInbox(t) && REMOVES.has(action)) now.removed = true;
    const before = was.read || was.removed, after = now.read || now.removed;
    if (after) cleared.set(k, now);
    else cleared.delete(k);
    const d = +after - +before;
    for (const scope of [t.account_id, null]) delta.set(scope, (delta.get(scope) ?? 0) + d);
  }
  const counts = qc.getQueryData<AccountsResponse>(["accounts"])?.counts;
  for (const [[, scope], s] of qc.getQueriesData<Stats>({ queryKey: ["stats"] })) {
    if (!s) continue;
    const d = delta.get(scope as string | null) ?? 0;
    const zero = !!counts && (scope ? (counts.accounts[scope as string]?.inboxUnread ?? 0) : Object.values(counts.accounts).reduce((n, c) => n + c.inboxUnread, 0)) === 0;
    // the server marks zero only for an action you take in Tern: one that cleared something here
    const reached = zero && !s.zeroToday && d > 0;
    if (!d && !reached) continue;
    void qc.cancelQueries({ queryKey: ["stats", scope] });
    qc.setQueryData<Stats>(["stats", scope], { ...s, cleared: Math.max(0, s.cleared + d), zeroToday: s.zeroToday || reached, streak: s.streak + +reached });
  }
}

/** Actions sent and not yet answered: until they are, a refetched list can still have them undone. */
let inFlight = 0;

export const useActions = () => makeActions(useQueryClient());

export function makeActions(qc: QueryClient) {
  return async function act(threads: Thread[], action: Action, opts: { quiet?: boolean; undo?: boolean } = {}) {
    const { view } = useStore.getState();
    const actions = new Set(threads.map((t) => resolve(t, action)));
    if (actions.size === 1) action = [...actions][0];
    // marking read on open is quiet: it doesn't count as something done
    const seq = opts.quiet ? 0 : ++lastAction;
    if (seq) lastUndo = null;
    const keys = new Set(threads.map(threadKey));
    const snapshot = qc.getQueriesData<InfiniteData<Page>>({ queryKey: ["threads"] });
    // as the client has them now, which can be newer than the copies passed in
    const before = threads.map((t) => cached(qc, threadKey(t)) ?? t);

    // optimistic: patch or drop the threads in every cached list, and the counts
    qc.setQueriesData<InfiniteData<Page>>({ queryKey: ["threads"] }, (data) => {
      if (!data) return data;
      return {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          threads: p.threads.flatMap((t) => {
            if (!keys.has(threadKey(t))) return [t];
            const a = resolve(t, action);
            return staysInView(view, a) ? [patch(t, a)] : [];
          }),
        })),
      };
    });
    for (const t of threads) qc.setQueryData<{ thread: Thread }>(["thread", threadKey(t)], (d) => (d ? { ...d, thread: patch(d.thread, resolve(d.thread, action)) } : d));
    setCounts(qc, (c) => before.reduce((c, t) => recount(c, t, patch(t, resolve(t, action))), c));
    bumpStats(qc, before, action, !!opts.undo);

    inFlight++;
    const results = await Promise.allSettled(threads.map((t) => api.act(t.account_id, t.thread_id, resolve(t, action), opts.undo)));
    inFlight--;
    const failed = results.flatMap((r, i) => (r.status === "rejected" ? [{ t: before[i], e: r.reason as Error }] : []));
    if (!failed.length) {
      const undo = UNDO[action];
      // an action started since then has answered first: it is the one `z` undoes
      if (undo && seq && seq === lastAction) {
        const run = () => {
          if (lastUndo === run) lastUndo = null;
          void act(threads, undo, { quiet: true, undo: true });
          toast.dismiss(id);
        };
        const forget = () => {
          if (lastUndo === run) lastUndo = null;
        };
        const id = toast(VERB[action] + (threads.length > 1 ? ` ${threads.length} conversations` : ""), {
          action: { label: "Undo", onClick: run },
          onDismiss: forget,
          onAutoClose: forget,
        });
        lastUndo = run;
      }
    } else {
      rollback(qc, failed.map((f) => f.t), action, snapshot);
      // a 401 already took them to sign-in
      const e = failed[0].e;
      if (!(e instanceof ApiError && e.status === 401)) toast.error(`Couldn't ${action}: ${e.message}`);
    }
    if (!inFlight) {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    }
  };
}

/**
 * Undo an action that failed on these threads, and only it: actions taken since, on these threads or others
 * (the next few read while flicking through), stay. A thread it took out of a list goes back where it was.
 */
function rollback(qc: QueryClient, threads: Thread[], action: Action, snapshot: [readonly unknown[], InfiniteData<Page> | undefined][]) {
  const orig = new Map(threads.map((t) => [threadKey(t), t]));
  for (const [queryKey, snap] of snapshot) {
    const was = new Map(snap?.pages.flatMap((p) => p.threads).filter((t) => orig.has(threadKey(t))).map((t) => [threadKey(t), t]));
    if (!was.size) continue;
    qc.setQueryData<InfiniteData<Page>>(queryKey, (data) => {
      if (!data) return data;
      const pages = data.pages.map((p) => ({ ...p, threads: p.threads.map((t) => (was.has(threadKey(t)) ? unpatch(t, was.get(threadKey(t))!, action) : t)) }));
      const shown = new Set(pages.flatMap((p) => p.threads.map(threadKey)));
      for (const t of was.values()) {
        if (shown.has(threadKey(t))) continue;
        const p = pages.find((p) => p.threads.some((u) => newer(t, u))) ?? pages.at(-1);
        if (!p) continue;
        const i = p.threads.findIndex((u) => newer(t, u));
        p.threads.splice(i < 0 ? p.threads.length : i, 0, t);
      }
      return { ...data, pages };
    });
  }
  for (const t of threads) qc.setQueryData<{ thread: Thread }>(["thread", threadKey(t)], (d) => (d ? { ...d, thread: unpatch(d.thread, t, action) } : d));
  setCounts(qc, (c) => threads.reduce((c, t) => recount(c, patch(t, resolve(t, action)), t), c));
}

/** When this changes, an open thread is marked read again: another thread, or a new message in this one. */
export const readKey = (t: Thread) => `${threadKey(t)}:${t.last_date}`;
/** Threads marked read, by readKey: the reader doesn't send it again for a copy fetched before the read landed. */
const markedRead = new Set<string>();

/**
 * Mark an unread thread read, quietly. `again` marks it even if it was marked read before at this readKey,
 * as opening it does after "Mark unread".
 */
export function markRead(act: ReturnType<typeof makeActions>, t: Thread | undefined, again = false) {
  if (!t?.unread) return;
  const k = readKey(t);
  if (!again && markedRead.has(k)) return;
  markedRead.add(k);
  void act([t], "read", { quiet: true });
}

/**
 * Opening a thread marks it read the moment it's selected: in the list, the counts and the header at once,
 * without waiting for it to load or for the server, so flicking through with j/k reads every one.
 */
export function useReadOnOpen() {
  const qc = useQueryClient();
  useEffect(() => {
    const act = makeActions(qc);
    return useStore.subscribe((s, prev) => {
      if (s.selected && s.selected !== prev.selected) markRead(act, cached(qc, s.selected), true);
    });
  }, [qc]);
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
      // a list fetched now could still show actions on their way as not done: wait for their answers
      if (inFlight) {
        timer = setTimeout(flush, 250);
        return;
      }
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
