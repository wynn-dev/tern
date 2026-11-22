import { expect, test } from "bun:test";
import { readPref, resolveTheme, type Theme, themeController } from "../src/web/hooks/theme";

const setup = (stored: string | null, osDark: boolean) => {
  const store = new Map<string, string>(stored === null ? [] : [["tern-theme", stored]]);
  let onChange = () => {};
  const media = { matches: osDark, addEventListener: (_: "change", fn: () => void) => void (onChange = fn) };
  const applied: Theme[] = [];
  const ctl = themeController({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) }, media, (t) => void applied.push(t));
  const os = (dark: boolean) => ((media.matches = dark), onChange());
  return { ctl, store, applied, os };
};

test("defaults to the system theme", () => {
  expect(readPref(null)).toBe("system");
  expect(readPref("bogus")).toBe("system");
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("light", true)).toBe("light");
  const { ctl } = setup(null, true);
  expect([ctl.pref(), ctl.theme()]).toEqual(["system", "dark"]);
});

test("on system, follows the OS as it changes", () => {
  const { ctl, applied, os } = setup(null, false);
  os(true);
  os(false);
  expect(applied).toEqual(["dark", "light"]);
  expect(ctl.theme()).toBe("light");
});

test("an explicit choice ignores the OS, and system can be picked again", () => {
  const { ctl, store, applied, os } = setup("light", false);
  ctl.set("dark");
  os(true);
  os(false);
  expect(applied).toEqual(["dark"]);
  ctl.set("system");
  expect([store.get("tern-theme"), ctl.theme()]).toEqual(["system", "light"]);
  os(true);
  expect(applied).toEqual(["dark", "light", "dark"]);
});

test("tells subscribers when the preference or the OS changes", () => {
  const { ctl, os } = setup(null, false);
  let n = 0;
  const off = ctl.subscribe(() => n++);
  ctl.set("dark");
  os(true);
  off();
  ctl.set("light");
  expect(n).toBe(2);
});
