import { CloudOffIcon, Loader2Icon, RotateCwIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/** A failed load, with a way to try again: never shown as an empty folder. */
export function LoadError({ title, error, retrying, onRetry, className }: {
  title: string; error: Error | null; retrying?: boolean; onRetry: () => void; className?: string;
}) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={cn("flex h-full flex-col items-center justify-center gap-1 px-8 pb-16 text-center", className)}
    >
      <CloudOffIcon className="mb-3 size-8 text-muted-foreground/50" strokeWidth={1.5} />
      <div className="text-[14px] font-medium">{title}</div>
      {error && <div className="max-w-[320px] text-[12.5px] break-words text-muted-foreground">{error.message}</div>}
      <Button variant="outline" size="sm" className="mt-3" disabled={retrying} onClick={onRetry}>
        {retrying ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />} Try again
      </Button>
    </motion.div>
  );
}
