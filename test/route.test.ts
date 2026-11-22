import { expect, test } from "bun:test";
import { formatRoute, historyMode, parseRoute, type Route } from "../src/web/lib/route";

const r = (p: Partial<Route> = {}): Route => ({ view: "inbox", account: null, query: "", selected: null, ...p });
const at = (href: string) => parseRoute(new URL(href, "http://x"));

test("round-trips every part of the view through the URL", () => {
  for (const route of [
    r(),
    r({ view: "sent" }),
    r({ view: "spam", account: "work" }),
    r({ view: "category:finance", query: "receipt 2026" }),
    r({ view: "label:Search infra/Q4 & more", selected: "work:18c2f" }),
    r({ selected: "personal:abc", query: "dinner", account: "personal" }),
  ])
    expect(at(formatRoute(route))).toEqual(route);
});

test("reads the URLs it writes", () => {
  expect(formatRoute(r())).toBe("/");
  expect(formatRoute(r({ selected: "work:t1" }))).toBe("/inbox/work/t1");
  expect(formatRoute(r({ view: "label:Clients", account: "studio", query: "lumen" }))).toBe("/label/Clients?account=studio&q=lumen");
  expect(at("/nope")).toEqual(r());
  expect(at("/?connected=me%40x.io")).toEqual(r());
});

test("new views get a history entry, moving between threads doesn't", () => {
  expect(historyMode(r(), r({ view: "sent" }))).toBe("push");
  expect(historyMode(r(), r({ account: "work" }))).toBe("push");
  expect(historyMode(r(), r({ query: "a" }))).toBe("push");
  expect(historyMode(r({ query: "a" }), r({ query: "ab" }))).toBe("replace");
  expect(historyMode(r(), r({ selected: "a:1" }))).toBe("push");
  expect(historyMode(r({ selected: "a:1" }), r({ selected: "a:2" }))).toBe("replace");
  expect(historyMode(r({ selected: "a:1" }), r())).toBe("replace");
  expect(historyMode(r({ selected: "a:1" }), r({ selected: "a:1" }))).toBe("none");
});
