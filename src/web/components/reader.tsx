import { useMutation } from "@tanstack/react-query";
import {
  ArchiveIcon, ArrowLeftIcon, CheckCircle2Icon, ChevronDownIcon, DownloadIcon, ForwardIcon, InboxIcon, Loader2Icon, MailIcon, MailOpenIcon,
  MoreHorizontalIcon, OctagonAlertIcon, PaperclipIcon, ReplyAllIcon, ReplyIcon, SparklesIcon, StarIcon, Trash2Icon, WandSparklesIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAccounts, useActions, useThread } from "@/hooks/data";
import { api, type Message, type Thread } from "@/lib/api";
import { bytes, displayName, longDate } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Avatar, CategoryChip, categoryMeta } from "./bits";
import { EmailFrame } from "./email-frame";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip } from "./ui/tooltip";

export function Reader() {
  const selected = useStore((s) => s.selected);
  const { data, isLoading } = useThread(selected);
  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-background">
      <AnimatePresence mode="popLayout" initial={false}>
        {!selected ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="flex flex-1 items-center justify-center">
            <NothingOpen />
          </motion.div>
        ) : isLoading || !data ? (
          <div key="loading" className="flex-1" />
        ) : (
          <motion.div
            key={selected}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: [0.2, 0.9, 0.1, 1] }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ThreadView thread={data.thread} messages={data.messages} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function NothingOpen() {
  return (
    <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
      <MailIcon className="size-8 opacity-25" strokeWidth={1.5} />
      <div className="text-[13px]">Pick a conversation</div>
      <div className="flex items-center gap-1.5 text-[12px]">
        <kbd>J</kbd> <kbd>K</kbd> to move, <kbd>⌘K</kbd> for everything else
      </div>
    </div>
  );
}

function ThreadView({ thread, messages }: { thread: Thread; messages: Message[] }) {
  const act = useActions();
  const { openCompose, select } = useStore();
  const { data } = useAccounts();
  const account = data?.accounts.find((a) => a.id === thread.account_id);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded(messages)));
  useEffect(() => setExpanded(new Set(initialExpanded(messages))), [thread.thread_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // mark read after a beat, so flicking through with j/k doesn't
  useEffect(() => {
    if (!thread.unread) return;
    const t = setTimeout(() => void act([thread], "read", { quiet: true }), 600);
    return () => clearTimeout(t);
  }, [thread.thread_id, thread.unread]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMutation({ mutationFn: () => api.summarize(thread.account_id, thread.thread_id) });
  useEffect(() => summary.reset(), [thread.thread_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const last = messages.at(-1)!;
  const reply = (all: boolean) => openCompose(replyDraft(thread, messages, account?.email, all));

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-0.5 border-b px-3">
        <Tooltip label="Close" kbd="Esc">
          <Button size="icon-sm" variant="ghost" onClick={() => select(null)}>
            <ArrowLeftIcon />
          </Button>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-border" />
        {thread.in_inbox ? (
          <Tooltip label="Archive" kbd="E">
            <Button size="icon-sm" variant="ghost" onClick={() => act([thread], "archive")}>
              <ArchiveIcon />
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label="Move to inbox" kbd="⇧E">
            <Button size="icon-sm" variant="ghost" onClick={() => act([thread], "inbox")}>
              <InboxIcon />
            </Button>
          </Tooltip>
        )}
        <Tooltip label="Trash" kbd="#">
          <Button size="icon-sm" variant="ghost" onClick={() => act([thread], thread.in_trash ? "untrash" : "trash")}>
            <Trash2Icon />
          </Button>
        </Tooltip>
        <Tooltip label={thread.starred ? "Unstar" : "Star"} kbd="S">
          <Button size="icon-sm" variant="ghost" onClick={() => act([thread], thread.starred ? "unstar" : "star")}>
            <StarIcon className={cn(thread.starred && "fill-amber-400 text-amber-400")} />
          </Button>
        </Tooltip>
        <Tooltip label={thread.unread ? "Mark read" : "Mark unread"} kbd="U">
          <Button size="icon-sm" variant="ghost" onClick={() => act([thread], thread.unread ? "read" : "unread")}>
            {thread.unread ? <MailOpenIcon /> : <MailIcon />}
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => act([thread], "spam")}>
              <OctagonAlertIcon /> Report spam
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setExpanded(new Set(messages.map((m) => m.id)))}>Expand all</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        {account && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="size-1.5 rounded-full" style={{ background: account.color }} />
            {account.email}
          </span>
        )}
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 pt-7 pb-10">
          <div className="mb-4 flex items-start gap-3">
            <h2 className="flex-1 text-[20px] leading-snug font-semibold tracking-tight text-balance">{thread.subject || "(no subject)"}</h2>
          </div>

          <AiCard thread={thread} summary={summary.data} loading={summary.isPending} error={summary.error?.message} onSummarize={() => summary.mutate()} />

          <div className="mt-5 space-y-2.5">
            {messages.map((m, i) => (
              <MessageCard
                key={m.id}
                m={m}
                me={account?.email}
                open={expanded.has(m.id) || i === messages.length - 1}
                onToggle={() =>
                  setExpanded((s) => {
                    const n = new Set(s);
                    n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                    return n;
                  })
                }
              />
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => reply(false)}>
              <ReplyIcon /> Reply <kbd className="ml-1">R</kbd>
            </Button>
            {(last.cc.length > 0 || last.to.length > 1) && (
              <Button variant="outline" onClick={() => reply(true)}>
                <ReplyAllIcon /> Reply all <kbd className="ml-1">A</kbd>
              </Button>
            )}
            <Button variant="outline" onClick={() => openCompose(forwardDraft(thread, last))}>
              <ForwardIcon /> Forward <kbd className="ml-1">F</kbd>
            </Button>
            <AiDraftButton thread={thread} messages={messages} me={account?.email} />
          </div>
        </div>
      </div>
    </>
  );
}

function initialExpanded(messages: Message[]) {
  return messages.filter((m, i) => i === messages.length - 1 || m.labels.includes("UNREAD")).map((m) => m.id);
}

function AiCard({
  thread, summary, loading, error, onSummarize,
}: { thread: Thread; summary?: { summary: string; actions: string[] }; loading: boolean; error?: string; onSummarize: () => void }) {
  if (!thread.summary && !thread.category && !summary && !loading) return null;
  const color = categoryMeta(thread.category).color;
  return (
    <motion.div
      layout
      transition={{ duration: 0.18, ease: [0.2, 0.9, 0.1, 1] }}
      className="overflow-hidden rounded-xl border bg-card px-4 py-3"
      style={{ background: `linear-gradient(135deg, color-mix(in oklch, ${color} 7%, var(--card)), var(--card) 60%)` }}
    >
      <div className="flex items-center gap-2">
        <SparklesIcon className="size-3.5" style={{ color }} />
        {thread.category && <CategoryChip category={thread.category} />}
        {thread.priority !== null && thread.priority >= 2 && (
          <span className="text-[11px] font-medium text-muted-foreground">{thread.priority === 3 ? "Act today" : "Soon"}</span>
        )}
        <div className="flex-1" />
        {!summary && (
          <button onClick={onSummarize} disabled={loading} className="flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60">
            {loading ? <Loader2Icon className="size-3 animate-spin" /> : <WandSparklesIcon className="size-3" />}
            {loading ? "Reading the thread…" : "Summarize"}
          </button>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={summary ? "full" : "short"} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-foreground/90">{summary?.summary ?? thread.summary}</p>
          {!!summary?.actions.length && (
            <ul className="mt-2 space-y-1">
              {summary.actions.map((a) => (
                <li key={a} className="flex items-start gap-2 text-[13px] text-foreground/85">
                  <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  {a}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function MessageCard({ m, me, open, onToggle }: { m: Message; me?: string; open: boolean; onToggle: () => void }) {
  const from = { name: m.from_name, email: m.from_email };
  const mine = m.from_email === me;
  const recipients = [...m.to, ...m.cc].map((a) => (a.email === me ? "me" : displayName(a))).join(", ");
  const body = useMemo(() => stripQuoted(m.text), [m.text]);
  const [showQuoted, setShowQuoted] = useState(false);

  return (
    <motion.article layout="position" transition={{ duration: 0.18, ease: [0.2, 0.9, 0.1, 1] }} className={cn("rounded-xl border bg-card", !open && "hover:bg-accent/40")}>
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Avatar person={from} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-medium">{mine ? "You" : displayName(from)}</span>
            {!mine && open && <span className="truncate text-[12px] text-muted-foreground">{m.from_email}</span>}
          </div>
          <div className="truncate text-[12.5px] text-muted-foreground">{open ? `to ${recipients}` : m.snippet}</div>
        </div>
        {m.attachments.length > 0 && <PaperclipIcon className="size-3.5 text-muted-foreground" />}
        <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{longDate(m.internal_date)}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.9, 0.1, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {m.html ? (
                <EmailFrame html={m.html} />
              ) : (
                <div className="pl-[42px] text-[14px] leading-relaxed whitespace-pre-wrap text-foreground/90">
                  {linkify(showQuoted ? m.text : body.main)}
                  {body.quoted && (
                    <button onClick={() => setShowQuoted((v) => !v)} className="mt-2 flex h-5 items-center rounded bg-muted px-1.5 text-muted-foreground hover:text-foreground">
                      <MoreHorizontalIcon className="size-3.5" />
                    </button>
                  )}
                </div>
              )}
              {m.attachments.length > 0 && (
                <div className={cn("mt-3 flex flex-wrap gap-2", !m.html && "pl-[42px]")}>
                  {m.attachments.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/attachments/${m.account_id}/${m.id}/${encodeURIComponent(a.id)}?name=${encodeURIComponent(a.filename)}&type=${encodeURIComponent(a.mimeType)}`}
                      className="group flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-[12.5px] transition-colors hover:bg-accent"
                    >
                      <PaperclipIcon className="size-3.5 text-muted-foreground" />
                      <span className="max-w-48 truncate font-medium">{a.filename}</span>
                      <span className="text-muted-foreground">{bytes(a.size)}</span>
                      <DownloadIcon className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function stripQuoted(text: string) {
  const lines = text.split("\n");
  const i = lines.findIndex((l, idx) => /^On .{6,}wrote:\s*$/.test(l.trim()) || (l.startsWith(">") && lines.slice(idx).every((x) => !x.trim() || x.startsWith(">"))));
  if (i <= 0) return { main: text.trim(), quoted: false };
  return { main: lines.slice(0, i).join("\n").trim(), quoted: true };
}

function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s<>()]+)/g).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="text-brand underline decoration-brand/30 underline-offset-2 hover:decoration-brand">
        {part.length > 60 ? part.slice(0, 57) + "…" : part}
      </a>
    ) : (
      part
    ),
  );
}

const reSubject = (s: string, p: "Re" | "Fwd") => (new RegExp(`^${p}:`, "i").test(s) ? s : `${p}: ${s}`);

export function replyDraft(thread: Thread, messages: Message[], me: string | undefined, all: boolean) {
  const last = [...messages].reverse().find((m) => m.from_email !== me) ?? messages.at(-1)!;
  const to = last.from_email === me ? last.to.map((a) => a.email) : [last.from_email];
  const cc = all ? [...last.to, ...last.cc].map((a) => a.email).filter((e) => e !== me && !to.includes(e)) : [];
  const quoted = `\n\nOn ${longDate(last.internal_date)}, ${displayName({ name: last.from_name, email: last.from_email })} wrote:\n${last.text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}`;
  return {
    mode: "reply" as const, accountId: thread.account_id, threadId: thread.thread_id, to: to.join(", "), cc: cc.join(", "),
    subject: reSubject(thread.subject, "Re"), text: "", quoted,
  };
}

function forwardDraft(thread: Thread, m: Message) {
  return {
    mode: "forward" as const, accountId: thread.account_id, to: "", cc: "", subject: reSubject(thread.subject, "Fwd"),
    text: `\n\n---------- Forwarded message ----------\nFrom: ${m.from_name} <${m.from_email}>\nDate: ${longDate(m.internal_date)}\nSubject: ${m.subject}\n\n${m.text}`,
  };
}

function AiDraftButton({ thread, messages, me }: { thread: Thread; messages: Message[]; me?: string }) {
  const openCompose = useStore((s) => s.openCompose);
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const draft = useMutation({
    mutationFn: (i: string) => api.draft(thread.account_id, thread.thread_id, i),
    onSuccess: ({ body }) => {
      setAsking(false);
      setInstruction("");
      openCompose({ ...replyDraft(thread, messages, me, false), text: body });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <motion.div layout className="flex items-center gap-2" transition={{ duration: 0.15 }}>
      {!asking ? (
        <Button variant="ghost" className="text-brand hover:text-brand" onClick={() => setAsking(true)}>
          <SparklesIcon /> Draft with AI
        </Button>
      ) : (
        <motion.form
          initial={{ opacity: 0, width: 200 }}
          animate={{ opacity: 1, width: 360 }}
          transition={{ duration: 0.18, ease: [0.2, 0.9, 0.1, 1] }}
          onSubmit={(e) => {
            e.preventDefault();
            draft.mutate(instruction);
          }}
          className="flex h-8 items-center gap-2 rounded-md border border-brand/40 bg-background px-2.5 shadow-xs ring-[3px] ring-brand/10"
        >
          {draft.isPending ? <Loader2Icon className="size-3.5 animate-spin text-brand" /> : <SparklesIcon className="size-3.5 text-brand" />}
          <input
            autoFocus
            value={instruction}
            disabled={draft.isPending}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAsking(false)}
            onBlur={() => !instruction && !draft.isPending && setAsking(false)}
            placeholder={draft.isPending ? "Writing…" : "What should it say? (optional, Enter)"}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
          <ChevronDownIcon className="size-3.5 -rotate-90 text-muted-foreground" />
        </motion.form>
      )}
    </motion.div>
  );
}
