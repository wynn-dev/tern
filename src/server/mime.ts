import type { Address, Attachment, Message } from "./db";

export type GmailPart = {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
};

const MAX_TEXT = 200_000;
const MAX_HTML = 1_000_000;

export const b64url = {
  decode: (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
  encode: (s: string) => Buffer.from(s, "utf8").toString("base64url"),
};

/** Parse `"Ada Lovelace" <ada@example.com>, bob@example.com` into addresses; `;` separates them too. */
export function parseAddressList(v: string | undefined): Address[] {
  return splitAddressList(v).map(parseAddress).filter((a) => a.email);
}

/** The entries of a typed address list that aren't an email address, as typed. */
export function invalidAddresses(v: string | undefined): string[] {
  return splitAddressList(v).filter((s) => !EMAIL.test(parseAddress(s).email)).map((s) => s.trim());
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:".]+(\.[^\s@<>()[\]\\,;:".]+)+$/;

function splitAddressList(v: string | undefined): string[] {
  if (!v) return [];
  const out: string[] = [];
  // split on commas and semicolons that are not inside quotes or angle brackets
  let depth = 0, quote = false, cur = "";
  for (const ch of v) {
    if (ch === '"') quote = !quote;
    else if (!quote && ch === "<") depth++;
    else if (!quote && ch === ">") depth--;
    if ((ch === "," || ch === ";") && !quote && depth === 0) {
      if (cur.trim()) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseAddress(s: string): Address {
  s = s.trim();
  const m = s.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").replace(/\\"/g, '"').trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.replace(/^<|>$/g, "").toLowerCase() };
}

const header = (p: GmailPart | undefined, name: string) =>
  p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

function walk(part: GmailPart, acc: { text: string[]; html: string[]; attachments: Attachment[] }) {
  const disposition = header(part, "Content-Disposition").toLowerCase();
  if (part.filename && (part.body?.attachmentId || disposition.startsWith("attachment"))) {
    acc.attachments.push({
      id: part.body?.attachmentId ?? part.partId ?? "",
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body?.size ?? 0,
    });
    return;
  }
  if (part.mimeType === "text/plain" && part.body?.data) acc.text.push(b64url.decode(part.body.data));
  else if (part.mimeType === "text/html" && part.body?.data) acc.html.push(b64url.decode(part.body.data));
  for (const p of part.parts ?? []) walk(p, acc);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const decodeEntities = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function fromGmail(accountId: string, g: GmailMessage): Message {
  const acc = { text: [] as string[], html: [] as string[], attachments: [] as Attachment[] };
  if (g.payload) walk(g.payload, acc);
  const html = acc.html.join("\n").slice(0, MAX_HTML);
  const text = (acc.text.length ? acc.text.join("\n") : htmlToText(html)).slice(0, MAX_TEXT);
  const from = parseAddressList(header(g.payload, "From"))[0] ?? { name: "", email: "" };
  return {
    id: g.id,
    account_id: accountId,
    thread_id: g.threadId,
    internal_date: Number(g.internalDate ?? Date.now()),
    from_name: from.name,
    from_email: from.email,
    to: parseAddressList(header(g.payload, "To")),
    cc: parseAddressList(header(g.payload, "Cc")),
    subject: header(g.payload, "Subject"),
    snippet: decodeEntities(g.snippet ?? ""),
    text,
    html,
    labels: g.labelIds ?? [],
    message_id: header(g.payload, "Message-ID") || header(g.payload, "Message-Id"),
    references: header(g.payload, "References"),
    attachments: acc.attachments,
  };
}

const formatAddress = (a: Address) => (a.name ? `${encodeWord(a.name)} <${a.email}>` : a.email);

/** RFC 2047 encode a header value when it isn't plain ASCII. */
function encodeWord(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? (/[",<>@]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s) : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
}

export type Outgoing = {
  from: Address;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
};

export function buildRaw(m: Outgoing): string {
  const boundary = `tern_${crypto.randomUUID()}`;
  const headers = [
    `From: ${formatAddress(m.from)}`,
    `To: ${m.to.map(formatAddress).join(", ")}`,
    m.cc?.length && `Cc: ${m.cc.map(formatAddress).join(", ")}`,
    m.bcc?.length && `Bcc: ${m.bcc.map(formatAddress).join(", ")}`,
    `Subject: ${encodeWord(m.subject)}`,
    m.inReplyTo && `In-Reply-To: ${m.inReplyTo}`,
    (m.references || m.inReplyTo) && `References: ${[m.references, m.inReplyTo].filter(Boolean).join(" ")}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter((h): h is string => typeof h === "string");
  const lines = [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(m.text).toString("base64")),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(m.html ?? textToHtml(m.text)).toString("base64")),
    `--${boundary}--`,
    "",
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

const wrap = (s: string) => s.replace(/.{76}/g, "$&\r\n");

export function textToHtml(text: string) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 14px; line-height: 1.5">${esc
    .split(/\n{2,}/)
    .map((p) => `<p style="margin: 0 0 1em">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}
