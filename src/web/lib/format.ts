const dayMs = 86400_000;

export function shortDate(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - ms < 6 * dayMs) return d.toLocaleDateString([], { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

export const longDate = (ms: number) =>
  new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const displayName = (a: { name: string; email: string }) => a.name || a.email.split("@")[0];
/** For recipient lists, where a bare local part ("linda.rivera") hides who it went to. */
export const addressLabel = (a: { name: string; email: string }) => a.name || a.email;
/** Is a broken account's error an expired or revoked Google sign-in? Anything else is a failed sync. */
export const signedOut = (a: { error: string | null }) => /token|invalid_grant|revoked|expired|authenticat|credential|isn't connected/i.test(a.error ?? "");
/** An account Gmail is slowing down (status "limited"): sync waits it out and carries on by itself. */
export const CATCHING_UP = "Gmail is rate-limiting Tern, catching up";
/** A broken account, in words. */
export const accountTrouble = (a: { email: string; error: string | null }) => (signedOut(a) ? `${a.email} was signed out` : `Couldn't sync ${a.email}`);
export const firstName = (a: { name: string; email: string }) => displayName(a).split(/\s+/)[0];

export function initials(a: { name: string; email: string }) {
  const n = displayName(a).replace(/[^\p{L}\p{N}\s]/gu, "").trim();
  const parts = n.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "?";
}

export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Stable hue per sender, for avatars. */
export function hue(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
