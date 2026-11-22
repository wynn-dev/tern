import { Database } from "bun:sqlite";
import { join } from "node:path";
import { ensureDataDir } from "./config";

export type Account = {
  id: string;
  email: string;
  name: string;
  color: string;
  token: string | null;
  history_id: string | null;
  status: string;
  error: string | null;
  created_at: number;
};

export type Address = { name: string; email: string };
export type Attachment = { id: string; filename: string; mimeType: string; size: number };

export type Message = {
  id: string;
  account_id: string;
  thread_id: string;
  internal_date: number;
  from_name: string;
  from_email: string;
  to: Address[];
  cc: Address[];
  subject: string;
  snippet: string;
  text: string;
  html: string;
  labels: string[];
  message_id: string;
  references: string;
  attachments: Attachment[];
};

export type Thread = {
  account_id: string;
  thread_id: string;
  subject: string;
  snippet: string;
  last_date: number;
  participants: Address[];
  count: number;
  unread: number;
  starred: number;
  in_inbox: number;
  in_sent: number;
  in_trash: number;
  in_spam: number;
  has_attachments: number;
  labels: string[];
  category: string | null;
  priority: number | null;
  summary: string | null;
  needs_reply: number | null;
  ai_at: number | null;
};

export const CATEGORIES = [
  "important",
  "personal",
  "work",
  "updates",
  "finance",
  "travel",
  "newsletters",
  "promotions",
  "social",
] as const;
export type Category = (typeof CATEGORIES)[number];

let db: Database;

export function openDb(path = join(ensureDataDir(), "tern.db")): Database {
  db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate();
  return db;
}

export const getDb = () => db;

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      token TEXT,
      history_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      rowid INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      internal_date INTEGER NOT NULL,
      from_name TEXT NOT NULL DEFAULT '',
      from_email TEXT NOT NULL DEFAULT '',
      to_json TEXT NOT NULL DEFAULT '[]',
      cc_json TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      html TEXT NOT NULL DEFAULT '',
      labels TEXT NOT NULL DEFAULT '[]',
      message_id TEXT NOT NULL DEFAULT '',
      refs TEXT NOT NULL DEFAULT '',
      attachments TEXT NOT NULL DEFAULT '[]',
      UNIQUE(account_id, id)
    );
    CREATE INDEX IF NOT EXISTS messages_thread ON messages(account_id, thread_id, internal_date);

    CREATE TABLE IF NOT EXISTS threads (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      last_date INTEGER NOT NULL,
      participants TEXT NOT NULL DEFAULT '[]',
      count INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0,
      in_inbox INTEGER NOT NULL DEFAULT 0,
      in_sent INTEGER NOT NULL DEFAULT 0,
      in_trash INTEGER NOT NULL DEFAULT 0,
      in_spam INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      labels TEXT NOT NULL DEFAULT '[]',
      category TEXT,
      priority INTEGER,
      summary TEXT,
      needs_reply INTEGER,
      ai_at INTEGER,
      PRIMARY KEY (account_id, thread_id)
    );
    CREATE INDEX IF NOT EXISTS threads_date ON threads(last_date DESC);
    CREATE INDEX IF NOT EXISTS threads_inbox ON threads(in_inbox, last_date DESC);
    CREATE INDEX IF NOT EXISTS threads_ai ON threads(ai_at);
    CREATE INDEX IF NOT EXISTS threads_page ON threads(last_date DESC, account_id DESC, thread_id DESC);

    CREATE TABLE IF NOT EXISTS labels (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      PRIMARY KEY (account_id, id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      subject, sender, body, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, subject, sender, body) VALUES (new.rowid, new.subject, new.from_name || ' ' || new.from_email, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, subject, sender, body) VALUES ('delete', old.rowid, old.subject, old.from_name || ' ' || old.from_email, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF subject, text ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, subject, sender, body) VALUES ('delete', old.rowid, old.subject, old.from_name || ' ' || old.from_email, old.text);
      INSERT INTO messages_fts(rowid, subject, sender, body) VALUES (new.rowid, new.subject, new.from_name || ' ' || new.from_email, new.text);
    END;
  `);
}

// ---------- accounts ----------

const ACCOUNT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#84cc16"];

export function listAccounts(): Account[] {
  return db.query("SELECT * FROM accounts ORDER BY created_at").all() as Account[];
}

export function getAccount(id: string): Account | null {
  return db.query("SELECT * FROM accounts WHERE id = ?").get(id) as Account | null;
}

export function upsertAccount(a: { id: string; email: string; name: string; token: string | null }): Account {
  const existing = db.query("SELECT * FROM accounts WHERE email = ?").get(a.email) as Account | null;
  if (existing) {
    db.query("UPDATE accounts SET token = ?, name = ?, status = 'idle', error = NULL WHERE id = ?").run(a.token, a.name, existing.id);
    return getAccount(existing.id)!;
  }
  const n = (db.query("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
  db.query("INSERT INTO accounts (id, email, name, color, token, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    a.id, a.email, a.name, ACCOUNT_COLORS[n % ACCOUNT_COLORS.length], a.token, Date.now(),
  );
  return getAccount(a.id)!;
}

export function updateAccount(id: string, patch: Partial<Pick<Account, "token" | "history_id" | "status" | "error" | "name" | "color">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db.query(`UPDATE accounts SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), id);
}

