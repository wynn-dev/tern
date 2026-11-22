import { create } from "zustand";

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

export const useStore = create<State>((set) => ({
  view: "inbox",
  account: null,
  query: "",
  selected: null,
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
