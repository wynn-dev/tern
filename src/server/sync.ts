import { loadConfig } from "./config";
import {
  deleteMessage, getAccount, hasMessage, listAccounts, replaceLabels, setMessageLabels, updateAccount, upsertMessages,
} from "./db";
import { events } from "./events";
import { gmail, GmailError, inBackground } from "./gmail";
import { fromGmail } from "./mime";

export const CATCHING_UP = "Gmail is rate-limiting Tern, catching up";

const running = new Map<string, Promise<void>>();
let onSynced: (() => void) | undefined;

/** Run `fn` over `items` with at most `n` in flight; after a failure, start no more and throw once the rest settle. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  let failed = false;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length && !failed) await fn(items[i++]).catch((e) => {
      failed = true;
      throw e;
    });
  }));
  const err = workers.find((w) => w.status === "rejected");
  if (err) throw err.reason;
}

async function fetchAndStore(accountId: string, ids: string[], progress?: (done: number) => void) {
  let batch: ReturnType<typeof fromGmail>[] = [];
  let done = 0;
  const flush = () => {
    const keys = upsertMessages(batch);
    batch = [];
    if (keys?.length) events.emit({ type: "threads", keys });
  };
  try {
    await pool(ids, 8, async (id) => {
      try {
        // fetch first: `batch.push(await …)` would push into the batch another worker flushed meanwhile
        const m = await gmail.get(accountId, id);
        batch.push(fromGmail(accountId, m));
      } catch (e) {
        if (!(e instanceof GmailError && e.status === 404)) throw e;
      }
      progress?.(++done);
      if (batch.length >= 40) flush();
    });
  } finally {
    // keep what came in before a failure: the next sync skips it
    flush();
  }
}

async function fullSync(accountId: string) {
  const cfg = loadConfig();
  const profile = await gmail.profile(accountId);
  replaceLabels(accountId, (await gmail.labels(accountId)).labels);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail.list(accountId, { q: `newer_than:${cfg.sync.initialDays}d -in:chats`, pageToken });
    ids.push(...(page.messages ?? []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < cfg.sync.maxInitial);
  // Gmail leaves spam out of listings; pull in the recent part of it, apart so it can't crowd out real mail
  const spam = await gmail.list(accountId, { labelIds: ["SPAM"], includeSpamTrash: true, maxResults: 200 });
  ids.splice(cfg.sync.maxInitial, Infinity, ...(spam.messages ?? []).map((m) => m.id));
  const missing = ids.filter((id) => !hasMessage(accountId, id));
  await fetchAndStore(accountId, missing, (done) => {
    if (done % 20 === 0 || done === missing.length)
      events.emit({ type: "sync", accountId, status: "syncing", progress: missing.length ? done / missing.length : 1 });
  });
  updateAccount(accountId, { history_id: profile.historyId });
}

async function incrementalSync(accountId: string, startHistoryId: string) {
  const added = new Set<string>();
  const relabel = new Set<string>();
  let latest = startHistoryId;
  let pageToken: string | undefined;
  do {
    const page = await gmail.history(accountId, startHistoryId, pageToken);
    latest = page.historyId;
    for (const h of page.history ?? []) {
      for (const m of h.messagesAdded ?? []) added.add(m.message.id);
      for (const m of [...(h.labelsAdded ?? []), ...(h.labelsRemoved ?? [])]) relabel.add(m.message.id);
      for (const m of h.messagesDeleted ?? []) {
        added.delete(m.message.id);
        relabel.delete(m.message.id);
        const t = deleteMessage(accountId, m.message.id);
        if (t) events.emit({ type: "threads", keys: [[accountId, t]] });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  const fetch = [...added].filter((id) => !hasMessage(accountId, id));
  await fetchAndStore(accountId, fetch);
  // label changes on messages we already have only need their label ids
  const changed = [...relabel].filter((id) => !fetch.includes(id) && hasMessage(accountId, id));
  const keys: [string, string][] = [];
  await pool(changed, 8, async (id) => {
    try {
      const m = await gmail.get(accountId, id);
      const t = setMessageLabels(accountId, id, m.labelIds ?? []);
      if (t) keys.push([accountId, t]);
    } catch (e) {
      if (!(e instanceof GmailError && e.status === 404)) throw e;
    }
  });
  if (keys.length) events.emit({ type: "threads", keys });
  updateAccount(accountId, { history_id: latest });
}

export function syncAccount(accountId: string): Promise<void> {
  const existing = running.get(accountId);
  if (existing) return existing;
  const p = (async () => {
    const acc = getAccount(accountId);
    if (!acc?.token) return;
    const first = !acc.history_id;
    if (first) {
      updateAccount(accountId, { status: "syncing", error: null });
      events.emit({ type: "sync", accountId, status: "syncing", progress: 0 });
    }
    // Gmail pushing back isn't a failure: say so plainly while the limiter waits it out
    const limited = () => {
      if (getAccount(accountId)?.status === "limited") return;
      updateAccount(accountId, { status: "limited", error: CATCHING_UP });
      events.emit({ type: "account", accountId });
    };
    try {
      await inBackground(async () => {
        if (acc.history_id) {
          try {
            await incrementalSync(accountId, acc.history_id);
          } catch (e) {
            // history ids expire after about a week; start over
            if (e instanceof GmailError && e.status === 404) await fullSync(accountId);
            else throw e;
          }
        } else await fullSync(accountId);
      }, limited);
      updateAccount(accountId, { status: "idle", error: null });
      if (first) events.emit({ type: "sync", accountId, status: "idle", progress: 1 });
      onSynced?.();
    } catch (e) {
      if (e instanceof GmailError && e.rateLimited) {
        // what's stored stays; the next tick picks up where this left off
        console.error(`[sync] ${acc.email}: ${CATCHING_UP}`);
        limited();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[sync] ${acc.email}: ${msg}`);
      updateAccount(accountId, { status: "error", error: msg });
      events.emit({ type: "sync", accountId, status: "error" });
    } finally {
      running.delete(accountId);
      events.emit({ type: "account", accountId });
    }
  })();
  running.set(accountId, p);
  return p;
}

export function startSyncLoop(afterSync: () => void) {
  onSynced = afterSync;
  const tick = () => {
    for (const a of listAccounts()) if (a.token) void syncAccount(a.id);
  };
  tick();
  return setInterval(tick, loadConfig().sync.intervalSec * 1000);
}
