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
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function api<T>(accountId: string, path: string, init?: RequestInit & { query?: Record<string, string | string[] | undefined> }): Promise<T> {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) url.searchParams.append(k, one);
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${await accessToken(accountId)}`, "content-type": "application/json", ...init?.headers },
    });
    if (res.ok) return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    // back off on rate limits and transient errors
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await Bun.sleep(500 * 2 ** attempt + Math.random() * 250);
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as any;
    throw new GmailError(res.status, body?.error?.message ?? `Gmail ${res.status}`);
  }
}

export const gmail = {
  profile: (a: string) => api<{ emailAddress: string; historyId: string; messagesTotal: number }>(a, "profile"),
  labels: (a: string) => api<{ labels: { id: string; name: string; type: string }[] }>(a, "labels"),
  list: (a: string, q: { q?: string; pageToken?: string; maxResults?: number; labelIds?: string[]; includeSpamTrash?: boolean }) =>
    api<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(a, "messages", {
      query: {
        q: q.q, pageToken: q.pageToken, maxResults: String(q.maxResults ?? 500), labelIds: q.labelIds,
        includeSpamTrash: q.includeSpamTrash ? "true" : undefined,
      },
    }),
  get: (a: string, id: string) => api<GmailMessage>(a, `messages/${id}`, { query: { format: "full" } }),
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
    }>(a, "history", { query: { startHistoryId, pageToken, maxResults: "500" } }),
  modifyThread: (a: string, threadId: string, add: string[], remove: string[]) =>
    api<{ messages: { id: string; labelIds: string[] }[] }>(a, `threads/${threadId}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    }),
  modifyMessage: (a: string, id: string, add: string[], remove: string[]) =>
    api<{ id: string; labelIds: string[] }>(a, `messages/${id}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    }),
  trashThread:(a: string, threadId: string) => api<unknown>(a, `threads/${threadId}/trash`, { method: "POST" }),
  untrashThread: (a: string, threadId: string) => api<unknown>(a, `threads/${threadId}/untrash`, { method: "POST" }),
  send: (a: string, raw: string, threadId?: string) =>
    api<{ id: string; threadId: string }>(a, "messages/send", { method: "POST", body: JSON.stringify({ raw, threadId }) }),
  attachment: (a: string, messageId: string, id: string) =>
    api<{ data: string; size: number }>(a, `messages/${messageId}/attachments/${id}`),
};