export function deleteAccount(id: string) {
  db.transaction(() => {
    db.query("DELETE FROM messages WHERE account_id = ?").run(id);
    db.query("DELETE FROM accounts WHERE id = ?").run(id);
  })();
}

// ---------- messages & threads ----------

type MessageRow = Omit<Message, "to" | "cc" | "labels" | "attachments" | "references"> & {
  to_json: string; cc_json: string; labels: string; attachments: string; refs: string;
};

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  account_id: r.account_id,
  thread_id: r.thread_id,
  internal_date: r.internal_date,
  from_name: r.from_name,
  from_email: r.from_email,
  to: JSON.parse(r.to_json),
  cc: JSON.parse(r.cc_json),
  subject: r.subject,
  snippet: r.snippet,
  text: r.text,
  html: r.html,
  labels: JSON.parse(r.labels),
  message_id: r.message_id,
  references: r.refs,
  attachments: JSON.parse(r.attachments),
});

export function upsertMessages(msgs: Message[]) {
  if (!msgs.length) return;
  const ins = db.query(`
    INSERT INTO messages (id, account_id, thread_id, internal_date, from_name, from_email, to_json, cc_json, subject, snippet, text, html, labels, message_id, refs, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, id) DO UPDATE SET labels = excluded.labels, snippet = excluded.snippet
  `);
  const touched = new Set<string>();
  db.transaction(() => {
    for (const m of msgs) {
      ins.run(m.id, m.account_id, m.thread_id, m.internal_date, m.from_name, m.from_email, JSON.stringify(m.to), JSON.stringify(m.cc),
        m.subject, m.snippet, m.text, m.html, JSON.stringify(m.labels), m.message_id, m.references, JSON.stringify(m.attachments));
      touched.add(`${m.account_id}\u0000${m.thread_id}`);
    }
    for (const key of touched) {
      const [a, t] = key.split("\u0000");
      rebuildThread(a, t);
    }
  })();
  return [...touched].map((k) => k.split("\u0000") as [string, string]);
}

export function setMessageLabels(accountId: string, messageId: string, labels: string[]) {
  const r = db.query("UPDATE messages SET labels = ? WHERE account_id = ? AND id = ? RETURNING thread_id").get(
    JSON.stringify(labels), accountId, messageId,
  ) as { thread_id: string } | null;
  if (r) rebuildThread(accountId, r.thread_id);
  return r?.thread_id ?? null;
}

