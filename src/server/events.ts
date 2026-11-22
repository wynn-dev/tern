export type TernEvent =
  | { type: "threads"; keys: [accountId: string, threadId: string][] }
  | { type: "account"; accountId: string }
  | { type: "ai"; keys: [accountId: string, threadId: string][] }
  | { type: "sync"; accountId: string; status: string; progress?: number };

type Listener = (e: TernEvent) => void;
const listeners = new Set<Listener>();

export const events = {
  on(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit(e: TernEvent) {
    for (const fn of listeners) fn(e);
  },
};
