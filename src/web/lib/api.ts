export type Address = { name: string; email: string };
export type Attachment = { id: string; filename: string; mimeType: string; size: number };
export type Account = { id: string; email: string; name: string; color: string; status: string; error: string | null; connected: boolean };
export type Thread = {
  account_id: string; thread_id: string; subject: string; snippet: string; last_date: number; participants: Address[];
  count: number; unread: number; starred: number; in_inbox: number; in_sent: number; in_trash: number; in_spam: number;
  has_attachments: number; labels: string[]; category: string | null; priority: number | null; summary: string | null;
  needs_reply: number | null; ai_at: number | null;
};
export type Message = {
  id: string; account_id: string; thread_id: string; internal_date: number; from_name: string; from_email: string;
  to: Address[]; cc: Address[]; subject: string; snippet: string; text: string; html: string; labels: string[];
  message_id: string; references: string; attachments: Attachment[];
};
/**
 * `categories` counts every account; `accounts[id].categories` the same per account, for a scoped sidebar.
 * `inbox` is every thread in the inbox, read or not.
 */
export type Counts = {
  accounts: Record<string, { inbox: number; inboxUnread: number; needsReply: number; categories: Record<string, number> }>;
  categories: Record<string, number>;
};
export type AccountsResponse = { accounts: Account[]; counts: Counts; labels: { account_id: string; id: string; name: string }[] };
export type Settings = {
  google: { configured: boolean; clientId: string };
  redirectUri: string;
  ai: {
    enabled: boolean; classifyModel: string; writeModel: string; claudePath?: string;
    /** Reasoning effort per model; unset is Default (none sent). */
    classifyEffort?: Effort; writeEffort?: Effort;
    /** Your own Anthropic-compatible endpoint; unset means the Claude Code login. */
    baseUrl?: string; keyHeader?: KeyHeader; apiKeySet: boolean;
  };
};
/** What you cleared in Tern, for one account or All accounts: see src/server/stats.ts. */
export type Stats = {
  today: string;
  /** Threads cleared today: read while unread in the inbox, or taken out of it. */
  cleared: number;
  /** Reached zero unread in the inbox today. */
  zeroToday: boolean;
  /** Days in a row at zero unread, today included once reached. */
  streak: number;
  days: { day: string; read: number; archived: number; trashed: number; spammed: number; cleared: number; zero: boolean }[];
};
export type KeyHeader = "x-api-key" | "bearer";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** What Settings › AI saves; `apiKey` goes to the server only, "" removes it, and "" sets an effort back to Default. */
export type AiPatch = Partial<Omit<Settings["ai"], "apiKeySet" | "classifyEffort" | "writeEffort">> & {
  apiKey?: string; classifyEffort?: Effort | ""; writeEffort?: Effort | "";
};
export type AiStatus = {
  enabled: boolean; claudePath: string | null; mode: "login" | "endpoint"; endpoint: string | null; busy: boolean; lastError: string | null;
  lastErrorCode: "signed_out" | "missing" | "rate_limited" | "failed" | null; classified: number;
};
export type Action = "archive" | "inbox" | "star" | "unstar" | "read" | "unread" | "trash" | "untrash" | "spam" | "notspam";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Session = { authed: boolean; passwordRequired: boolean; demo: boolean; /** set here, when a request is refused mid-session */ expired?: boolean };

let signedOut: (() => void) | null = null;
let ended = false;
/** Has the server refused a request because the session ended, with no sign-in since? */
export const sessionEnded = () => ended;
/** Called when the server refuses a request because the session has ended (expired, or signed out elsewhere). */
export function onSignedOut(fn: () => void) {
  signedOut = fn;
  return () => {
    if (signedOut === fn) signedOut = null;
  };
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "x-tern": "1", ...(body !== undefined && { "content-type": "application/json" }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach Tern. Check that it's running.");
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/api/login") {
    ended = true;
    signedOut?.();
  }
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? (res.statusText || `Error ${res.status}`));
  return json as T;
}

export const api = {
  session: () => req<Session>("GET", "/api/session").then((s) => (s.authed ? s : { ...s, expired: ended })),
  signIn: (pw: string) => req("POST", "/api/login", { password: pw }).then((r) => ((ended = false), r)),
  signOut: () => req("POST", "/api/logout"),
  accounts: () => req<AccountsResponse>("GET", "/api/accounts"),
  connect: () => req<{ url: string; redirectUri: string }>("POST", "/api/accounts/connect"),
  completeConnect: (url: string) => req<{ account: Account }>("POST", "/api/accounts/complete", { url }),
  updateAccount: (id: string, patch: Partial<Pick<Account, "name" | "color">>) => req("PATCH", `/api/accounts/${id}`, patch),
  removeAccount: (id: string) => req("DELETE", `/api/accounts/${id}`),
  sync: (id: string) => req("POST", `/api/accounts/${id}/sync`),
  /** Look for new mail in every account now; the server does it at most once every 5 s. */
  syncAll: () => req("POST", "/api/sync"),
  threads: (p: { view: string; account?: string; q?: string; cursor?: string }) => {
    const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return req<{ threads: Thread[]; next: string | null }>("GET", `/api/threads?${s}`);
  },
  thread: (account: string, thread: string) => req<{ thread: Thread; messages: Message[] }>("GET", `/api/threads/${account}/${thread}`),
  /** `undo`: it takes back the action before it, so that one stops counting toward the day's stats. */
  act: (account: string, thread: string, action: Action, undo = false) => req("POST", `/api/threads/${account}/${thread}/${action}${undo ? "?undo=1" : ""}`),
  stats: (account: string | null) => req<Stats>("GET", `/api/stats${account ? `?account=${encodeURIComponent(account)}` : ""}`),
  send: (m: { accountId: string; to: string; cc?: string; bcc?: string; subject: string; text: string; threadId?: string }) =>
    req<{ id: string; threadId: string }>("POST", "/api/send", m),
  aiStatus: () => req<AiStatus>("GET", "/api/ai/status"),
  summarize: (accountId: string, threadId: string) => req<{ summary: string; actions: string[] }>("POST", "/api/ai/summarize", { accountId, threadId }),
  draft: (accountId: string, threadId: string, instruction?: string) => req<{ body: string }>("POST", "/api/ai/draft", { accountId, threadId, instruction }),
  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: { google?: { clientId: string; clientSecret: string }; ai?: AiPatch }) => req("PUT", "/api/settings", s),
};

export const threadKey = (t: { account_id: string; thread_id: string }) => `${t.account_id}:${t.thread_id}`;