export function deleteMessage(accountId: string, messageId: string) {
  const r = db.query("DELETE FROM messages WHERE account_id = ? AND id = ? RETURNING thread_id").get(accountId, messageId) as
    | { thread_id: string }
    | null;
  if (r) rebuildThread(accountId, r.thread_id);
  return r?.thread_id ?? null;
}

export function hasMessage(accountId: string, id: string) {
  return !!db.query("SELECT 1 FROM messages WHERE account_id = ? AND id = ?").get(accountId, id);
}

/** The account wrote this message: Gmail filed it as sent, or it's from the account's own address. */
const fromMe = (m: Pick<Message, "from_email" | "labels">, email: string | undefined) =>
  m.labels.includes("SENT") || (!!email && m.from_email.toLowerCase() === email.toLowerCase());

const accountEmail = (accountId: string) =>
  (db.query("SELECT email FROM accounts WHERE id = ?").get(accountId) as { email: string } | null)?.email;

/**
 * Recompute a thread's summary row from its messages; drops it when none are left.
 * A thread whose last message is the account's own has been answered, so it leaves Needs reply.
 */
export function rebuildThread(accountId: string, threadId: string) {
  const rows = db
    .query("SELECT * FROM messages WHERE account_id = ? AND thread_id = ? ORDER BY internal_date")
    .all(accountId, threadId) as MessageRow[];
  if (!rows.length) {
    db.query("DELETE FROM threads WHERE account_id = ? AND thread_id = ?").run(accountId, threadId);
    return;
  }
  const msgs = rows.map(toMessage);
  const all = new Set(msgs.flatMap((m) => m.labels));
  const last = msgs.at(-1)!;
  const seen = new Map<string, Address>();
  for (const m of msgs) if (m.from_email && !seen.has(m.from_email)) seen.set(m.from_email, { name: m.from_name, email: m.from_email });
  const any = (l: string) => (msgs.some((m) => m.labels.includes(l)) ? 1 : 0);
  const every = (l: string) => (msgs.every((m) => m.labels.includes(l)) ? 1 : 0);
  const answered = fromMe(last, accountEmail(accountId)) ? 1 : 0;
  db.query(`
    INSERT INTO threads (account_id, thread_id, subject, snippet, last_date, participants, count, unread, starred, in_inbox, in_sent, in_trash, in_spam, has_attachments, labels)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, thread_id) DO UPDATE SET
      subject = excluded.subject, snippet = excluded.snippet, last_date = excluded.last_date, participants = excluded.participants,
      count = excluded.count, unread = excluded.unread, starred = excluded.starred, in_inbox = excluded.in_inbox, in_sent = excluded.in_sent,
      in_trash = excluded.in_trash, in_spam = excluded.in_spam, has_attachments = excluded.has_attachments, labels = excluded.labels,
      ai_at = CASE WHEN threads.last_date < excluded.last_date THEN NULL ELSE threads.ai_at END,
      needs_reply = CASE WHEN ? THEN 0 ELSE threads.needs_reply END
  `).run(
    accountId, threadId, msgs[0].subject || last.subject, last.snippet, last.internal_date, JSON.stringify([...seen.values()].slice(0, 6)),
    msgs.length, any("UNREAD"), any("STARRED"), any("INBOX"), any("SENT"), every("TRASH"), any("SPAM"),
    msgs.some((m) => m.attachments.length) ? 1 : 0, JSON.stringify([...all]), answered,
  );
}

type ThreadRow = Omit<Thread, "participants" | "labels"> & { participants: string; labels: string };
const toThread = (r: ThreadRow): Thread => ({ ...r, participants: JSON.parse(r.participants), labels: JSON.parse(r.labels) });

export type ThreadQuery = { view: string; account?: string; q?: string; cursor?: string; limit?: number };

/**
 * Where the next page starts: the last thread's (last_date, account_id, thread_id), which is unique,
 * so threads that share a timestamp are neither skipped nor repeated across pages.
 */
