import { useRef } from "react";
import { cn } from "@/lib/utils";
import { hue, initials } from "@/lib/format";

/**
 * A count that rolls to its new value: down as it falls, up as it climbs. CSS only, and the new number is
 * there at once, so a count never lags what you did.
 */
export function Ticker({ value, className }: { value: number; className?: string }) {
  const last = useRef<{ value: number; dir: "down" | "up" | null }>({ value, dir: null });
  if (last.current.value !== value) last.current = { value, dir: value < last.current.value ? "down" : "up" };
  return (
    <span className={cn("ticker", className)}>
      <span key={value} className={last.current.dir ? `ticker-${last.current.dir}` : undefined}>{value}</span>
    </span>
  );
}

export function Avatar({ person, size = 32, className }: { person: { name: string; email: string }; size?: number; className?: string }) {
  const h = hue(person.email);
  return (
    <div
      className={cn("flex shrink-0 items-center justify-center rounded-full font-medium select-none", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `oklch(0.92 0.05 ${h})`,
        color: `oklch(0.38 0.09 ${h})`,
      }}
    >
      {initials(person)}
    </div>
  );
}

export const CATEGORY: Record<string, { label: string; color: string }> = {
  important: { label: "Important", color: "oklch(0.64 0.21 25)" },
  personal: { label: "Personal", color: "oklch(0.66 0.19 350)" },
  work: { label: "Work", color: "oklch(0.6 0.17 260)" },
  updates: { label: "Updates", color: "oklch(0.65 0.13 220)" },
  finance: { label: "Finance", color: "oklch(0.64 0.15 155)" },
  travel: { label: "Travel", color: "oklch(0.7 0.14 200)" },
  newsletters: { label: "Newsletters", color: "oklch(0.7 0.14 75)" },
  promotions: { label: "Promotions", color: "oklch(0.66 0.13 300)" },
  social: { label: "Social", color: "oklch(0.66 0.14 290)" },
};

export const categoryMeta = (c: string | null) => (c ? CATEGORY[c] : undefined) ?? { label: "Inbox", color: "var(--muted-foreground)" };

/** The same oklch hue at another lightness: chip text that stays readable on the chip's tint. */
export const shade = (color: string, l: number) => color.replace(/^oklch\(\s*[\d.]+/, `oklch(${l}`);

/** Text only: the colour carries the category. */
export function CategoryChip({ category, className }: { category: string; className?: string }) {
  const m = categoryMeta(category);
  return (
    <span
      className={cn("inline-flex h-4 items-center rounded px-1 text-[10.5px] font-medium text-(--ink) dark:text-(--ink-dark)", className)}
      style={{ "--ink": shade(m.color, 0.47), "--ink-dark": shade(m.color, 0.76), background: `color-mix(in oklch, ${m.color} 9%, transparent)` } as React.CSSProperties}
    >
      {m.label}
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
