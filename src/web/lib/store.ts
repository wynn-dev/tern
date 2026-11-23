import { create } from "zustand";
import { formatRoute, historyMode, parseRoute, type Route } from "./route";

export type ComposeDraft = {
  id: string;
  accountId?: string;
  to: string;
  cc: string;
  subject: string;
  text: string;
  threadId?: string;
  mode: "new" | "reply" | "forward";
  /** The message being replied to, quoted under the reply when sent. */
  quoted?: string;
  /** Shown above the body and never sent, e.g. that a forward leaves the attachments out. */
  note?: string;
  /** Written for you (an AI draft): work you'd lose from the start, so closing it asks like an edited one. */
  generated?: boolean;
};

/** What the Inbox lists: only unread threads, or all of them. */
export type InboxShows = "unread" | "all";

type State = {
  view: string;
  account: string | null;
  query: string;
  selected: string | null; // thread key
  cursor: number;
  /** The open draft as it was opened; what it holds now is `liveDraft()`. */
  compose: ComposeDraft | null;
  composeMinimized: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  /** The Inbox's Unread / All choice, by account id, and "" for All accounts. Unset is Unread. */
  inboxShows: Record<string, InboxShows>;
  setView: (view: string, account?: string | null) => void;
  setQuery: (q: string) => void;
  select: (key: string | null) => void;
  setCursor: (i: number) => void;
  /** Open a draft. One with edits is never dropped without asking: say no and it stays, in view. */
  openCompose: (d?: Partial<ComposeDraft>) => void;
  closeCompose: () => void;
  /** Close the draft, asking first if it has edits. False when the person keeps it. */
  discardCompose: () => boolean;
  minimizeCompose: (min: boolean) => void;
  /** Switch the Inbox you're looking at between Unread and All, and remember it for that account. */
  toggleInboxShows: () => void;
  set: (p: Partial<Pick<State, "paletteOpen" | "settingsOpen" | "helpOpen">>) => void;
};

/**
 * What the open draft holds now. The composer writes it as you type, outside the store's state,
 * so typing re-renders nothing but the composer.
 */
let live: ComposeDraft | null = null;
export const liveDraft = () => live;
export const editCompose = (d: ComposeDraft) => {
  if (live?.id === d.id) live = d;
};

const fields = (d: ComposeDraft) => [d.to, d.cc, d.subject, d.text].map((v) => v.trim()).join("\u0000");
/** Edited since it was opened, or written by the AI: a Forward's copied message or a reply's prefilled To don't count. */
export const isDirty = (opened: ComposeDraft | null) =>
  !!opened && !!live && live.id === opened.id && (!!opened.generated || fields(live) !== fields(opened));

const confirmDiscard = () => confirm("Discard the draft you're writing?");

const SHOWS_KEY = "tern-inbox-shows";
/** The Unread / All choices as saved, which a reload starts from. */
export function storedShows(): Record<string, InboxShows> {
  try {
    const v = JSON.parse(localStorage.getItem(SHOWS_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export const inboxShows = (s: Pick<State, "account" | "inboxShows">): InboxShows => s.inboxShows[s.account ?? ""] ?? "unread";
/** The Inbox's Unread view is what's listed: the Inbox, not a search, set to Unread. */
export const unreadView = (s: Pick<State, "view" | "query" | "account" | "inboxShows">) => s.view === "inbox" && !s.query && inboxShows(s) === "unread";

const initial: Route = typeof location === "undefined" ? { view: "inbox", account: null, query: "", selected: null } : parseRoute(location);

export const useStore = create<State>((set, get) => ({
  ...initial,
  cursor: 0,
  compose: null,
  composeMinimized: false,
  paletteOpen: false,
  settingsOpen: false,
  helpOpen: false,
  inboxShows: storedShows(),
  setView: (view, account) => set((s) => ({ view, account: account === undefined ? s.account : account, selected: null, cursor: 0, query: "" })),
  setQuery: (query) => set({ query, cursor: 0 }),
  select: (selected) => set({ selected }),
  setCursor: (cursor) => set({ cursor }),
  openCompose: (d) =>
    set((s) => {
      const opened = { id: crypto.randomUUID(), to: "", cc: "", subject: "", text: "", mode: "new" as const, ...d };
      if (isDirty(s.compose)) {
        const cur = s.compose!;
        // r or a on the thread you're already answering brings that reply back,
        // with the recipients just asked for and what you've written kept
        if (!d?.text && d?.mode === cur.mode && !!d.threadId && d.threadId === cur.threadId) {
          if (d.to === cur.to && (d.cc ?? "") === cur.cc) return { composeMinimized: false };
          live = { ...live!, id: opened.id, to: opened.to, cc: opened.cc };
          return { compose: opened, composeMinimized: false };
        }
        if (!confirmDiscard()) return { composeMinimized: false };
      }
      live = opened;
      return { compose: opened, composeMinimized: false };
    }),
  closeCompose: () => {
    live = null;
    set({ compose: null, composeMinimized: false });
  },
  discardCompose: () => {
    if (isDirty(get().compose) && !confirmDiscard()) return false;
    get().closeCompose();
    return true;
  },
  minimizeCompose: (composeMinimized) => set({ composeMinimized }),
  toggleInboxShows: () => {
    const s = get();
    const next = { ...s.inboxShows, [s.account ?? ""]: inboxShows(s) === "unread" ? ("all" as const) : ("unread" as const) };
    try {
      localStorage.setItem(SHOWS_KEY, JSON.stringify(next));
    } catch {}
    set({ inboxShows: next });
  },
  set: (p) => set(p),
}));

const routeOf = (s: Route): Route => ({ view: s.view, account: s.account, query: s.query, selected: s.selected });

/**
 * Keep the URL and the store in step; call once at startup. The store stays the source of truth,
 * so j/k never wait on the router: their URL updates are coalesced into one replaceState.
 */
export function syncStoreWithUrl() {
  let current = routeOf(useStore.getState());
  let applying = false;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // each pushed entry remembers the URL it was pushed from, so closing a thread
  // or clearing a search goes back to that entry rather than piling up copies of it
  const from = () => (history.state as { from?: string } | null)?.from;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending !== undefined) history.replaceState({ from: from() }, "", pending);
    pending = undefined;
  };
  // the Google sign-in redirect's ?connected / ?error are Mail's to read and clear
  if (!/[?&](connected|error)=/.test(location.search)) history.replaceState({ from: from() }, "", formatRoute(current));

  useStore.subscribe((s) => {
    if (applying) return;
    const next = routeOf(s);
    const mode = historyMode(current, next);
    if (mode === "none") return;
    const url = formatRoute(next);
    current = next;
    if (mode === "push") {
      flush();
      history.pushState({ from: location.pathname + location.search }, "", url);
    } else if (url === from()) {
      pending = undefined;
      clearTimeout(timer);
      history.back();
    } else {
      pending = url;
      timer ??= setTimeout(flush, 150);
    }
  });

  addEventListener("popstate", () => {
    pending = undefined;
    clearTimeout(timer);
    timer = undefined;
    const r = parseRoute(location);
    if (formatRoute(r) === formatRoute(current)) return;
    current = r;
    applying = true;
    useStore.setState({ ...r, cursor: 0 });
    applying = false;
  });
  addEventListener("pagehide", flush);
}
