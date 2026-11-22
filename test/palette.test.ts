import { expect, test } from "bun:test";
import { paletteFilter, SEARCH_ITEM } from "../src/web/components/command-palette";
import { forgetAccount } from "../src/web/components/settings";
import { useStore } from "../src/web/lib/store";

// the palette's items as cmdk sees them: their value (or text) and keywords
const ITEMS: [string, string[]?][] = [
  ["New message C"], ["Check for new mail"], ["Add a Gmail account"], ["Settings ,"], ["Keyboard shortcuts ?"],
  ["Light theme", ["light mode"]], ["Dark theme", ["dark mode", "toggle dark mode"]], ["System theme", ["match system", "automatic"]],
  ["go Inbox"], ["go Needs reply"], ["go Starred"], ["go Sent"], ["go All mail"], ["go Spam"], ["go Trash"],
  ["go smart Work"], ["go smart Finance"], ["go label Clients"], ["account all"], ["account sam.rivera@gmail.com"],
];
/** What Enter runs: the best-scoring item, as cmdk sorts them. */
const top = (search: string) =>
  [[SEARCH_ITEM] as [string, string[]?], ...ITEMS]
    .map(([v, k]) => [paletteFilter(v, search, k), v] as const)
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0])[0][1];

test("a command's name runs the command, not a mail search", () => {
  expect(top("settings")).toBe("Settings ,");
  expect(top("dark")).toBe("Dark theme");
  expect(top("inbox")).toBe("go Inbox");
  expect(top("system")).toBe("System theme");
  expect(top("check for")).toBe("Check for new mail");
  expect(top("set")).toBe("Settings ,");
});

test("anything else still searches mail", () => {
  for (const q of ["lumen", "invoice 2026", "dinner", "stripe receipt", "flight"]) expect(top(q)).toBe(SEARCH_ITEM);
  expect(paletteFilter(SEARCH_ITEM, "zzzz")).toBeGreaterThan(0);
});

test("removing the account you're viewing goes back to all accounts", () => {
  useStore.setState({ view: "starred", account: "studio", selected: "studio:t1" });
  forgetAccount("studio");
  expect(useStore.getState()).toMatchObject({ view: "starred", account: null, selected: null });

  useStore.setState({ view: "inbox", account: null, selected: "studio:t1" });
  forgetAccount("studio");
  expect(useStore.getState().selected).toBeNull();

  useStore.setState({ view: "inbox", account: "work", selected: "work:t2" });
  forgetAccount("studio");
  expect(useStore.getState()).toMatchObject({ account: "work", selected: "work:t2" });
});