export const threadCursor = (t: Pick<Thread, "last_date" | "account_id" | "thread_id">) =>
  Buffer.from(JSON.stringify([t.last_date, t.account_id, t.thread_id])).toString("base64url");

export function parseCursor(c: string): [number, string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString());
    return Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "string" && typeof v[2] === "string" ? [v[0], v[1], v[2]] : null;
  } catch {
    return null;
  }
}

export function queryThreads({ view, account, q, cursor, limit = 60 }: ThreadQuery): Thread[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (view === "inbox") where.push("t.in_inbox = 1 AND t.in_trash = 0 AND t.in_spam = 0");
  else if (view === "starred") where.push("t.starred = 1 AND t.in_trash = 0 AND t.in_spam = 0");
  else if (view === "sent") where.push("t.in_sent = 1 AND t.in_trash = 0");
  else if (view === "trash") where.push("t.in_trash = 1");
  else if (view === "spam") where.push("t.in_spam = 1");
  else if (view === "all") where.push("t.in_trash = 0 AND t.in_spam = 0");
  else if (view === "needs-reply") where.push("t.needs_reply = 1 AND t.in_inbox = 1 AND t.in_trash = 0 AND t.in_spam = 0");
  else if (view.startsWith("category:")) {
    where.push("t.category = ? AND t.in_inbox = 1 AND t.in_trash = 0 AND t.in_spam = 0");
    args.push(view.slice(9));
  } else if (view.startsWith("label:")) {
    // by name, so a label that several accounts share is one view; Gmail's label ids are per account
    where.push(`t.in_trash = 0 AND t.in_spam = 0 AND EXISTS (SELECT 1 FROM json_each(t.labels) j
      JOIN labels l ON l.account_id = t.account_id AND l.id = j.value WHERE l.name = ?)`);
    args.push(view.slice(6));
  }
  if (account) {
    where.push("t.account_id = ?");
    args.push(account);
  }
  const after = cursor ? parseCursor(cursor) : null;
  if (cursor && !after) throw new Error("Bad cursor");
  if (after) {
    where.push("(t.last_date, t.account_id, t.thread_id) < (?, ?, ?)");
    args.push(...after);
  }
  if (q?.trim()) {
    where.push(`EXISTS (SELECT 1 FROM messages m JOIN messages_fts f ON f.rowid = m.rowid
      WHERE messages_fts MATCH ? AND m.account_id = t.account_id AND m.thread_id = t.thread_id)`);
    args.push(ftsQuery(q));
  }
  const sql = `SELECT t.* FROM threads t ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY t.last_date DESC, t.account_id DESC, t.thread_id DESC LIMIT ?`;
  return (db.query(sql).all(...args, limit) as ThreadRow[]).map(toThread);
}

/** Turn free text into a safe FTS5 prefix query: `foo bar` → `"foo"* "bar"*`. */
function ftsQuery(q: string) {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(" ");
}

export const hasThread = (accountId: string, threadId: string) =>
  !!db.query("SELECT 1 FROM threads WHERE account_id = ? AND thread_id = ?").get(accountId, threadId);

export function getThread(accountId: string, threadId: string): { thread: Thread; messages: Message[] } | null {
  const t = db.query("SELECT * FROM threads WHERE account_id = ? AND thread_id = ?").get(accountId, threadId) as ThreadRow | null;
  if (!t) return null;
  const rows = db
    .query("SELECT * FROM messages WHERE account_id = ? AND thread_id = ? ORDER BY internal_date")
    .all(accountId, threadId) as MessageRow[];
  return { thread: toThread(t), messages: rows.map(toMessage) };
}

export function threadMessages(accountId: string, threadId: string): Message[] {
  return (db.query("SELECT * FROM messages WHERE account_id = ? AND thread_id = ? ORDER BY internal_date").all(accountId, threadId) as MessageRow[]).map(toMessage);
}

export type Counts = {
  accounts: Record<string, { inboxUnread: number; needsReply: number; categories: Record<string, number> }>;
  /** Unread per smart view across all accounts; each account's own are in `accounts[id].categories`. */
  categories: Record<string, number>;
};

