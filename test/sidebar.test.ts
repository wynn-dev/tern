import { expect, test } from "bun:test";
import { emptyCopy } from "../src/web/components/thread-list";
import { nextPref } from "../src/web/hooks/theme";
import type { Counts } from "../src/web/lib/api";
import { scopedCounts, viewUnread } from "../src/web/lib/counts";
import { accountTrouble } from "../src/web/lib/format";

const counts: Counts = {
  accounts: {
    personal: { inboxUnread: 3, needsReply: 1, categories: { personal: 1 } },
    work: { inboxUnread: 5, needsReply: 2, categories: { work: 1, updates: 1 } },
    studio: { inboxUnread: 1, needsReply: 0, categories: { work: 1 } },
  },
  categories: { personal: 1, work: 2, updates: 1 },
};

test("smart-view counts follow the selected account", () => {
  expect(scopedCounts(counts, "personal").categories).toEqual({ personal: 1 });
  expect(scopedCounts(counts, "personal").categories.work).toBeUndefined();
  expect(scopedCounts(counts, "work")).toEqual({ inboxUnread: 5, needsReply: 2, categories: { work: 1, updates: 1 } });
  expect(scopedCounts(counts, null)).toEqual({ inboxUnread: 9, needsReply: 3, categories: { personal: 1, work: 2, updates: 1 } });
  // an account with nothing counted yet, or no counts at all
  expect(scopedCounts(counts, "new")).toEqual({ inboxUnread: 0, needsReply: 0, categories: {} });
  expect(scopedCounts(undefined, null).inboxUnread).toBe(0);
});

test("the list header's unread count is the view's total, not the loaded pages'", () => {
  expect(viewUnread("inbox", scopedCounts(counts, null))).toBe(9);
  expect(viewUnread("category:work", scopedCounts(counts, "studio"))).toBe(1);
  expect(viewUnread("category:finance", scopedCounts(counts, null))).toBe(0);
  expect(viewUnread("sent", scopedCounts(counts, null))).toBeUndefined();
});

test("each view has its own empty copy", () => {
  const titles = ["inbox", "needs-reply", "starred", "sent", "all", "spam", "trash", "category:work", "label:Clients"].map((v) => emptyCopy(v, false).title);
  expect(new Set(titles).size).toBe(titles.length);
  expect(titles).not.toContain("Nothing here");
  expect(emptyCopy("trash", false).title).toBe("Trash is empty");
  expect(emptyCopy("category:work", false).title).toBe("Nothing in Work");
  expect(emptyCopy("starred", true).title).toBe("No matches");
});

test("a revoked Google sign-in reads as a sign-out", () => {
  expect(accountTrouble({ email: "b@gmail.com", error: "Google token error: Token has been expired or revoked." })).toBe("b@gmail.com was signed out");
  expect(accountTrouble({ email: "b@gmail.com", error: "Request had invalid authentication credentials." })).toBe("b@gmail.com was signed out");
  expect(accountTrouble({ email: "b@gmail.com", error: "fetch failed" })).toBe("Couldn't sync b@gmail.com");
});

test("the sidebar's theme button steps through system, light and dark", () => {
  expect([nextPref("system"), nextPref("light"), nextPref("dark")]).toEqual(["light", "dark", "system"]);
});
