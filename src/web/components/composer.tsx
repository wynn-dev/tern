import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, Loader2Icon, Maximize2Icon, Minimize2Icon, MoreHorizontalIcon, PaperclipIcon, SendIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccounts } from "@/hooks/data";
import { api } from "@/lib/api";
import { useStore, type ComposeDraft } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function Composer() {
  const draft = useStore((s) => s.compose);
  return <AnimatePresence>{draft && <ComposerPanel key={draft.id} initial={draft} />}</AnimatePresence>;
}

function ComposerPanel({ initial }: { initial: ComposeDraft }) {
  const close = useStore((s) => s.closeCompose);
  const view = useStore((s) => s.account);
  const { data } = useAccounts();
  const accounts = data?.accounts ?? [];
  const qc = useQueryClient();
  const [d, setD] = useState(initial);
  const [showCc, setShowCc] = useState(!!initial.cc);
  const [showQuoted, setShowQuoted] = useState(false);
  const [big, setBig] = useState(false);
  const body = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const from = accounts.find((a) => a.id === (d.accountId ?? view)) ?? accounts[0];
  const up = (p: Partial<ComposeDraft>) => setD((x) => ({ ...x, ...p }));

  useEffect(() => {
    (d.to ? body.current : toRef.current)?.focus();
    if (d.to) body.current?.setSelectionRange(0, 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: () =>
      api.send({
        accountId: from!.id, to: d.to, cc: d.cc || undefined, subject: d.subject, threadId: d.threadId,
        text: d.text + (d.quoted ?? ""),
      }),
    onSuccess: () => {
      toast.success("Sent", { description: `from ${from!.email}` });
      void qc.invalidateQueries({ queryKey: ["threads"] });
      if (d.threadId) void qc.invalidateQueries({ queryKey: ["thread", `${from!.id}:${d.threadId}`] });
      close();
    },
    onError: (e) => toast.error(`Not sent: ${e.message}`),
  });

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (from && d.to.trim()) send.mutate();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!d.text.trim() || confirm("Discard this draft?")) close();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", duration: 0.28, bounce: 0.12 }}
      onKeyDown={onKey}
      className={cn(
        "fixed right-6 bottom-6 z-40 flex flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl shadow-black/15 transition-[width,height] duration-200 ease-(--ease-snap)",
        big ? "h-[min(760px,calc(100vh-48px))] w-[min(880px,calc(100vw-48px))]" : "h-[520px] w-[560px]",
      )}
    >
      <div className="flex h-10 items-center gap-1 border-b px-3">
        <span className="text-[13px] font-medium">{d.mode === "reply" ? "Reply" : d.mode === "forward" ? "Forward" : "New message"}</span>
        <div className="flex-1" />
        <Button size="icon-sm" variant="ghost" onClick={() => setBig((b) => !b)}>
          {big ? <Minimize2Icon className="!size-3.5" /> : <Maximize2Icon className="!size-3.5" />}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={close}>
          <XIcon />
        </Button>
      </div>

      <div className="divide-y border-b text-[13px]">
        <Field label="From">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 rounded px-1 py-0.5 outline-none hover:bg-accent">
              {from && <span className="size-1.5 rounded-full" style={{ background: from.color }} />}
              {from?.email ?? "No account"}
              {accounts.length > 1 && <ChevronDownIcon className="size-3 text-muted-foreground" />}
            </DropdownMenuTrigger>
            {accounts.length > 1 && (
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Send from</DropdownMenuLabel>
                {accounts.map((a) => (
                  <DropdownMenuItem key={a.id} onSelect={() => up({ accountId: a.id })}>
                    <span className="size-1.5 rounded-full" style={{ background: a.color }} />
                    {a.email}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </Field>
        <Field label="To">
          <input ref={toRef} value={d.to} onChange={(e) => up({ to: e.target.value })} className="flex-1 bg-transparent outline-none" placeholder="name@example.com" />
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="text-[12px] text-muted-foreground hover:text-foreground">
              Cc
            </button>
          )}
        </Field>
        {showCc && (
          <Field label="Cc">
            <input autoFocus={!initial.cc} value={d.cc} onChange={(e) => up({ cc: e.target.value })} className="flex-1 bg-transparent outline-none" />
          </Field>
        )}
        <Field label="Subject">
          <input value={d.subject} onChange={(e) => up({ subject: e.target.value })} className="flex-1 bg-transparent font-medium outline-none" />
        </Field>
      </div>

      {d.note && (
        <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-[12px] text-muted-foreground">
          <PaperclipIcon className="size-3.5 shrink-0" />
          <span className="truncate" title={d.note}>{d.note}</span>
        </div>
      )}

      <div className="scroll-thin flex-1 overflow-y-auto">
        <textarea
          ref={body}
          value={d.text}
          onChange={(e) => up({ text: e.target.value })}
          placeholder="Write something…"
          className="block min-h-[60%] w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        {d.quoted && (
          <div className="px-4 pb-4">
            <button onClick={() => setShowQuoted((v) => !v)} className="flex h-5 items-center rounded bg-muted px-1.5 text-muted-foreground hover:text-foreground">
              <MoreHorizontalIcon className="size-3.5" />
            </button>
            {showQuoted && <pre className="mt-2 font-sans text-[12.5px] whitespace-pre-wrap text-muted-foreground">{d.quoted.trim()}</pre>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2.5">
        <Button variant="brand" onClick={() => send.mutate()} disabled={!from || !d.to.trim() || send.isPending}>
          {send.isPending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          Send
        </Button>
        <span className="text-[11.5px] text-muted-foreground">
          <kbd>⌘</kbd> <kbd>↵</kbd>
        </span>
      </div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex h-9 items-center gap-3 px-4">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