export function counts(): Counts {
  const rows = db.query(`
    SELECT account_id,
      SUM(CASE WHEN in_inbox = 1 AND in_trash = 0 AND in_spam = 0 AND unread = 1 THEN 1 ELSE 0 END) AS inbox_unread,
      SUM(CASE WHEN in_inbox = 1 AND in_trash = 0 AND in_spam = 0 AND needs_reply = 1 THEN 1 ELSE 0 END) AS needs_reply
    FROM threads GROUP BY account_id
  `).all() as { account_id: string; inbox_unread: number; needs_reply: number }[];
  const cats = db.query(`
    SELECT account_id, category, COUNT(*) AS n FROM threads
    WHERE category IS NOT NULL AND in_inbox = 1 AND in_trash = 0 AND in_spam = 0 AND unread = 1 GROUP BY account_id, category
  `).all() as { account_id: string; category: string; n: number }[];
  const out: Counts = {
    accounts: Object.fromEntries(rows.map((r) => [r.account_id, { inboxUnread: r.inbox_unread, needsReply: r.needs_reply, categories: {} }])),
    categories: {},
  };
  for (const c of cats) {
    out.categories[c.category] = (out.categories[c.category] ?? 0) + c.n;
    out.accounts[c.account_id].categories[c.category] = c.n;
  }
  return out;
}

/** Inbox threads from the last `days` days the AI hasn't looked at since their last message. */
export function unclassifiedThreads(limit: number, days = 14): Thread[] {
  return (db.query(`SELECT * FROM threads WHERE ai_at IS NULL AND in_inbox = 1 AND in_trash = 0 AND in_spam = 0 AND last_date > ?
    ORDER BY last_date DESC LIMIT ?`).all(Date.now() - days * 86400_000, limit) as ThreadRow[]).map(toThread);
}

export function setThreadAi(accountId: string, threadId: string, ai: { category: string; priority: number; summary: string; needs_reply: boolean }) {
  // the AI reads the whole thread and can still say "reply"; a thread you answered last isn't waiting on you
  const last = ai.needs_reply
    ? (db.query("SELECT from_email, labels FROM messages WHERE account_id = ? AND thread_id = ? ORDER BY internal_date DESC LIMIT 1")
        .get(accountId, threadId) as { from_email: string; labels: string } | null)
    : null;
  const needsReply = ai.needs_reply && !(last && fromMe({ from_email: last.from_email, labels: JSON.parse(last.labels) }, accountEmail(accountId)));
  db.query("UPDATE threads SET category = ?, priority = ?, summary = ?, needs_reply = ?, ai_at = ? WHERE account_id = ? AND thread_id = ?").run(
    ai.category, ai.priority, ai.summary, needsReply ? 1 : 0, Date.now(), accountId, threadId,
  );
}

export function replaceLabels(accountId: string, labels: { id: string; name: string; type: string }[]) {
  db.transaction(() => {
    db.query("DELETE FROM labels WHERE account_id = ?").run(accountId);
    const ins = db.query("INSERT INTO labels (account_id, id, name, type) VALUES (?, ?, ?, ?)");
    for (const l of labels) ins.run(accountId, l.id, l.name, l.type);
  })();
}

export function userLabels() {
  return db.query("SELECT account_id, id, name FROM labels WHERE type = 'user' ORDER BY name").all() as { account_id: string; id: string; name: string }[];
}

// ---------- sessions ----------

export function createSession(id: string) {
  db.query("INSERT INTO sessions (id, created_at) VALUES (?, ?)").run(id, Date.now());
}
export function hasSession(id: string) {
  return !!db.query("SELECT 1 FROM sessions WHERE id = ? AND created_at > ?").get(id, Date.now() - 30 * 86400_000);
}
export function deleteSession(id: string) {
  db.query("DELETE FROM sessions WHERE id = ?").run(id);
}
