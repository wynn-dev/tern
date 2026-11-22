import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircleIcon, HourglassIcon, Loader2Icon, PaperclipIcon, SearchIcon, SparklesIcon, StarIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { prefetchThread, useAccounts, useThreads } from "@/hooks/data";
import { api, threadKey, type Account, type Thread } from "@/lib/api";
import { scopedCounts, viewUnread } from "@/lib/counts";
import { accountTrouble, CATCHING_UP, displayName, firstName, shortDate, signedOut } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { CategoryChip, categoryMeta, CATEGORY } from "./bits";
import { LoadError } from "./load-error";
import { Button } from "./ui/button";

const ROW = 76;

export const VIEW_TITLES: Record<string, string> = {
  inbox: "Inbox", "needs-reply": "Needs reply", starred: "Starred", sent: "Sent", all: "All mail", trash: "Trash", spam: "Spam",
};
export const viewTitle = (v: string) => VIEW_TITLES[v] ?? (v.startsWith("category:") ? CATEGORY[v.slice(9)]?.label : v.slice(6)) ?? v;

export function useVisibleThreads() {
  const q = useThreads();
  const threads = useMemo(() => q.data?.pages.flatMap((p) => p.threads) ?? [], [q.data]);
  return { ...q, threads };
}

function participantsLabel(t: Thread, me: string | undefined) {
  const others = t.participants.filter((p) => p.email !== me);
  const list = others.length ? others : t.participants;
  if (t.in_sent && !others.length) return "Me";
  if (list.length === 1) return displayName(list[0]);
  return list.slice(0, 3).map(firstName).join(", ");
}

/** `account:labelId` → name, for the account's user labels. */
export type LabelNames = Map<string, string>;

