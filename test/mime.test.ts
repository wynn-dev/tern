import { expect, test } from "bun:test";
import { b64url, buildRaw, fromGmail, invalidAddresses, parseAddressList } from "../src/server/mime";

test("parses address lists with quotes and commas", () => {
  expect(parseAddressList(`"Lovelace, Ada" <Ada@Example.com>, bob@example.com`)).toEqual([
    { name: "Lovelace, Ada", email: "ada@example.com" },
    { name: "", email: "bob@example.com" },
  ]);
});

test("splits address lists on semicolons too", () => {
  expect(parseAddressList("a@b.com; c@d.com;")).toEqual([
    { name: "", email: "a@b.com" },
    { name: "", email: "c@d.com" },
  ]);
  expect(parseAddressList(`"Lee; Jordan" <jo@x.io>`)).toEqual([{ name: "Lee; Jordan", email: "jo@x.io" }]);
});

test("names the entries that aren't email addresses", () => {
  expect(invalidAddresses(`"Lovelace, Ada" <ada@example.com>, bob@example.co.uk; c@d.io`)).toEqual([]);
  expect(invalidAddresses("")).toEqual([]);
  expect(invalidAddresses("not-an-address")).toEqual(["not-an-address"]);
  expect(invalidAddresses("ada@example.com, bob, Carol <carol@>, dan@localhost, e f@x.io")).toEqual(["bob", "Carol <carol@>", "dan@localhost", "e f@x.io"]);
});

test("reads text, html and attachments from a Gmail payload", () => {
  const m = fromGmail("acc", {
    id: "m1", threadId: "t1", labelIds: ["INBOX", "UNREAD"], snippet: "Hi &amp; bye", internalDate: "1700000000000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Priya <priya@x.io>" },
        { name: "To", value: "sam@x.io" },
        { name: "Subject", value: "Roadmap" },
        { name: "Message-ID", value: "<abc@x.io>" },
      ],
      parts: [
        { mimeType: "multipart/alternative", parts: [
          { mimeType: "text/plain", body: { data: b64url.encode("Hello there") } },
          { mimeType: "text/html", body: { data: b64url.encode("<p>Hello <b>there</b></p>") } },
        ] },
        { mimeType: "application/pdf", filename: "deck.pdf", partId: "2", body: { attachmentId: "att1", size: 1234 } },
      ],
    },
  });
  expect(m.from_name).toBe("Priya");
  expect(m.text).toBe("Hello there");
  expect(m.html).toContain("<b>there</b>");
  expect(m.snippet).toBe("Hi & bye");
  expect(m.attachments).toEqual([{ id: "att1", filename: "deck.pdf", mimeType: "application/pdf", size: 1234 }]);
  expect(m.message_id).toBe("<abc@x.io>");
});

test("builds a threaded reply with encoded headers", () => {
  const raw = Buffer.from(
    buildRaw({
      from: { name: "Sam Rivera", email: "sam@x.io" }, to: [{ name: "", email: "priya@x.io" }], subject: "Re: Café ☕",
      text: "Sounds good", inReplyTo: "<abc@x.io>",
    }),
    "base64url",
  ).toString();
  expect(raw).toContain("To: priya@x.io");
  expect(raw).toContain("Subject: =?UTF-8?B?");
  expect(raw).toContain("In-Reply-To: <abc@x.io>");
  expect(raw).toContain("References: <abc@x.io>");
  expect(raw).not.toContain("Cc:");
  const [head] = raw.split("\r\n\r\n");
  expect(head.split("\r\n").every((l) => /^[\w-]+: /.test(l))).toBe(true);
});
