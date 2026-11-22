import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { ACTIONS, applyAction, send, type Action } from "./actions";
import { AiError, aiStatus, classifyPending, draftReply, summarizeThread } from "./ai";
import { loadConfig, saveConfig, type Config } from "./config";
import { randomId, sign, verify } from "./crypto";
import * as db from "./db";
import { events } from "./events";
import { authUrl, exchangeCode, gmail, redirectUri } from "./gmail";
import { syncAccount } from "./sync";

export type AppOptions = { demo: boolean; assets?: Record<string, string> };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

const pendingOAuth = new Map<string, number>();

export function createApp(opts: AppOptions) {
  const app = new Hono();

  // ---------- auth ----------
  const authed = (c: Context) => {
    const cfg = loadConfig();
    if (!cfg.passwordHash) return true;
    const sid = verify(getCookie(c, "tern_session"));
    return !!sid && db.hasSession(sid);
  };

  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.header("x-tern") !== "1") return c.json({ error: "Missing X-Tern header" }, 403);
    if (c.req.path === "/api/login" || c.req.path === "/api/session") return next();
    if (!authed(c)) return c.json({ error: "Sign in first" }, 401);
    return next();
  });

  app.get("/api/session", (c) => c.json({ authed: authed(c), passwordRequired: !!loadConfig().passwordHash, demo: opts.demo }));

  app.post("/api/login", async (c) => {
    const { password } = await c.req.json<{ password: string }>();
    const hash = loadConfig().passwordHash;
    if (!hash || !(await Bun.password.verify(password ?? "", hash))) {
      await Bun.sleep(400);
      return c.json({ error: "Wrong password" }, 401);
    }
    const sid = randomId();
    db.createSession(sid);
    setCookie(c, "tern_session", sign(sid), { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 30 * 86400, secure: c.req.url.startsWith("https") });
    return c.json({ ok: true });
  });

  app.post("/api/logout", (c) => {
    const sid = verify(getCookie(c, "tern_session"));
    if (sid) db.deleteSession(sid);
    deleteCookie(c, "tern_session", { path: "/" });
    return c.json({ ok: true });
  });

  // ---------- accounts ----------
  const publicAccount = (a: db.Account) => ({
    id: a.id, email: a.email, name: a.name, color: a.color, status: a.status, error: a.error, connected: !!a.token || opts.demo,
  });

  app.get("/api/accounts", (c) => c.json({ accounts: db.listAccounts().map(publicAccount), counts: db.counts(), labels: db.userLabels() }));

  app.post("/api/accounts/connect", (c) => {
    if (opts.demo) return c.json({ error: "Connecting accounts is off in the demo" }, 400);
    const state = randomId();
    pendingOAuth.set(state, Date.now());
    return c.json({ url: authUrl(state), redirectUri: redirectUri() });
  });

  async function completeOAuth(code: string | null, state: string | null) {
    const started = state ? pendingOAuth.get(state) : undefined;
    if (!code || !state || !started || Date.now() - started > 15 * 60_000) throw new Error("This sign-in link expired. Start again.");
    pendingOAuth.delete(state);
    const { email, name, token } = await exchangeCode(code);
    const acc = db.upsertAccount({ id: randomId(8), email, name, token });
    events.emit({ type: "account", accountId: acc.id });
    void syncAccount(acc.id);
    return acc;
  }

  app.get("/oauth/callback", async (c) => {
    try {
      if (!authed(c)) return c.redirect("/?error=" + encodeURIComponent("Sign in to Tern, then connect again."));
      const acc = await completeOAuth(c.req.query("code") ?? null, c.req.query("state") ?? null);
      return c.redirect(`/?connected=${encodeURIComponent(acc.email)}`);
    } catch (e) {
      return c.redirect(`/?error=${encodeURIComponent((e as Error).message)}`);
    }
  });

  // for setups where Google can't redirect back to Tern (remote server, no https): paste the URL
  app.post("/api/accounts/complete", async (c) => {
    const { url } = await c.req.json<{ url: string }>();
    const u = new URL(url);
    const acc = await completeOAuth(u.searchParams.get("code"), u.searchParams.get("state"));
    return c.json({ account: publicAccount(acc) });
  });

  app.patch("/api/accounts/:id", async (c) => {
    const body = await c.req.json<{ name?: string; color?: string }>();
    db.updateAccount(c.req.param("id"), { ...(body.name !== undefined && { name: body.name }), ...(body.color && { color: body.color }) });
    events.emit({ type: "account", accountId: c.req.param("id") });
    return c.json({ ok: true });
  });

  app.delete("/api/accounts/:id", (c) => {
    db.deleteAccount(c.req.param("id"));
    events.emit({ type: "account", accountId: c.req.param("id") });
    return c.json({ ok: true });
  });

  app.post("/api/accounts/:id/sync", (c) => {
    if (!opts.demo) void syncAccount(c.req.param("id"));
    return c.json({ ok: true });
  });

  // ---------- threads ----------
  app.get("/api/threads", (c) => {
    const q = c.req.query();
    const limit = Math.min(Number(q.limit ?? 60), 200);
    const threads = db.queryThreads({ view: q.view ?? "inbox", account: q.account || undefined, q: q.q || undefined, cursor: q.cursor || undefined, limit });
    return c.json({ threads, next: threads.length === limit ? db.threadCursor(threads.at(-1)!) : null });
  });

  app.get("/api/threads/:account/:thread", (c) => {
    const t = db.getThread(c.req.param("account"), c.req.param("thread"));
    return t ? c.json(t) : c.json({ error: "Not found" }, 404);
  });

  app.post("/api/threads/:account/:thread/:action", async (c) => {
    const action = c.req.param("action") as Action;
    if (!ACTIONS.includes(action)) return c.json({ error: "Unknown action" }, 400);
    await applyAction(c.req.param("account"), c.req.param("thread"), action, opts.demo);
    return c.json({ ok: true });
  });

  app.get("/api/attachments/:account/:message/:id", async (c) => {
    if (opts.demo) return c.text("Attachments aren't available in the demo", 404);
    const { data } = await gmail.attachment(c.req.param("account"), c.req.param("message"), c.req.param("id"));
    const name = c.req.query("name") ?? "attachment";
    return new Response(Buffer.from(data, "base64url"), {
      headers: {
        "content-type": c.req.query("type") ?? "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.post("/api/send", async (c) => c.json(await send(await c.req.json(), opts.demo)));

  // ---------- AI ----------
  app.get("/api/ai/status", (c) => c.json(aiStatus()));
  app.post("/api/ai/summarize", async (c) => {
    const { accountId, threadId } = await c.req.json<{ accountId: string; threadId: string }>();
    return c.json(await summarizeThread(accountId, threadId));
  });
  app.post("/api/ai/draft", async (c) => {
    const { accountId, threadId, instruction } = await c.req.json<{ accountId: string; threadId: string; instruction?: string }>();
    return c.json(await draftReply(accountId, threadId, instruction ?? ""));
  });
  app.post("/api/ai/classify", (c) => {
    if (!loadConfig().ai.enabled) return c.json({ error: "AI is turned off in Settings.", code: "off" }, 409);
    void classifyPending();
    return c.json({ ok: true });
  });

  // ---------- settings ----------
  app.get("/api/settings", (c) => {
    const cfg = loadConfig();
    return c.json({
      google: { configured: !!cfg.google?.clientId, clientId: cfg.google?.clientId ?? "" },
      redirectUri: redirectUri(),
      ai: cfg.ai,
      sync: cfg.sync,
    });
  });

  app.put("/api/settings", async (c) => {
    const body = await c.req.json<{ google?: { clientId: string; clientSecret: string }; ai?: Partial<Config["ai"]> }>();
    const cfg = loadConfig();
    if (body.google?.clientId) cfg.google = { clientId: body.google.clientId.trim(), clientSecret: body.google.clientSecret?.trim() || cfg.google?.clientSecret || "" };
    if (body.ai) cfg.ai = { ...cfg.ai, ...body.ai };
    saveConfig(cfg);
    return c.json({ ok: true });
  });

  // ---------- live updates ----------
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const off = events.on((e) => void stream.writeSSE({ data: JSON.stringify(e) }));
      // a first write flushes the response, so the browser sees the (re)connection right away
      void stream.writeSSE({ event: "ping", data: "" });
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
      stream.onAbort(() => {
        off();
        clearInterval(ping);
      });
      await new Promise(() => {});
    }),
  );

  app.onError((err, c) => {
    if (err instanceof AiError) return c.json({ error: err.message, code: err.code }, err.httpStatus);
    console.error(`[api] ${c.req.method} ${c.req.path}:`, err.message);
    return c.json({ error: err.message }, 500);
  });

  // ---------- web app ----------
  const diskRoot = resolve(import.meta.dir, "../../dist/web");
  app.get("*", async (c) => {
    const path = c.req.path === "/" ? "/index.html" : c.req.path;
    const embedded = opts.assets?.[path] ?? opts.assets?.["/index.html"];
    let file = embedded ? Bun.file(embedded) : null;
    if (!file) {
      const p = join(diskRoot, path);
      file = Bun.file(p.startsWith(diskRoot) && existsSync(p) ? p : join(diskRoot, "index.html"));
    }
    if (!(await file.exists())) return c.text("Web UI not built. Run `bun run build:web`.", 500);
    const served = opts.assets?.[path] || existsSync(join(diskRoot, path)) ? path : "/index.html";
    return new Response(file, {
      headers: {
        "content-type": MIME[extname(served)] ?? "application/octet-stream",
        "cache-control": served.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  });

  return app;
}
