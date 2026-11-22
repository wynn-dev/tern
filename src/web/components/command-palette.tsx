import { Command } from "cmdk";
import {
  ArchiveIcon, InboxIcon, KeyboardIcon, MoonIcon, OctagonAlertIcon, PenSquareIcon, PlusIcon, RefreshCwIcon, ReplyIcon, SearchIcon, SendIcon, SettingsIcon,
  StarIcon, TagIcon, Trash2Icon,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { useAccounts } from "@/hooks/data";
import { useTheme } from "@/hooks/theme";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { CATEGORY } from "./bits";

const VIEWS = [
  { view: "inbox", label: "Inbox", icon: InboxIcon },
  { view: "needs-reply", label: "Needs reply", icon: ReplyIcon },
  { view: "starred", label: "Starred", icon: StarIcon },
  { view: "sent", label: "Sent", icon: SendIcon },
  { view: "all", label: "All mail", icon: ArchiveIcon },
  { view: "spam", label: "Spam", icon: OctagonAlertIcon },
  { view: "trash", label: "Trash", icon: Trash2Icon },
];

export function CommandPalette() {
  const { paletteOpen, set, setView, setQuery, openCompose } = useStore();
  const { data } = useAccounts();
  const { toggle } = useTheme();
  const [search, setSearch] = useState("");
  const run = (fn: () => void) => () => {
    set({ paletteOpen: false });
    setSearch("");
    fn();
  };

  return (
    <D.Root open={paletteOpen} onOpenChange={(o) => set({ paletteOpen: o })}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/25 duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[18%] left-1/2 z-50 w-[580px] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl duration-150 ease-(--ease-snap) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.97]"
        >
          <D.Title className="sr-only">Command menu</D.Title>
          <Command loop className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
            <div className="flex items-center gap-2.5 border-b px-4">
              <SearchIcon className="size-4 text-muted-foreground" />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder="Type a command or search mail…"
                className="h-12 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Command.List className="scroll-thin max-h-[360px] overflow-y-auto p-1.5 [&_[cmdk-item]]:flex [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:cursor-default [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2.5 [&_[cmdk-item]]:text-[13px] [&_[cmdk-item]_svg]:size-4 [&_[cmdk-item]_svg]:text-muted-foreground [&_[cmdk-item][data-selected=true]]:bg-accent">
              <Command.Empty className="py-8 text-center text-[13px] text-muted-foreground">Nothing matches</Command.Empty>
              {search.trim() && (
                <Command.Group heading="Search">
                  <Command.Item value={`search ${search}`} onSelect={run(() => (setView("all"), setQuery(search)))}>
                    <SearchIcon /> Search all mail for “{search}”
                  </Command.Item>
                </Command.Group>
              )}
              <Command.Group heading="Actions">
                <Command.Item onSelect={run(() => openCompose())}>
                  <PenSquareIcon /> New message <Kbd k="C" />
                </Command.Item>
                <Command.Item onSelect={run(() => data?.accounts.forEach((a) => void api.sync(a.id)))}>
                  <RefreshCwIcon /> Check for new mail
                </Command.Item>
                <Command.Item onSelect={run(() => set({ settingsOpen: true }))}>
                  <PlusIcon /> Add a Gmail account
                </Command.Item>
                <Command.Item onSelect={run(toggle)}>
                  <MoonIcon /> Toggle dark mode
                </Command.Item>
                <Command.Item onSelect={run(() => set({ settingsOpen: true }))}>
                  <SettingsIcon /> Settings <Kbd k="," />
                </Command.Item>
                <Command.Item onSelect={run(() => set({ helpOpen: true }))}>
                  <KeyboardIcon /> Keyboard shortcuts <Kbd k="?" />
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Go to">
                {VIEWS.map((v) => (
                  <Command.Item key={v.view} value={`go ${v.label}`} onSelect={run(() => setView(v.view))}>
                    <v.icon /> {v.label}
                  </Command.Item>
                ))}
                {Object.entries(CATEGORY).map(([k, c]) => (
                  <Command.Item key={k} value={`go smart ${c.label}`} onSelect={run(() => setView(`category:${k}`))}>
                    <c.icon style={{ color: c.color }} /> {c.label}
                  </Command.Item>
                ))}
                {[...new Set(data?.labels.map((l) => l.name))].map((name) => (
                  <Command.Item key={name} value={`go label ${name}`} onSelect={run(() => setView(`label:${name}`))}>
                    <TagIcon /> {name}
                  </Command.Item>
                ))}
              </Command.Group>
              {!!data?.accounts.length && (
                <Command.Group heading="Accounts">
                  <Command.Item value="account all" onSelect={run(() => setView(useStore.getState().view, null))}>
                    <InboxIcon /> All accounts
                  </Command.Item>
                  {data.accounts.map((a) => (
                    <Command.Item key={a.id} value={`account ${a.email}`} onSelect={run(() => setView(useStore.getState().view, a.id))}>
                      <span className="mx-[5px] size-1.5 rounded-full" style={{ background: a.color }} /> {a.email}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

const Kbd = ({ k }: { k: string }) => <kbd className="ml-auto">{k}</kbd>;
