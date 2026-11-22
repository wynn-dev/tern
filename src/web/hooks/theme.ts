import { useCallback, useSyncExternalStore } from "react";

const subscribe = (fn: () => void) => {
  const obs = new MutationObserver(fn);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
};
const get = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, get);
  const toggle = useCallback(() => {
    const next = get() === "dark" ? "light" : "dark";
    localStorage.setItem("tern-theme", next);
    // switch without every transition firing at once
    document.documentElement.classList.add("no-transitions");
    document.documentElement.classList.toggle("dark", next === "dark");
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove("no-transitions")));
  }, []);
  return { theme, toggle };
}
