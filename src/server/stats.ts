import type { Action } from "./actions";
import { getDb } from "./db";

/** The local calendar day, `2026-11-22`: what "today" and a streak count in. */
export function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The day before `day`, as a day key. */
function prevDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

/**
 * Days in a row at inbox zero, up to today. Today still counts as kept while it isn't over:
 * reached zero yesterday and not yet today, the streak is yesterday's.
 */
export function streak(zeroDays: Set<string>, today: string) {
  let day = zeroDays.has(today) ? today : prevDay(today);
  let n = 0;
  while (zeroDays.has(day)) {
    n++;
    day = prevDay(day);
  }
  return n;
}

/** What taking a thread out of the inbox was; undoing it puts it back. */
const REMOVES = new Set<Action>(["archive", "trash", "spam"]);
const UNDOES: Partial<Record<Action, Action>> = { inbox: "archive", untrash: "trash", notspam: "spam" };

const db = () => getDb();

/** Unread threads in the inbox now, per account (accounts with none aren't listed). */
function unreadSizes() {
  return db().query("SELECT account_id, COUNT(*) AS n FROM threads WHERE in_inbox = 1 AND in_trash = 0 AND in_spam = 0 AND unread = 1 GROUP BY account_id")
    .all() as { account_id: string; n: number }[];
}

/** Note today as at zero unread for the account, and for All accounts, where that's so now. */
function markZero(accountId: string, day: string) {
  const sizes = unreadSizes();
  const mark = db().query("INSERT OR IGNORE INTO zero_days (scope, day) VALUES (?, ?)");
  if (!sizes.some((r) => r.account_id === accountId)) mark.run(accountId, day);
  if (!sizes.length) mark.run("", day);
}

/**
 * Count an action you took in Tern toward the day: reading an unread inbox thread, or taking one out of the inbox,
 * clears it (once a day, however many of those you do to it). Mark unread, or undoing the removal, takes that back.
 * Once it leaves no unread mail in the inbox, the day is at zero, for the account and, when every inbox is, All accounts.
 */
export function recordAction(
  accountId: string, threadId: string, action: Action,
  { wasInInbox, wasUnread, undo = false, now = new Date() }: { wasInInbox: boolean; wasUnread: boolean; undo?: boolean; now?: Date },
) {
  const day = dayKey(now);
  const key = [day, accountId, threadId] as const;
  const clear = (col: "read" | "removed") => {
    db().query(`UPDATE triage_threads SET ${col} = ${col === "read" ? 0 : "NULL"} WHERE day = ? AND account_id = ? AND thread_id = ?`).run(...key);
    db().query("DELETE FROM triage_threads WHERE day = ? AND account_id = ? AND thread_id = ? AND read = 0 AND removed IS NULL").run(...key);
  };
  if (action === "unread") return clear("read");
  if (undo) return UNDOES[action] && clear("removed");
  const read = action === "read" && wasInInbox && wasUnread;
  const removed = REMOVES.has(action) && wasInInbox;
  if (!read && !removed) return;
  db().transaction(() => {
    db().query(`INSERT INTO triage_threads (day, account_id, thread_id, read, removed) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, account_id, thread_id) DO UPDATE SET read = MAX(read, excluded.read), removed = COALESCE(excluded.removed, removed)`)
      .run(...key, read ? 1 : 0, removed ? action : null);
    markZero(accountId, day);
  })();
}

export type TriageDay = { day: string; read: number; archived: number; trashed: number; spammed: number; cleared: number; zero: boolean };
export type Stats = {
  /** Today's day key, so the client agrees with the server on what "today" is. */
  today: string;
  /** Threads you cleared today: read while unread in the inbox, or taken out of it. */
  cleared: number;
  /** You reached zero unread in the inbox today. */
  zeroToday: boolean;
  /** Days in a row you reached zero unread, today included once you have. */
  streak: number;
  /** The last 30 days with anything in them, newest first. */
  days: TriageDay[];
};

/** Triage stats for one account, or for All accounts when `account` is null. */
export function stats(account: string | null, now = new Date()): Stats {
  const today = dayKey(now);
  const rows = db().query(`SELECT day, SUM(read) AS read, COUNT(removed = 'archive' OR NULL) AS archived,
      COUNT(removed = 'trash' OR NULL) AS trashed, COUNT(removed = 'spam' OR NULL) AS spammed, COUNT(*) AS cleared
    FROM triage_threads WHERE ?1 IS NULL OR account_id = ?1 GROUP BY day`).all(account) as Omit<TriageDay, "zero">[];
  const zero = new Set((db().query("SELECT day FROM zero_days WHERE scope = ?").all(account ?? "") as { day: string }[]).map((r) => r.day));
  const byDay = new Map(rows.map((r) => [r.day, { ...r, zero: zero.has(r.day) }]));
  for (const day of zero) if (!byDay.has(day)) byDay.set(day, { day, read: 0, archived: 0, trashed: 0, spammed: 0, cleared: 0, zero: true });
  const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
  return {
    today,
    cleared: byDay.get(today)?.cleared ?? 0,
    zeroToday: zero.has(today),
    streak: streak(zero, today),
    days: days.slice(0, 30),
  };
}
