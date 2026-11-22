/**
 * A fake Gmail API for one user that enforces Gmail's per-user quota of 15,000 units a minute the way Google does in
 * practice: never more than 15,000 in any minute, and smoothed, so a burst of a few seconds' worth is all it lets
 * through at once (a 1,700-message sync is only 8,500 units, and real Gmail still refuses it when fired at full speed).
 * Refusals carry Google's real error bodies. `minuteMs` shrinks the minute (and the latency with it) for tests; Tern's
 * `quota.minuteMs` must match.
 */
export const PER_MINUTE = 15_000;

const COST: [RegExp, number][] = [
  [/^profile$/, 1], [/^labels$/, 1], [/^history$/, 2], [/^messages$/, 5], [/^messages\/send$/, 100],
  [/^messages\/[^/]+\/modify$/, 5], [/^messages\/[^/]+$/, 5], [/^threads\/[^/]+\/(modify|trash|untrash)$/, 10],
];

/** The body real Gmail sent the person who reported this (429 RESOURCE_EXHAUSTED). */
export const QUOTA_429 = {
  error: {
    code: 429,
    message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com' for consumer 'project_number:123456789012'.",
    errors: [{
      message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com' for consumer 'project_number:123456789012'.",
      domain: "global",
      reason: "rateLimitExceeded",
    }],
    status: "RESOURCE_EXHAUSTED",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "RATE_LIMIT_EXCEEDED",
      domain: "googleapis.com",
      metadata: {
        quota_metric: "gmail.googleapis.com/total_query_cost", quota_limit: "UnitsPerMinutePerUser", quota_limit_value: "15000",
        service: "gmail.googleapis.com", consumer: "projects/123456789012",
      },
    }],
  },
};

/** Gmail's older per-user form, a 403. */
export const QUOTA_403 = {
  error: { errors: [{ domain: "usageLimits", reason: "userRateLimitExceeded", message: "User Rate Limit Exceeded" }], code: 403, message: "User Rate Limit Exceeded" },
};

export class FakeGmail {
  /** Units it let through, with when, for the sliding minute. */
  private spent: [at: number, units: number][] = [];
  private tokens: number;
  private at = Date.now();
  /** Refuse everything until then, as if another app used up the quota. */
  blockedUntil = 0;
  /** Once it has served this many calls, refuse everything for `ms`. */
  blockAfter?: { served: number; ms: number };
  /** Which refusal to send. */
  refusal: "429" | "403" = "429";
  /** Sent with each refusal when set, in seconds. */
  retryAfter?: number;
  served = 0;
  refused = 0;
  /** Calls it served, by path, and when. */
  calls: { path: string; at: number }[] = [];
  readonly inbox: string[];
  readonly spam: string[];

  minuteMs: number;

  constructor(opts: { messages: number; spam?: number; minuteMs?: number }) {
    this.minuteMs = opts.minuteMs ?? 60_000;
    this.inbox = Array.from({ length: opts.messages }, (_, i) => `m${i}`);
    this.spam = Array.from({ length: opts.spam ?? 0 }, (_, i) => `s${i}`);
    this.tokens = this.burst;
  }

  /** About real Gmail's 40 ms a call, on the fake's clock. */
  get latencyMs() {
    return (40 * this.minuteMs) / 60_000;
  }

  /** Five seconds' worth of quota. */
  get burst() {
    return (PER_MINUTE / 60) * 5;
  }

  /** May this call go through now? Spends its units if so. */
  private admit(units: number) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) * PER_MINUTE) / this.minuteMs);
    this.at = now;
    this.spent = this.spent.filter(([t]) => t > now - this.minuteMs);
    const minute = this.spent.reduce((n, [, u]) => n + u, 0);
    if (now < this.blockedUntil || this.tokens < units || minute + units > PER_MINUTE) return false;
    this.tokens -= units;
    this.spent.push([now, units]);
    return true;
  }

  /** The most units let through in any one minute so far. */
  get peakMinute() {
    let peak = 0;
    for (const [t] of this.spent) peak = Math.max(peak, this.spent.filter(([u]) => u >= t && u < t + this.minuteMs).reduce((n, [, x]) => n + x, 0));
    return peak;
  }

  message(id: string) {
    const n = Number(id.slice(1));
    return {
      id, threadId: `t${id}`, labelIds: id.startsWith("s") ? ["SPAM"] : ["INBOX"], snippet: `Message ${id}`, historyId: "100",
      internalDate: String(1_700_000_000_000 + n * 1000),
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "From", value: `Sender ${n} <s${n}@example.com>` }, { name: "Subject", value: `Hello ${id}` }, { name: "Message-ID", value: `<${id}@example.com>` }],
        body: { data: Buffer.from(`Body of ${id}`).toString("base64url") },
      },
    };
  }

  async handle(url: URL, init?: RequestInit): Promise<Response> {
    const path = url.pathname.replace(/^\/gmail\/v1\/users\/me\//, "");
    const units = COST.find(([re]) => re.test(path))?.[1] ?? 5;
    await Bun.sleep(this.latencyMs);
    if (!this.admit(units)) {
      this.refused++;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.retryAfter !== undefined) headers["retry-after"] = String(this.retryAfter);
      return new Response(JSON.stringify(this.refusal === "429" ? QUOTA_429 : QUOTA_403), { status: Number(this.refusal), headers });
    }
    this.served++;
    if (this.blockAfter && this.served >= this.blockAfter.served) {
      this.blockedUntil = Date.now() + this.blockAfter.ms;
      this.blockAfter = undefined;
    }
    this.calls.push({ path, at: Date.now() });
    const json = (body: unknown) => Response.json(body);
    if (path === "profile") return json({ emailAddress: "me@example.com", historyId: "100", messagesTotal: this.inbox.length });
    if (path === "labels") return json({ labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "SPAM", name: "SPAM", type: "system" }] });
    if (path === "messages") {
      const ids = url.searchParams.getAll("labelIds").includes("SPAM") ? this.spam : this.inbox;
      const max = Number(url.searchParams.get("maxResults") ?? 100);
      const from = Number(url.searchParams.get("pageToken") ?? 0);
      const page = ids.slice(from, from + max);
      return json({ messages: page.map((id) => ({ id, threadId: `t${id}` })), nextPageToken: from + max < ids.length ? String(from + max) : undefined });
    }
    const modify = /^threads\/([^/]+)\/modify$/.exec(path);
    if (modify) return json({ id: modify[1], messages: [] });
    const get = /^messages\/([^/]+)$/.exec(path);
    if (get && init?.method !== "POST") {
      const id = get[1];
      return this.inbox.includes(id) || this.spam.includes(id) ? json(this.message(id)) : new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify({ error: { code: 404, message: `fake Gmail has no ${path}` } }), { status: 404 });
  }

  /** Route Tern's calls to gmail.googleapis.com here; returns a function that puts fetch back. */
  install() {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.hostname === "gmail.googleapis.com" ? this.handle(url, init) : real(input, init);
    }) as typeof fetch;
    return () => void (globalThis.fetch = real);
  }
}
