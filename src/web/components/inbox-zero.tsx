import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, useId, useState } from "react";
import { useAccounts, useStats } from "@/hooks/data";
import type { Stats } from "@/lib/api";
import { scopedCounts } from "@/lib/counts";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { H, W, zeroArt, type Art, type Palette } from "@/lib/zero-art";

const EASE = [0.2, 0.9, 0.1, 1] as const;

/** Today as the art counts days: the local calendar day. */
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** When this page first saw zero unread: the moment plays then, and stays still after. */
let firstZeroAt: number | null = null;
/** For tests: as if the page were opened again. */
export const resetZeroMoment = () => void (firstZeroAt = null);

/**
 * Zero unread in the Inbox you're looking at (one account or All accounts), as the server counts it,
 * so it holds however many pages are loaded. A search, another view or a broken account is never zero.
 */
export function useInboxZero() {
  const view = useStore((s) => s.view);
  const query = useStore((s) => s.query);
  const account = useStore((s) => s.account);
  const { data } = useAccounts();
  const accounts = (data?.accounts ?? []).filter((a) => !account || a.id === account);
  const c = scopedCounts(data?.counts, account);
  const zero = !!data && view === "inbox" && !query && accounts.length > 0 && !accounts.some((a) => a.status === "error") && c.inboxUnread === 0;
  if (zero) firstZeroAt ??= Date.now();
  return { zero, empty: zero && c.inbox === 0, account };
}

/** True when this mounts as zero is first reached in this page's life; false ever after. */
function useEntrance() {
  const [entering] = useState(() => firstZeroAt !== null && Date.now() - firstZeroAt < 1000);
  return entering;
}

/** "12 cleared today · 3-day streak": what's worth saying, nothing when there's nothing. */
export function zeroStats(s: Pick<Stats, "cleared" | "streak"> | undefined) {
  if (!s) return [];
  const parts: string[] = [];
  if (s.cleared) parts.push(`${s.cleared} cleared today`);
  if (s.streak > 1) parts.push(`${s.streak}-day streak`);
  else if (s.streak === 1) parts.push("Streak started");
  return parts;
}

const ROLES = ["sky0", "sky1", "sun", "l1", "l2", "l3"] as const;
/** Both themes' colours as variables: styles.css picks the current theme's, so a theme switch redraws nothing. */
const paletteVars = (p: Palette) =>
  Object.fromEntries(ROLES.flatMap((r) => [[`--z-${r}-l`, p[r][0]], [`--z-${r}-d`, p[r][1]]])) as CSSProperties;

/** The day's art; `crop` shows the horizon strip only, for the band. */
export function ZeroArt({ art, crop, entering, className }: { art: Art; crop?: boolean; entering: boolean; className?: string }) {
  const id = useId();
  const viewBox = crop ? `0 ${H * 0.28} ${W} ${H * 0.38}` : `0 0 ${W} ${H}`;
  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      data-art={`${art.palette.name}-${art.composition}`}
      className={cn("zero-art", entering && "zero-enter", className)}
      style={paletteVars(art.palette)}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--z-sky0)" }} />
          <stop offset="0.75" style={{ stopColor: "var(--z-sky1)" }} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id})`} />
      <circle className="zero-sun" cx={art.sun.cx} cy={art.sun.cy} r={art.sun.r} style={{ fill: "var(--z-sun)" }} />
      {art.lines.map((l, i) => (
        <path key={`l${i}`} className="zero-layer" d={l.d} strokeLinecap="round" style={{ stroke: `var(--z-${l.stroke})`, strokeWidth: l.width, opacity: l.opacity, "--i": 1 } as CSSProperties} />
      ))}
      {art.shapes.map((s, i) => (
        <path key={i} className="zero-layer" d={s.d} style={{ fill: `var(--z-${s.fill})`, opacity: s.opacity, "--i": i } as CSSProperties} />
      ))}
    </svg>
  );
}

/** At the top of the list once nothing's unread, while the read mail stays listed under it. */
export function ZeroBand() {
  const { zero, account } = useInboxZero();
  return <AnimatePresence initial={false}>{zero && <Band key="band" account={account} />}</AnimatePresence>;
}

function Band({ account }: { account: string | null }) {
  const entering = useEntrance();
  const { data: stats } = useStats(account);
  const art = zeroArt(today());
  const parts = zeroStats(stats);
  return (
    <motion.div
      role="status"
      aria-label="Zero unread"
      initial={entering ? { height: 0, opacity: 0 } : false}
      animate={{ height: 56, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: entering ? 0.32 : 0.18, ease: EASE }}
      className="relative shrink-0 overflow-hidden border-b"
    >
      <ZeroArt art={art} crop entering={entering} className="absolute inset-0 size-full" />
      <div className="absolute inset-0 bg-linear-to-r from-background/90 via-background/55 to-transparent" />
      <div className={cn("relative flex h-14 flex-col justify-center px-4 leading-tight", entering && "zero-text")}>
        <span className="text-[13px] font-semibold tracking-tight">Zero unread</span>
        <span className="text-[12px] text-foreground/70 tabular-nums">{parts.length ? parts.join(" · ") : art.line}</span>
      </div>
    </motion.div>
  );
}

/** The reader pane with nothing open, at zero unread: the day's art and where you stand. */
export function ZeroPane() {
  const { empty, account } = useInboxZero();
  const entering = useEntrance();
  const { data: stats } = useStats(account);
  const art = zeroArt(today());
  const parts = zeroStats(stats);
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  return (
    <div data-zero className="flex h-full w-full flex-col items-center justify-center gap-7 px-10 pb-10">
      <motion.div
        initial={entering ? { opacity: 0, scale: 0.985 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="aspect-[3/2] w-full max-w-[560px] overflow-hidden rounded-2xl border shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_40px_-12px_rgb(0_0_0/0.12)]"
      >
        <ZeroArt art={art} entering={entering} className="size-full" />
      </motion.div>
      <div className={cn("flex flex-col items-center gap-1.5 text-center", entering && "zero-text")}>
        <div className="text-[11.5px] text-muted-foreground">{date}</div>
        <h2 className="text-[22px] font-semibold tracking-tight">{empty ? "Inbox zero" : "Zero unread"}</h2>
        <p className="text-[13.5px] text-foreground/70">{art.line}</p>
        {!!parts.length && (
          <p className="mt-2 flex items-center gap-2 text-[12.5px] text-muted-foreground tabular-nums">
            {parts.map((p, i) => (
              <span key={p} className="flex items-center gap-2">
                {i > 0 && <span className="size-[3px] rounded-full bg-muted-foreground/50" />}
                {p}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
