import { useCallback, useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "tern-theme";
/** Anything but an explicit light or dark (nothing stored, an old value) follows the OS. */
export const readPref = (v: string | null): ThemePref => (v === "light" || v === "dark" ? v : "system");
/** The sidebar's theme button steps through all three: system, then light, then dark. */
export const nextPref = (p: ThemePref): ThemePref => (p === "system" ? "light" : p === "light" ? "dark" : "system");
export const resolveTheme = (pref: ThemePref, osDark: boolean): Theme => (pref === "system" ? (osDark ? "dark" : "light") : pref);

type Media = { readonly matches: boolean; addEventListener(type: "change", fn: () => void): void };

/**
 * The stored preference, applied to the page: while it's "system", OS changes apply live.
 * index.html applies the same rule before first paint.
 */
export function themeController(storage: Pick<Storage, "getItem" | "setItem">, media: Media, apply: (t: Theme) => void) {
  let pref = readPref(storage.getItem(KEY));
  let theme = resolveTheme(pref, media.matches);
  const listeners = new Set<() => void>();
  const update = () => {
    const next = resolveTheme(pref, media.matches);
    if (next !== theme) apply((theme = next));
    listeners.forEach((fn) => fn());
  };
  media.addEventListener("change", update);
  return {
    pref: () => pref,
    theme: () => theme,
    set(p: ThemePref) {
      pref = p;
      storage.setItem(KEY, p);
      update();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

const apply = (t: Theme) => {
  // switch without every transition firing at once
  document.documentElement.classList.add("no-transitions");
  document.documentElement.classList.toggle("dark", t === "dark");
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("no-transitions")));
};

let ctl: ReturnType<typeof themeController> | undefined;
const controller = () => (ctl ??= themeController(localStorage, matchMedia("(prefers-color-scheme: dark)"), apply));
const subscribe = (fn: () => void) => controller().subscribe(fn);

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => controller().theme());
  const pref = useSyncExternalStore(subscribe, () => controller().pref());
  const setPref = useCallback((p: ThemePref) => controller().set(p), []);
  const cycle = useCallback(() => controller().set(nextPref(controller().pref())), []);
  return { theme, pref, setPref, cycle };
}