const Row = memo(function Row({
  t, account, selected, showCategory, labelNames, hideLabel, onSelect, onHover,
}: {
  t: Thread; account?: Account; selected: boolean; showCategory: boolean; labelNames: LabelNames; hideLabel?: string;
  onSelect: () => void; onHover: () => void;
}) {
  const unread = !!t.unread;
  const labels = t.labels.flatMap((id) => {
    const name = labelNames.get(`${t.account_id}:${id}`);
    return name && name !== hideLabel ? [name] : [];
  });
  return (
    <button
      data-thread={threadKey(t)}
      onClick={onSelect}
      onMouseEnter={onHover}
      className={cn(
        "group relative flex h-full w-full flex-col justify-center gap-px border-b border-border/60 py-2 pr-4 pl-[26px] text-left leading-[19px] transition-colors duration-75",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset",
        selected ? "bg-selected" : "hover:bg-accent/50",
      )}
    >
      {account && <span className="absolute top-3 bottom-3 left-[6px] w-[3px] rounded-full opacity-80" style={{ background: account.color }} />}
      {unread && <span className="absolute top-[18px] left-[14px] size-1.5 rounded-full bg-brand" />}
      <div className="flex items-center gap-2">
        <span className={cn("truncate text-[13.5px]", unread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
          {participantsLabel(t, account?.email)}
        </span>
        {t.count > 1 && <span className="font-mono text-[11px] text-muted-foreground">{t.count}</span>}
        {!!t.needs_reply && <span className="rounded-full bg-amber-500/12 px-1.5 text-[10.5px] font-medium text-amber-800 dark:text-amber-400">Reply</span>}
        <span className="flex-1" />
        {!!t.has_attachments && <PaperclipIcon className="size-3 text-muted-foreground" />}
        {!!t.starred && <StarIcon className="size-3 fill-amber-400 text-amber-400" />}
        {showCategory && t.category && <CategoryChip category={t.category} />}
        <span className={cn("shrink-0 text-[11.5px] tabular-nums", unread ? "text-foreground" : "text-muted-foreground")}>{shortDate(t.last_date)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("flex-1 truncate text-[13px]", unread ? "text-foreground" : "text-foreground/75")}>{t.subject || "(no subject)"}</span>
        {labels.slice(0, 2).map((name) => (
          <span key={name} className="max-w-[110px] shrink-0 truncate rounded border px-1 text-[10.5px] leading-[16px] text-muted-foreground">
            {name}
          </span>
        ))}
        {labels.length > 2 && <span className="shrink-0 text-[10.5px] text-muted-foreground">+{labels.length - 2}</span>}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
        {t.summary ? (
          <>
            <SparklesIcon className="size-3 shrink-0" style={{ color: categoryMeta(t.category).color }} />
            <span className="truncate">{t.summary}</span>
          </>
        ) : (
          <span className="truncate">{t.snippet}</span>
        )}
      </div>
    </button>
  );
});

export function ThreadList() {
  const { view, account, query, selected, select, setQuery } = useStore();
  const {
    threads, isLoading, error, isRefetchError, isFetchNextPageError, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useVisibleThreads();
  const { data } = useAccounts();
  const qc = useQueryClient();
  const accounts = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.id, a])), [data]);
  const labelNames: LabelNames = useMemo(() => new Map((data?.labels ?? []).map((l) => [`${l.account_id}:${l.id}`, l.name])), [data]);
  const parent = useRef<HTMLDivElement>(null);
  const multi = accounts.size > 1;

  const v = useVirtualizer({ count: threads.length, getScrollElement: () => parent.current, estimateSize: () => ROW, overscan: 12 });
  const items = v.getVirtualItems();

  useEffect(() => {
    const last = items.at(-1);
    // after a failed page, wait for Try again rather than refetching on every scroll
    if (last && last.index >= threads.length - 15 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [items, threads.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);

  // keep the selected row in view as j/k move it
  const selectedIndex = useMemo(() => threads.findIndex((t) => threadKey(t) === selected), [threads, selected]);
  useEffect(() => {
    if (selectedIndex >= 0) v.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, v]);

  // from the server's counts, so it agrees with the sidebar however many pages are loaded
  const unread = query ? undefined : viewUnread(view, scopedCounts(data?.counts, account));
  const acc = account ? accounts.get(account) : undefined;
  const broken = useMemo(() => [...accounts.values()].filter((a) => a.status === "error" && (!account || a.id === account)), [accounts, account]);
  const limited = useMemo(() => [...accounts.values()].filter((a) => a.status === "limited" && (!account || a.id === account)), [accounts, account]);

  return (
    // below ~1200 px the list gives up width (down to 320 px) so the reader isn't squeezed
    <section aria-label="Conversations" className="flex w-[clamp(320px,calc(50vw-180px),420px)] shrink-0 flex-col border-r bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <motion.h1 key={view} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }} className="text-[14px] font-semibold tracking-tight">
          {viewTitle(view)}
        </motion.h1>
        {acc && (
          <span className="flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: acc.color }} />
            <span className="truncate">{acc.email}</span>
          </span>
        )}
        {!!unread && <span className="shrink-0 text-[12px] text-muted-foreground">{unread} unread</span>}
      </header>
      <SearchBox value={query} onChange={setQuery} />
      {!!broken.length && !(acc && !threads.length) && <BrokenBanner accounts={broken} />}
      {!!limited.length && (
        <div role="status" className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/60 px-4 text-[12px] text-muted-foreground">
          <HourglassIcon className="size-3.5 shrink-0" />
          <span className="truncate" title={limited.map((a) => a.email).join("\n")}>
            {CATCHING_UP}
            {multi && !acc && limited.length === 1 && `: ${limited[0].email}`}
          </span>
        </div>
      )}
      {isRefetchError && !!threads.length && (
        <div role="alert" className="flex h-8 shrink-0 items-center gap-2 border-b bg-destructive/8 px-4 text-[12px] text-destructive">
          <span className="truncate">Couldn't refresh: {error?.message}</span>
          <span className="flex-1" />
          <button onClick={() => void refetch()} disabled={isFetching} className="shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50">
            {isFetching ? "Retrying…" : "Try again"}
          </button>
        </div>
      )}
      <div ref={parent} className="scroll-thin relative flex-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton />
        ) : error && !threads.length ? (
          <LoadError title="Couldn't load your mail" error={error} retrying={isFetching} onRetry={() => void refetch()} />
        ) : !threads.length && acc?.status === "error" ? (
          <BrokenAccount account={acc} />
        ) : !threads.length ? (
          <Empty view={view} query={query} />
        ) : (
          <div style={{ height: v.getTotalSize() + (isFetchNextPageError ? 48 : 0) }} className="relative">
            {items.map((it) => {
              const t = threads[it.index];
              const key = threadKey(t);
              return (
                <div
                  key={key}
                  className="absolute inset-x-0 top-0 transition-transform duration-200 ease-(--ease-snap)"
                  style={{ height: ROW, transform: `translateY(${it.start}px)` }}
                >
                  <Row
                    t={t}
                    account={multi ? accounts.get(t.account_id) : undefined}
                    selected={key === selected}
                    showCategory={!view.startsWith("category:")}
                    labelNames={labelNames}
                    hideLabel={view.startsWith("label:") ? view.slice(6) : undefined}
                    onSelect={() => select(key)}
                    onHover={() => prefetchThread(qc, t)}
                  />
                </div>
              );
            })}
            {isFetchNextPageError && !isFetchingNextPage && (
              <div role="alert" className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
                Couldn't load more.
                <button onClick={() => void fetchNextPage()} className="font-medium text-foreground underline-offset-2 hover:underline">Try again</button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => local !== value && onChange(local), 120);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4 text-muted-foreground focus-within:text-foreground">
      <SearchIcon className="size-3.5" />
      <input
        id="search"
        aria-label="Search mail"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setLocal("");
            onChange("");
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Enter" || e.key === "ArrowDown") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Search mail"
        className="h-full flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
      />
      {local ? (
        <button aria-label="Clear search" onClick={() => (setLocal(""), onChange(""))} className="rounded p-0.5 hover:bg-accent">
          <XIcon className="size-3.5" />
        </button>
      ) : (
        <kbd>/</kbd>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex h-[76px] flex-col justify-center gap-2 border-b border-border/60 px-5">
          <div className="h-3 w-1/3 rounded bg-muted" />
          <div className="h-3 w-3/4 rounded bg-muted" />
          <div className="h-2.5 w-2/3 rounded bg-muted/70" />
        </div>
      ))}
    </div>
  );
}

/** What an empty view says, by view: an empty Trash isn't "Inbox zero". */
export function emptyCopy(view: string, searching: boolean): { title: string; sub: string } {
  if (searching) return { title: "No matches", sub: view === "all" ? "Try fewer or different words." : "Try fewer words, or search all your mail." };
  if (view === "inbox") return { title: "Inbox zero", sub: "Everything's handled. Enjoy the quiet." };
  if (view === "needs-reply") return { title: "Nothing needs a reply", sub: "Threads waiting on an answer from you show up here." };
  if (view === "starred") return { title: "No starred mail", sub: "Press S on a thread to star it and keep it here." };
  if (view === "sent") return { title: "Nothing sent yet", sub: "Mail you send shows up here." };
  if (view === "all") return { title: "No mail yet", sub: "Your mail shows up here as it syncs." };
  if (view === "spam") return { title: "No spam", sub: "Mail Gmail flags as spam lands here." };
  if (view === "trash") return { title: "Trash is empty", sub: "Mail you trash shows up here." };
  if (view.startsWith("category:")) return { title: `Nothing in ${viewTitle(view)}`, sub: `Inbox mail the AI sorts as ${viewTitle(view)} shows up here.` };
  if (view.startsWith("label:")) return { title: `Nothing labelled ${view.slice(6)}`, sub: "Mail with this label shows up here." };
  return { title: "Nothing here", sub: "Mail that lands here shows up instantly." };
}

function Empty({ view, query }: { view: string; query: string }) {
  const { title, sub } = emptyCopy(view, !!query);
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }} className="flex h-full flex-col items-center justify-center gap-1 px-8 pb-16 text-center">
      <svg viewBox="0 0 32 32" className="mb-3 size-10 text-muted-foreground/30">
        <path d="M6 20c4-1 7-4 10-9 2 4 5 7 10 8-5 0-8 1-10 5-2-3-5-4-10-4z" fill="currentColor" />
      </svg>
      <div className="text-[14px] font-medium">{title}</div>
      <div className="text-[12.5px] text-muted-foreground">{sub}</div>
      {query && view !== "all" && (
        // one store update, so the switch is one history entry and the query survives it (setView clears it)
        <Button variant="outline" size="sm" className="mt-3" onClick={() => useStore.setState({ view: "all", query, selected: null, cursor: 0 })}>
          <SearchIcon /> Search All mail
        </Button>
      )}
    </motion.div>
  );
}

