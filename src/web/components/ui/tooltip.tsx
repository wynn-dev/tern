import { Tooltip as T } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <T.Provider delayDuration={350} skipDelayDuration={150}>
    {children}
  </T.Provider>
);

export function Tooltip({ label, kbd, children, side = "bottom" }: { label: string; kbd?: string; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 flex items-center gap-2 rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground shadow-md",
            "animate-in fade-in-0 zoom-in-95 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          {label}
          {kbd && <span className="font-mono text-[10.5px] opacity-60">{kbd}</span>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
