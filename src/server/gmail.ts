import { AsyncLocalStorage } from "node:async_hooks";
import { loadConfig, publicUrl } from "./config";
import { seal, unseal } from "./crypto";
import { getAccount, updateAccount } from "./db";
import type { GmailMessage } from "./mime";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "openid",
  "email",
  "profile",
];

type Token = { access_token: string; refresh_token: string; expires_at: number };

export const redirectUri = () => `${publicUrl(loadConfig())}/oauth/callback`;

function client() {
  const g = loadConfig().google;
  if (!g?.clientId || !g?.clientSecret) throw new Error("Google OAuth client isn't set up yet. Run `tern setup google` or add it in Settings.");
  return g;
}

export function authUrl(state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: client().clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return u.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const { clientId, clientSecret } = client();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
  });
  const json = (await res.json()) as any;
  if (!res.ok) throw new Error(`Google token error: ${json.error_description || json.error || res.status}`);
  return json as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
}

export async function exchangeCode(code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error("Google didn't return a refresh token; remove Tern from your Google account's third-party access and try again.");
  const profile = (await (
    await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.access_token}` } })
  ).json()) as { email: string; name?: string };
  const token: Token = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  return { email: profile.email.toLowerCase(), name: profile.name ?? "", token: seal(JSON.stringify(token)) };
}

const refreshing = new Map<string, Promise<string>>();

async function accessToken(accountId: string): Promise<string> {
  const acc = getAccount(accountId);
  if (!acc?.token) throw new Error("Account isn't connected");
  const tok = JSON.parse(unseal(acc.token)) as Token;
  if (tok.expires_at - 60_000 > Date.now()) return tok.access_token;
  let p = refreshing.get(accountId);
  if (!p) {
    p = (async () => {
      try {
        const t = await tokenRequest({ refresh_token: tok.refresh_token, grant_type: "refresh_token" });
        const next: Token = { ...tok, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
        updateAccount(accountId, { token: seal(JSON.stringify(next)) });
        return t.access_token;
      } catch (e) {
        updateAccount(accountId, { status: "error", error: "Sign-in expired. Reconnect this account." });
        throw e;
      } finally {
        refreshing.delete(accountId);
      }
    })();
    refreshing.set(accountId, p);
  }
  return p;
}

export class GmailError extends Error {
  constructor(public status: number, message: string, public rateLimited = false) {
    super(message);
  }
}

/**
 * Gmail allows 15,000 quota units per user per minute, and smooths it: a burst of a few seconds' worth is all it lets
 * through at once. Tern spends a steady 12,000 a minute with a second's worth of burst for user actions, so no minute
 * goes over (burst + unitsPerMinute < 15,000) and no second does either. minuteMs is there for tests.
 */
export const quota = { unitsPerMinute: 12_000, burst: 250, minuteMs: 60_000 };

/** Gmail's quota units per call (developers.google.com/workspace/gmail/api/reference/quota). */
const COST = { profile: 1, labels: 1, history: 2, get: 5, list: 5, modifyMessage: 5, attachment: 5, modifyThread: 10, trash: 10, send: 100 };

const RATE_LIMIT_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "RATE_LIMIT_EXCEEDED"]);
export const RATE_LIMITED = "Gmail is rate-limiting Tern. Try again in a minute.";

const background = new AsyncLocalStorage<{ onRateLimit?: () => void }>();
/** Run `fn` as background work (sync): its Gmail calls queue behind the user's, and `onRateLimit` hears when Gmail pushes back. */
export const inBackground = <T>(fn: () => Promise<T>, onRateLimit?: () => void) => background.run({ onRateLimit }, fn);

type Waiter = { cost: number; background: boolean; go: () => void };

/** One account's share of the quota: a token bucket weighted by units, shared by sync, actions and send. */
class Bucket {
  private tokens = quota.burst;
  private at = Date.now();
  private pausedUntil = 0;
  private queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  take(cost: number) {
    return new Promise<void>((go) => {
      this.queue.push({ cost, background: !!background.getStore(), go });
      this.pump();
    });
  }

  /** Gmail said the quota is spent: use nothing more until `ms` from now, then start from empty. */
  pause(ms: number) {
    this.tokens = 0;
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    this.at = this.pausedUntil;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pump();
  }

  private pump() {
    if (this.timer) return;
    const now = Date.now();
    if (now < this.pausedUntil) return void (this.timer = setTimeout(() => ((this.timer = undefined), this.pump()), this.pausedUntil - now));
    const rate = quota.unitsPerMinute / quota.minuteMs;
    this.tokens = Math.min(quota.burst, this.tokens + (now - this.at) * rate);
    this.at = now;
    while (this.queue.length) {
      // the user's calls go first; sync waits behind them
      const i = Math.max(0, this.queue.findIndex((w) => !w.background));
      const w = this.queue[i];
      if (this.tokens < w.cost) {
        this.timer = setTimeout(() => ((this.timer = undefined), this.pump()), Math.ceil((w.cost - this.tokens) / rate));
        return;
      }
      this.tokens -= w.cost;
      this.queue.splice(i, 1);
      w.go();
    }
  }
}

const buckets = new Map<string, Bucket>();
const bucket = (accountId: string) => buckets.get(accountId) ?? buckets.set(accountId, new Bucket()).get(accountId)!;

/** Is this a quota error? Gmail sends them as 429, or as 403 with a rate-limit reason. */
function isRateLimit(status: number, body: any) {
  if (status === 429) return true;
  if (status !== 403) return false;
  const reasons = [...(body?.error?.errors ?? []), ...(body?.error?.details ?? [])].map((e: any) => e?.reason);
  return reasons.some((r) => RATE_LIMIT_REASONS.has(r)) || body?.error?.status === "RESOURCE_EXHAUSTED";
}

/** How long Gmail asked us to wait, from Retry-After or a "Retry after <date>" in its message; undefined if it didn't say. */
function retryAfter(res: Response, body: any): number | undefined {
  const h = res.headers.get("retry-after");
  if (h) {
    const s = Number(h);
    const ms = Number.isFinite(s) ? s * 1000 : Date.parse(h) - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, ms);
  }
  const m = /retry after (\d{4}-\d\d-\d\dT[\d:.]+Z)/i.exec(body?.error?.message ?? "");
  const at = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function api<T>(
  accountId: string,
  path: string,
  cost: number,
  init?: RequestInit & { query?: Record<string, string | string[] | undefined> },
): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
  }
  for (let attempt = 0, limited = 0; ; ) {
    await bucket(accountId).take(cost);
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${await accessToken(accountId)}`, "content-type": "application/json", ...init?.headers },
    });
    if (res.ok) return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    const body = (await res.json().catch(() => ({}))) as any;
    if (isRateLimit(res.status, body)) {
      // the quota is per minute: wait as long as Gmail says, else long enough for the minute to roll over
      background.getStore()?.onRateLimit?.();
      const said = retryAfter(res, body);
      const ms = said !== undefined ? Math.max(said, quota.minuteMs / 60) : quota.minuteMs * Math.min(1, 2 ** (limited - 2)) * (1 + Math.random() * 0.2);
      // paused even when giving up, so the next sync tick waits it out instead of asking again
      bucket(accountId).pause(ms);
      if (limited++ < 4) continue;
      throw new GmailError(res.status, RATE_LIMITED, true);
    }
    // back off on transient errors
    if (res.status >= 500 && attempt < 4) {
      await Bun.sleep(500 * 2 ** attempt++ + Math.random() * 250);
      continue;
    }
    throw new GmailError(res.status, body?.error?.message ?? `Gmail ${res.status}`);
  }
}

