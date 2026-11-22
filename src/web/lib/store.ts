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
};

type State = {
  view: string;
  account: string | null;
  query: string;
  selected: string | null; // thread key
  cursor: number;
  compose: ComposeDraft | null;
  paletteOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  setView: (view: string, account?: string | null) => void;
  setQuery: (q: string) => void;
  select: (key: string | null) => void;
  setCursor: (i: number) => void;
  openCompose: (d?: Partial<ComposeDraft>) => void;
  closeCompose: () => void;
  set: (p: Partial<Pick<State, "paletteOpen" | "settingsOpen" | "helpOpen">>) => void;
};

const initial: Route = typeof location === "undefined" ? { view: "inbox", account: null, query: "", selected: null } : parseRoute(location);

export const useStore = create<State>((set) => ({
  ...initial,
  cursor: 0,
  compose: null,
  paletteOpen: false,
  settingsOpen: false,
  helpOpen: false,
  setView: (view, account) => set((s) => ({ view, account: account === undefined ? s.account : account, selected: null, cursor: 0, query: "" })),
  setQuery: (query) => set({ query, cursor: 0 }),
  select: (selected) => set({ selected }),
  setCursor: (cursor) => set({ cursor }),
  openCompose: (d) => set({ compose: { id: crypto.randomUUID(), to: "", cc: "", subject: "", text: "", mode: "new", ...d } }),
  closeCompose: () => set({ compose: null }),
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
  history.replaceState({ from: from() }, "", formatRoute(current));

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
