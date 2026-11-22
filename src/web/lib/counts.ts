import type { Counts } from "./api";

export type ScopedCounts = { inboxUnread: number; needsReply: number; categories: Record<string, number> };

/** The sidebar's counts for one account, or summed over all of them when `account` is null. */
export function scopedCounts(counts: Counts | undefined, account: string | null): ScopedCounts {
  if (!counts) return { inboxUnread: 0, needsReply: 0, categories: {} };
  if (account) {
    const c = counts.accounts[account];
    return { inboxUnread: c?.inboxUnread ?? 0, needsReply: c?.needsReply ?? 0, categories: c?.categories ?? {} };
  }
  const all = Object.values(counts.accounts);
  return {
    inboxUnread: all.reduce((n, c) => n + c.inboxUnread, 0),
    needsReply: all.reduce((n, c) => n + c.needsReply, 0),
    categories: counts.categories,
  };
}

/**
 * Unread threads in the whole view, not just the pages loaded so far, for the list header.
 * Only the inbox and smart views have a count (theirs are unread inbox mail); other views get undefined.
 */
export function viewUnread(view: string, c: ScopedCounts): number | undefined {
  if (view === "inbox") return c.inboxUnread;
  if (view.startsWith("category:")) return c.categories[view.slice(9)] ?? 0;
  return undefined;
}
