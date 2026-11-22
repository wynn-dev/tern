import { expect, test } from "bun:test";
import type { Message, Thread } from "../src/web/lib/api";
import { addressLabel } from "../src/web/lib/format";
import { forwardDraft, readKey } from "../src/web/components/reader";

const msg = (p: Partial<Message> = {}) =>
  ({
    id: "1", account_id: "a", thread_id: "t", internal_date: 1, from_name: "Stripe", from_email: "receipts@stripe.com", to: [], cc: [],
    subject: "Your receipt", snippet: "", text: "Thanks", html: "", labels: [], attachments: [], ...p,
  }) as Message;
const thread = { account_id: "a", thread_id: "t", subject: "Your receipt" } as Thread;

test("recipients without a display name show their full address", () => {
  expect(addressLabel({ name: "", email: "linda.rivera@gmail.com" })).toBe("linda.rivera@gmail.com");
  expect(addressLabel({ name: "Mom", email: "linda.rivera@gmail.com" })).toBe("Mom");
});

test("forwarding a message with attachments says they aren't included", () => {
  const files = [
    { id: "a1", filename: "Receipt-2381-0042.pdf", mimeType: "application/pdf", size: 48213 },
    { id: "a2", filename: "invoice.pdf", mimeType: "application/pdf", size: 1000 },
  ];
  expect(forwardDraft(thread, msg({ attachments: files })).note).toBe("Attachments aren't included: Receipt-2381-0042.pdf, invoice.pdf");
  expect(forwardDraft(thread, msg()).note).toBeUndefined();
});

test("an open thread is marked read again for new mail, not after Mark unread", () => {
  const read = { ...thread, unread: 0 } as Thread;
  const opened = readKey(read, [msg()]);
  expect(readKey({ ...read, unread: 1 }, [msg()])).toBe(opened); // Mark unread
  expect(readKey({ ...read, unread: 1 }, [msg(), msg({ id: "2" })])).not.toBe(opened); // a reply arrives
  expect(readKey({ ...read, thread_id: "t2" }, [msg()])).not.toBe(opened); // another thread
});
