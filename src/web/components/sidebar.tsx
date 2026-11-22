import { useQuery } from "@tanstack/react-query";
import {
  ArchiveIcon, InboxIcon, Loader2Icon, MoonIcon, OctagonAlertIcon, PenSquareIcon, PlusIcon, ReplyIcon, SendIcon, SettingsIcon, SparklesIcon,
  StarIcon, SunIcon, TagIcon, Trash2Icon, AlertCircleIcon,
} from "lucide-react";
import { useMemo } from "react";
import { motion } from "motion/react";
import { useAccounts } from "@/hooks/data";
import { useTheme } from "@/hooks/theme";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CATEGORY, Dot } from "./bits";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

const NAV = [
  { view: "inbox", label: "Inbox", icon: InboxIcon, kbd: "G I" },
  { view: "needs-reply", label: "Needs reply", icon: ReplyIcon, kbd: "G R" },
  { view: "starred", label: "Starred", icon: StarIcon, kbd: "G S" },
  { view: "sent", label: "Sent", icon: SendIcon, kbd: "G T" },
  { view: "all", label: "All mail", icon: ArchiveIcon, kbd: "G A" },
  { view: "spam", label: "Spam", icon: OctagonAlertIcon, kbd: "G !" },
  { view: "trash", label: "Trash", icon: Trash2Icon, kbd: "G #" },
];

function Item({
  active, onClick, children, count, layoutId = "nav-active",
}: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number; layoutId?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] transition-colors duration-75",
        active ? "text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {active && (
        <motion.span layoutId={layoutId} className="absolute inset-0 rounded-md bg-selected" transition={{ type: "spring", duration: 0.25, bounce: 0.1 }} />
      )}
      <span className="relative flex min-w-0 flex-1 items-center gap-2 [&_svg]:size-[15px] [&_svg]:shrink-0">{children}</span>
      {!!count && <span className="relative font-mono text-[11px] tabular-nums text-muted-foreground">{count}</span>}
    </button>
  );
}

export function Sidebar() {
  const { view, account, setView, openCompose, set } = useStore();
  const { data } = useAccounts();
  const { theme, toggle } = useTheme();
  const { data: ai } = useQuery({ queryKey: ["ai-status"], queryFn: api.aiStatus, refetchInterval: 15_000 });
  const accounts = data?.accounts ?? [];
  const counts = data?.counts;
  const scoped = Object.entries(counts?.accounts ?? {}).filter(([id]) => !account || id === account);
  const totalUnread = scoped.reduce((n, [, c]) => n + c.inboxUnread, 0);
  const needsReply = scoped.reduce((n, [, c]) => n + c.needsReply, 0);
  // one entry per label name: a label that several accounts have is one view across them
  const labels = useMemo(
    () => [...new Set((data?.labels ?? []).filter((l) => !account || l.account_id === account).map((l) => l.name))],
    [data?.labels, account],
  );

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <div className="flex items-center gap-2 pl-1">
          <svg viewBox="0 0 32 32" className="size-5">
            <rect width="32" height="32" rx="8" className="fill-foreground" />
            <path d="M6 20c4-1 7-4 10-9 2 4 5 7 10 8-5 0-8 1-10 5-2-3-5-4-10-4z" className="fill-background" />
          </svg>
          <span className="text-[14px] font-semibold tracking-tight">Tern</span>
        </div>
        <Tooltip label="New message" kbd="C">
          <Button size="icon-sm" variant="ghost" onClick={() => openCompose()}>
            <PenSquareIcon />
          </Button>
        </Tooltip>
      </div>

      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-2 pt-1 pb-3">
        <div className="space-y-px">
          {NAV.map((n) => (
            <Item
              key={n.view}
              active={view === n.view}
              onClick={() => setView(n.view)}
              count={n.view === "inbox" ? totalUnread : n.view === "needs-reply" ? needsReply : undefined}
            >
              <n.icon />
              {n.label}
            </Item>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium text-muted-foreground/80">
            <SparklesIcon className="size-3" /> Smart views
          </div>
          <div className="space-y-px">
            {Object.entries(CATEGORY).map(([key, c]) => (
              <Item key={key} active={view === `category:${key}`} onClick={() => setView(`category:${key}`)} count={counts?.categories[key]}>
                <c.icon style={{ color: c.color }} />
                {c.label}
              </Item>
            ))}
          </div>
        </div>

        {!!labels.length && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-medium text-muted-foreground/80">
              <TagIcon className="size-3" /> Labels
            </div>
            <div className="space-y-px">
              {labels.map((name) => (
                <Item key={name} active={view === `label:${name}`} onClick={() => setView(`label:${name}`)}>
                  <TagIcon />
                  <span className="truncate">{name}</span>
                </Item>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-medium text-muted-foreground/80">
            Accounts
            <Tooltip label="Add a Gmail account">
              <button className="rounded p-0.5 hover:bg-accent hover:text-foreground" onClick={() => set({ settingsOpen: true })}>
                <PlusIcon className="size-3.5" />
              </button>
            </Tooltip>
          </div>
          <div className="space-y-px">
            <Item active={account === null} layoutId="acct-active" onClick={() => setView(view, null)}>
              <span className="flex size-[15px] items-center justify-center">
                <span className="grid grid-cols-2 gap-[2px]">
                  {accounts.slice(0, 4).map((a) => (
                    <span key={a.id} className="size-[5px] rounded-full" style={{ background: a.color }} />
                  ))}
                </span>
              </span>
              All accounts
            </Item>
            {accounts.map((a) => (
              <Item
                key={a.id}
                active={account === a.id}
                layoutId="acct-active"
                onClick={() => setView(view, a.id)}
                count={counts?.accounts[a.id]?.inboxUnread}
              >
                <span className="flex size-[15px] items-center justify-center">
                  {a.status === "syncing" ? (
                    <Loader2Icon className="!size-3 animate-spin" style={{ color: a.color }} />
                  ) : a.status === "error" ? (
                    <AlertCircleIcon className="!size-3.5 text-destructive" />
                  ) : (
                    <Dot color={a.color} />
                  )}
                </span>
                <span className="truncate">{a.email}</span>
              </Item>
            ))}
          </div>
        </div>
      </nav>

      <div className="flex items-center gap-1 border-t px-2 py-2">
        <Tooltip label="Settings" kbd=",">
          <Button size="icon-sm" variant="ghost" onClick={() => set({ settingsOpen: true })}>
            <SettingsIcon />
          </Button>
        </Tooltip>
        <Tooltip label={theme === "dark" ? "Light mode" : "Dark mode"}>
          <Button size="icon-sm" variant="ghost" onClick={toggle}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>
        </Tooltip>
        <div className="flex-1" />
        <Tooltip
          label={!ai?.enabled ? "AI is off" : !ai.claudePath ? "Install Claude Code to turn on AI" : (ai.lastError ?? `Claude: ${ai.claudePath}`)}
          side="top"
        >
          <div className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                !ai?.enabled || !ai?.claudePath
                  ? "bg-muted-foreground/40"
                  : ai.lastErrorCode === "rate_limited"
                    ? "bg-amber-500"
                    : ai.lastError
                      ? "bg-red-500"
                      : "bg-emerald-500",
                ai?.busy && "animate-pulse",
              )}
            />
            {ai?.busy ? "Sorting…" : "AI"}
          </div>
        </Tooltip>
      </div>
    </aside>
  );
}
