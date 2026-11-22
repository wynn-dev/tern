import {
  BriefcaseIcon, HeartIcon, InboxIcon, NewspaperIcon, PlaneIcon, ReceiptIcon, SparklesIcon, TagIcon, UsersIcon, BellIcon, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { hue, initials } from "@/lib/format";

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

export const CATEGORY: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  important: { label: "Important", icon: SparklesIcon, color: "oklch(0.64 0.21 25)" },
  personal: { label: "Personal", icon: HeartIcon, color: "oklch(0.66 0.19 350)" },
  work: { label: "Work", icon: BriefcaseIcon, color: "oklch(0.6 0.17 260)" },
  updates: { label: "Updates", icon: BellIcon, color: "oklch(0.65 0.13 220)" },
  finance: { label: "Finance", icon: ReceiptIcon, color: "oklch(0.64 0.15 155)" },
  travel: { label: "Travel", icon: PlaneIcon, color: "oklch(0.7 0.14 200)" },
  newsletters: { label: "Newsletters", icon: NewspaperIcon, color: "oklch(0.7 0.14 75)" },
  promotions: { label: "Promotions", icon: TagIcon, color: "oklch(0.66 0.13 300)" },
  social: { label: "Social", icon: UsersIcon, color: "oklch(0.66 0.14 290)" },
};

export const categoryMeta = (c: string | null) => (c ? CATEGORY[c] : undefined) ?? { label: "Inbox", icon: InboxIcon, color: "var(--muted-foreground)" };

/** The same oklch hue at another lightness: chip text that stays readable on the chip's tint. */
export const shade = (color: string, l: number) => color.replace(/^oklch\(\s*[\d.]+/, `oklch(${l}`);

export function CategoryChip({ category, className }: { category: string; className?: string }) {
  const m = categoryMeta(category);
  return (
    <span
      className={cn("inline-flex h-[18px] items-center gap-1 rounded-full px-1.5 text-[10.5px] font-medium text-(--ink) dark:text-(--ink-dark)", className)}
      style={{ "--ink": shade(m.color, 0.47), "--ink-dark": shade(m.color, 0.76), background: `color-mix(in oklch, ${m.color} 12%, transparent)` } as React.CSSProperties}
    >
      <m.icon className="size-2.5" strokeWidth={2.5} />
      {m.label}
    </span>
  );
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
