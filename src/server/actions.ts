import { getAccount, getThread, setMessageLabels, threadMessages, upsertMessages } from "./db";
import { events } from "./events";
import { gmail } from "./gmail";
import { buildRaw, fromGmail, invalidAddresses, parseAddressList, type Outgoing } from "./mime";

export const ACTIONS = ["archive", "inbox", "star", "unstar", "read", "unread", "trash", "untrash", "spam", "notspam"] as const;
export type Action = (typeof ACTIONS)[number];

const labelChange: Record<Action, [add: string[], remove: string[]]> = {
  archive: [[], ["INBOX"]],
  inbox: [["INBOX"], []],
  star: [["STARRED"], []],
  unstar: [[], ["STARRED"]],
  read: [[], ["UNREAD"]],
  unread: [["UNREAD"], []],
  trash: [["TRASH"], ["INBOX"]],
  untrash: [["INBOX"], ["TRASH"]],
  spam: [["SPAM"], ["INBOX"]],
  notspam: [["INBOX"], ["SPAM"]],
};

/**
 * Apply locally first so the UI never waits on Google, then on Gmail;
 * if Gmail refuses, put the labels back.
 */
export async function applyAction(accountId: string, threadId: string, action: Action, demo: boolean) {
  const before = threadMessages(accountId, threadId);
  // "Move to inbox" on a trashed or spam thread takes it out of there, or it stays stuck in Trash
  if (action === "inbox" && before.some((m) => m.labels.includes("TRASH"))) action = "untrash";
  else if (action === "inbox" && before.some((m) => m.labels.includes("SPAM"))) action = "notspam";
  const [add, remove] = labelChange[action];
  // Gmail stars messages, not threads: star the latest one, unstar every one (a thread is starred while any message is)
  const touched = action === "star" ? before.slice(-1) : before;
  for (const m of touched) {
    const next = new Set(m.labels);
    add.forEach((l) => next.add(l));
    remove.forEach((l) => next.delete(l));
    setMessageLabels(accountId, m.id, [...next]);
  }
  events.emit({ type: "threads", keys: [[accountId, threadId]] });
  if (demo) return;
  try {
    if (action === "trash") await gmail.trashThread(accountId, threadId);
    else if (action === "untrash") await gmail.untrashThread(accountId, threadId);
    else if (action === "star") {
      const last = before.at(-1);
      if (last) await gmail.modifyMessage(accountId, last.id, add, remove);
    } else await gmail.modifyThread(accountId, threadId, add, remove);
  } catch (e) {
    for (const m of before) setMessageLabels(accountId, m.id, m.labels);
    events.emit({ type: "threads", keys: [[accountId, threadId]] });
    throw e;
  }
}

/** A send the server refuses as asked, answered with a 400 and its message. */
export class SendError extends Error {}

export type SendInput = {
  accountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  threadId?: string;
};

export async function send(input: SendInput, demo: boolean) {
  const acc = getAccount(input.accountId);
  if (!acc) throw new Error("No such account");
  for (const field of ["to", "cc", "bcc"] as const) {
    const bad = invalidAddresses(input[field]);
    if (bad.length) throw new SendError(`${bad.map((b) => `“${b}”`).join(", ")} ${bad.length > 1 ? "aren't email addresses" : "isn't an email address"}`);
  }
  let inReplyTo: string | undefined, references: string | undefined;
  if (input.threadId) {
    const t = getThread(input.accountId, input.threadId);
    if (!t) throw new SendError(`This conversation isn't in ${acc.email}, so the reply can't be sent from it`);
    const last = t.messages.at(-1);
    inReplyTo = last?.message_id || undefined;
    references = last?.references || undefined;
  }
  const out: Outgoing = {
    from: { name: acc.name, email: acc.email },
    to: parseAddressList(input.to),
    cc: parseAddressList(input.cc),
    bcc: parseAddressList(input.bcc),
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo,
    references,
  };
  if (!out.to.length) throw new SendError("Add at least one recipient");
  if (demo) {
    const id = `demo-sent-${Date.now()}`;
    const keys = upsertMessages([{
      id, account_id: acc.id, thread_id: input.threadId ?? id, internal_date: Date.now(), from_name: acc.name, from_email: acc.email,
      to: out.to, cc: out.cc ?? [], subject: out.subject, snippet: out.text.slice(0, 140), text: out.text, html: "",
      labels: ["SENT"], message_id: `<${id}@tern.local>`, references: "", attachments: [],
    }]);
    if (keys) events.emit({ type: "threads", keys });
    return { id, threadId: input.threadId ?? id };
  }
  const sent = await gmail.send(acc.id, buildRaw(out), input.threadId);
  const full = await gmail.get(acc.id, sent.id);
  const keys = upsertMessages([fromGmail(acc.id, full)]);
  if (keys) events.emit({ type: "threads", keys });
  return sent;
}
