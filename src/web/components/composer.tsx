import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, ChevronUpIcon, Loader2Icon, Maximize2Icon, Minimize2Icon, MinusIcon, MoreHorizontalIcon, PaperclipIcon, SendIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccounts } from "@/hooks/data";
import { api } from "@/lib/api";
import { editCompose, isDirty, useStore, type ComposeDraft } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { invalidAddresses } from "../../server/mime";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function Composer() {
  const draft = useStore((s) => s.compose);
  return <AnimatePresence>{draft && <ComposerPanel key={draft.id} initial={draft} />}</AnimatePresence>;
}

function ComposerPanel({ initial }: { initial: ComposeDraft }) {
  const close = useStore((s) => s.closeCompose);
  const discard = useStore((s) => s.discardCompose);
  const min = useStore((s) => s.composeMinimized);
  const minimize = useStore((s) => s.minimizeCompose);
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
  const ccRef = useRef<HTMLInputElement>(null);
  // a field's address check shows once you leave the field or try to send
  const [checked, setChecked] = useState({ to: false, cc: false });

  const from = accounts.find((a) => a.id === (d.accountId ?? view)) ?? accounts[0];
  // a reply stays in its own account: its thread and In-Reply-To don't exist in another mailbox
  const fromLocked = d.mode === "reply" && !!d.threadId;
  const up = (p: Partial<ComposeDraft>) =>
    setD((x) => {
      const next = { ...x, ...p };
      editCompose(next);
      return next;
    });
  const bad = { to: invalidAddresses(d.to), cc: invalidAddresses(d.cc) };
  const problem = checked.to && bad.to.length ? notAddresses(bad.to) : checked.cc && bad.cc.length ? notAddresses(bad.cc) : null;

  useEffect(() => {
    (d.to ? body.current : toRef.current)?.focus();
    if (d.to) body.current?.setSelectionRange(0, 0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const wasMin = useRef(min);
  useEffect(() => {
    if (wasMin.current && !min) body.current?.focus();
    wasMin.current = min;
  }, [min]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (isDirty(useStore.getState().compose)) e.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

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

  const trySend = () => {
    if (!from || send.isPending) return;
    if (!d.to.trim()) return toRef.current?.focus();
    if (bad.to.length || bad.cc.length) {
      setChecked({ to: true, cc: true });
      return (bad.to.length ? toRef : ccRef).current?.focus();
    }
    if (!d.subject.trim() && !confirm("Send this without a subject?")) return;
    send.mutate();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      trySend();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      discard();
    }
  };
  const title = d.mode === "reply" ? "Reply" : d.mode === "forward" ? "Forward" : "New message";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ type: "spring", duration: 0.28, bounce: 0.12 }}
      onKeyDown={onKey}
      className={cn(
        "fixed right-6 bottom-6 z-40 flex flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl shadow-black/15 transition-[width,height] duration-200 ease-(--ease-snap)",
        min ? "h-10 w-[320px]" : big ? "h-[min(760px,calc(100vh-48px))] w-[min(880px,calc(100vw-48px))]" : "h-[520px] w-[560px]",
      )}
    >
      <div className={cn("flex h-10 shrink-0 items-center gap-1 px-3", !min && "border-b")}>
        {min ? (
          <button onClick={() => minimize(false)} className="flex min-w-0 flex-1 items-baseline gap-2 self-stretch text-left outline-none" title="Show the draft">
            <span className="shrink-0 text-[13px] font-medium">{title}</span>
            <span className="truncate text-[12px] text-muted-foreground">{d.subject || d.to}</span>
          </button>
        ) : (
          <>
            <span className="text-[13px] font-medium">{title}</span>
            <div className="flex-1" />
          </>
        )}
        <Button size="icon-sm" variant="ghost" aria-label={min ? "Show the draft" : "Minimize"} title={min ? "Show the draft" : "Minimize"} onClick={() => minimize(!min)}>
          {min ? <ChevronUpIcon className="!size-3.5" /> : <MinusIcon className="!size-3.5" />}
        </Button>
        {!min && (
          <Button size="icon-sm" variant="ghost" aria-label={big ? "Restore size" : "Maximize"} title={big ? "Restore size" : "Maximize"} onClick={() => setBig((b) => !b)}>
            {big ? <Minimize2Icon className="!size-3.5" /> : <Maximize2Icon className="!size-3.5" />}
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" aria-label="Discard draft" title="Discard draft" onClick={discard}>
          <XIcon />
        </Button>
      </div>

      <div className={cn("divide-y border-b text-[13px]", min && "hidden")}>
        <Field label="From">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={fromLocked}
              title={fromLocked ? "A reply goes from the account the conversation is in" : undefined}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 outline-none hover:bg-accent disabled:hover:bg-transparent"
            >
              {from && <span className="size-1.5 rounded-full" style={{ background: from.color }} />}
              {from?.email ?? "No account"}
              {accounts.length > 1 && !fromLocked && <ChevronDownIcon className="size-3 text-muted-foreground" />}
            </DropdownMenuTrigger>
            {accounts.length > 1 && !fromLocked && (
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
          <input
            ref={toRef}
            value={d.to}
            onChange={(e) => up({ to: e.target.value })}
            onBlur={() => setChecked((c) => ({ ...c, to: true }))}
            aria-invalid={checked.to && bad.to.length > 0}
            className="flex-1 bg-transparent outline-none aria-invalid:text-destructive"
            placeholder="name@example.com"
          />
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="text-[12px] text-muted-foreground hover:text-foreground">
              Cc
            </button>
          )}
        </Field>
        {showCc && (
          <Field label="Cc">
            <input
              ref={ccRef}
              autoFocus={!initial.cc}
              value={d.cc}
              onChange={(e) => up({ cc: e.target.value })}
              onBlur={() => setChecked((c) => ({ ...c, cc: true }))}
              aria-invalid={checked.cc && bad.cc.length > 0}
              className="flex-1 bg-transparent outline-none aria-invalid:text-destructive"
            />
          </Field>
        )}
        <Field label="Subject">
          <input value={d.subject} onChange={(e) => up({ subject: e.target.value })} className="flex-1 bg-transparent font-medium outline-none" />
        </Field>
      </div>

      {d.note && !min && (
        <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2 text-[12px] text-muted-foreground">
          <PaperclipIcon className="size-3.5 shrink-0" />
          <span className="truncate" title={d.note}>{d.note}</span>
        </div>
      )}

      {problem && !min && (
        <div role="alert" className="border-b bg-destructive/8 px-4 py-2 text-[12px] text-destructive">
          {problem}
        </div>
      )}

      <div className={cn("scroll-thin flex-1 overflow-y-auto", min && "hidden")}>
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

      <div className={cn("flex items-center gap-2 border-t px-3 py-2.5", min && "hidden")}>
        <Button variant="brand" onClick={trySend} disabled={!from || !d.to.trim() || send.isPending}>
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

const notAddresses = (bad: string[]) => `${bad.map((b) => `“${b}”`).join(", ")} ${bad.length > 1 ? "aren't email addresses" : "isn't an email address"}. Separate addresses with commas.`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex h-9 items-center gap-3 px-4">
      <span className="w-12 shrink-0 text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