/** Starts Google's sign-in again; picking the signed-out account there reconnects it. */
function useReconnect() {
  return useMutation({
    mutationFn: api.connect,
    onSuccess: ({ url }) => window.open(url, "_self"),
    onError: (e) => toast.error(e.message),
  });
}

function BrokenBanner({ accounts }: { accounts: Account[] }) {
  const reconnect = useReconnect();
  return (
    <div role="alert" className="flex h-8 shrink-0 items-center gap-2 border-b bg-destructive/8 px-4 text-[12px] text-destructive">
      <AlertCircleIcon className="size-3.5 shrink-0" />
      <span className="truncate" title={accounts.map((a) => a.error).join("\n")}>
        {/* the state first, so a narrow list truncates the address rather than "signed out" */}
        {accounts.length === 1 ? `${signedOut(accounts[0]) ? "Signed out" : "Couldn't sync"}: ${accounts[0].email}` : `${accounts.length} accounts need reconnecting`}
      </span>
      <span className="flex-1" />
      <button onClick={() => reconnect.mutate()} disabled={reconnect.isPending} className="shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-50">
        Reconnect
      </button>
    </div>
  );
}

/** Why a broken account shows nothing, and what to do: once, when the server's error already says to reconnect. */
export function brokenHint(a: Pick<Account, "error">) {
  const why = a.error ?? "Tern can't reach this account.";
  return /reconnect/i.test(why) ? why : `${why} Reconnect it to see its mail.`;
}

/** A broken account with nothing synced: say so, never "Inbox zero". */
function BrokenAccount({ account }: { account: Account }) {
  const reconnect = useReconnect();
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex h-full flex-col items-center justify-center gap-1 px-8 pb-16 text-center"
    >
      <AlertCircleIcon className="mb-3 size-8 text-destructive/70" strokeWidth={1.5} />
      <div className="max-w-full text-[14px] font-medium break-words">{accountTrouble(account)}</div>
      <div className="max-w-[320px] text-[12.5px] break-words text-muted-foreground">
        {brokenHint(account)}
      </div>
      <Button variant="outline" size="sm" className="mt-3" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>
        {reconnect.isPending && <Loader2Icon className="animate-spin" />} Reconnect
      </Button>
    </motion.div>
  );
}
