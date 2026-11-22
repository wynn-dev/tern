import { beforeEach, expect, test } from "bun:test";
import { editCompose, liveDraft, useStore } from "../src/web/lib/store";

let asked = 0;
let answer = false;
globalThis.confirm = () => (asked++, answer);

const s = () => useStore.getState();
const type = (p: { text?: string; to?: string }) => editCompose({ ...liveDraft()!, ...p });
const reply = { mode: "reply" as const, accountId: "work", threadId: "t1", to: "priya@x.io", subject: "Re: Roadmap", quoted: "\n\n> hi" };

beforeEach(() => {
  s().closeCompose();
  asked = 0;
  answer = false;
});

test("opening another compose keeps a draft with text unless you say to discard it", () => {
  s().openCompose(reply);
  const id = s().compose!.id;
  type({ text: "Half a reply" });

  s().openCompose();
  expect(asked).toBe(1);
  expect(s().compose!.id).toBe(id);
  expect(liveDraft()!.text).toBe("Half a reply");

  answer = true;
  s().openCompose();
  expect(asked).toBe(2);
  expect(s().compose!.mode).toBe("new");
});

test("opening a compose over an untouched draft doesn't ask", () => {
  s().openCompose(reply);
  s().openCompose({ mode: "forward", to: "", subject: "Fwd: Roadmap", text: "\n\n---------- Forwarded message ----------\nhi" });
  // an unedited forward isn't a draft yet, though its body has the forwarded text
  s().openCompose();
  expect(asked).toBe(0);
  expect(s().compose!.mode).toBe("new");
});

test("replying again to the thread you're answering brings the reply back", () => {
  s().openCompose(reply);
  const id = s().compose!.id;
  type({ text: "Thursday works" });
  s().minimizeCompose(true);
  s().openCompose(reply);
  expect(asked).toBe(0);
  expect(s().compose!.id).toBe(id);
  expect(s().composeMinimized).toBe(false);
});

test("closing asks first only when the draft has edits", () => {
  s().openCompose();
  expect(s().discardCompose()).toBe(true);
  expect(asked).toBe(0);

  s().openCompose();
  type({ to: "ada@x.io" });
  expect(s().discardCompose()).toBe(false);
  expect(s().compose).not.toBeNull();
  answer = true;
  expect(s().discardCompose()).toBe(true);
  expect(s().compose).toBeNull();
  expect(asked).toBe(2);
});