export const gmail = {
  profile: (a: string) => api<{ emailAddress: string; historyId: string; messagesTotal: number }>(a, "profile", COST.profile),
  labels: (a: string) => api<{ labels: { id: string; name: string; type: string }[] }>(a, "labels", COST.labels),
  list: (a: string, q: { q?: string; pageToken?: string; maxResults?: number; labelIds?: string[]; includeSpamTrash?: boolean }) =>
    api<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(a, "messages", COST.list, {
      query: {
        q: q.q, pageToken: q.pageToken, maxResults: String(q.maxResults ?? 500), labelIds: q.labelIds,
        includeSpamTrash: q.includeSpamTrash ? "true" : undefined,
      },
    }),
  get: (a: string, id: string) => api<GmailMessage>(a, `messages/${id}`, COST.get, { query: { format: "full" } }),
  history: (a: string, startHistoryId: string, pageToken?: string) =>
    api<{
      history?: {
        messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
        messagesDeleted?: { message: { id: string } }[];
        labelsAdded?: { message: { id: string; labelIds?: string[] } }[];
        labelsRemoved?: { message: { id: string; labelIds?: string[] } }[];
      }[];
      historyId: string;
      nextPageToken?: string;
    }>(a, "history", COST.history, { query: { startHistoryId, pageToken, maxResults: "500" } }),
  modifyThread: (a: string, threadId: string, add: string[], remove: string[]) =>
    api<{ messages: { id: string; labelIds: string[] }[] }>(a, `threads/${threadId}/modify`, COST.modifyThread, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    }),
  modifyMessage: (a: string, id: string, add: string[], remove: string[]) =>
    api<{ id: string; labelIds: string[] }>(a, `messages/${id}/modify`, COST.modifyMessage, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    }),
  trashThread: (a: string, threadId: string) => api<unknown>(a, `threads/${threadId}/trash`, COST.trash, { method: "POST" }),
  untrashThread: (a: string, threadId: string) => api<unknown>(a, `threads/${threadId}/untrash`, COST.trash, { method: "POST" }),
  send: (a: string, raw: string, threadId?: string) =>
    api<{ id: string; threadId: string }>(a, "messages/send", COST.send, { method: "POST", body: JSON.stringify({ raw, threadId }) }),
  attachment: (a: string, messageId: string, id: string) =>
    api<{ data: string; size: number }>(a, `messages/${messageId}/attachments/${id}`, COST.attachment),
};
