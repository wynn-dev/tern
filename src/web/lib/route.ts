/**
 * The view lives in the URL, so refresh restores it and Back/Forward move between views:
 *
 *   /sent                         folder (`/` is the inbox)
 *   /category/work, /label/Clients
 *   /inbox/<account>/<thread>     an open thread
 *   ?account=<id>&q=<search>      account filter and search
 */
export type Route = { view: string; account: string | null; query: string; selected: string | null };

const FOLDERS = new Set(["inbox", "needs-reply", "starred", "sent", "all", "trash", "spam"]);

export function parseRoute(url: { pathname: string; search: string }): Route {
  const parts = url.pathname.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  let view = "inbox";
  if ((parts[0] === "category" || parts[0] === "label") && parts[1]) view = `${parts.shift()}:${parts.shift()}`;
  else if (parts[0] && FOLDERS.has(parts[0])) view = parts.shift()!;
  else if (parts.length % 2) parts.shift(); // unknown folder: fall back to the inbox
  const p = new URLSearchParams(url.search);
  return {
    view,
    account: p.get("account") || null,
    query: p.get("q") ?? "",
    selected: parts.length >= 2 ? `${parts[0]}:${parts[1]}` : null,
  };
}

export function formatRoute({ view, account, query, selected }: Route): string {
  const seg = view.startsWith("category:") || view.startsWith("label:") ? [view.slice(0, view.indexOf(":")), view.slice(view.indexOf(":") + 1)] : [view];
  if (selected) {
    const i = selected.indexOf(":");
    seg.push(selected.slice(0, i), selected.slice(i + 1));
  }
  let path = "/" + seg.map(encodeURIComponent).join("/");
  if (path === "/inbox") path = "/";
  const p = new URLSearchParams();
  if (account) p.set("account", account);
  if (query) p.set("q", query);
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * How a change of view should land in history: a new folder, account, search or opened thread
 * gets its own entry; moving between threads (j/k) or refining a search replaces the current one.
 */
export function historyMode(prev: Route, next: Route): "push" | "replace" | "none" {
  if (formatRoute(prev) === formatRoute(next)) return "none";
  if (prev.view !== next.view || prev.account !== next.account) return "push";
  if (!prev.query && next.query) return "push";
  if (!prev.selected && next.selected) return "push";
  return "replace";
}
