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

test("switching to reply all on the reply you're writing adds its Cc and keeps your text", () => {
  s().openCompose(reply);
  type({ text: "Thursday works" });
  s().openCompose({ ...reply, cc: "dana@x.io, lee@x.io" });
  expect(asked).toBe(0);
  expect(liveDraft()).toMatchObject({ id: s().compose!.id, to: "priya@x.io", cc: "dana@x.io, lee@x.io", text: "Thursday works" });
  // still a draft with edits, so it isn't dropped without asking
  expect(s().discardCompose()).toBe(false);

  s().openCompose(reply);
  expect(liveDraft()).toMatchObject({ cc: "", text: "Thursday works" });
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

test("an AI-drafted reply counts as edited: X, Esc or another compose asks first", () => {
  s().openCompose({ ...reply, text: "Thursday works for me.", generated: true });
  expect(s().discardCompose()).toBe(false);
  expect(asked).toBe(1);
  expect(s().compose).not.toBeNull();

  s().openCompose();
  expect(asked).toBe(2);
  expect(liveDraft()!.text).toBe("Thursday works for me.");
  // r on the same thread brings it back rather than asking
  s().openCompose(reply);
  expect(asked).toBe(2);
  expect(liveDraft()!.text).toBe("Thursday works for me.");
});
