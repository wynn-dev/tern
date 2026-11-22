import { useQueryClient } from "@tanstack/react-query";
import { Command, defaultFilter } from "cmdk";
import {
  ArchiveIcon, CheckIcon, InboxIcon, KeyboardIcon, MonitorIcon, MoonIcon, OctagonAlertIcon, PenSquareIcon, PlusIcon, RefreshCwIcon, ReplyIcon, SearchIcon,
  SendIcon, SettingsIcon, StarIcon, SunIcon, TagIcon, Trash2Icon,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState } from "react";
import { useAccounts } from "@/hooks/data";
import { type ThemePref, useTheme } from "@/hooks/theme";
import { useStore } from "@/lib/store";
import { CATEGORY } from "./bits";
import { checkForMail } from "./settings";

const VIEWS = [
  { view: "inbox", label: "Inbox", icon: InboxIcon },
  { view: "needs-reply", label: "Needs reply", icon: ReplyIcon },
  { view: "starred", label: "Starred", icon: StarIcon },
  { view: "sent", label: "Sent", icon: SendIcon },
  { view: "all", label: "All mail", icon: ArchiveIcon },
  { view: "spam", label: "Spam", icon: OctagonAlertIcon },
  { view: "trash", label: "Trash", icon: Trash2Icon },
];

const THEMES: { pref: ThemePref; label: string; icon: typeof SunIcon; keywords: string[] }[] = [
  { pref: "light", label: "Light theme", icon: SunIcon, keywords: ["light mode"] },
  { pref: "dark", label: "Dark theme", icon: MoonIcon, keywords: ["dark mode", "toggle dark mode"] },
  { pref: "system", label: "System theme", icon: MonitorIcon, keywords: ["match system", "automatic"] },
];

export const SEARCH_ITEM = "search all mail";
/**
 * cmdk's own ranking, with "Search all mail" always shown but below every command that
 * matches as a word or prefix ("settings", "dark", "inbox"), so Enter runs the command.
 * Loose letter-by-letter matches (around 0.15) still rank below it.
 */
export const paletteFilter = (value: string, search: string, keywords?: string[]) =>
  value === SEARCH_ITEM ? 0.5 : defaultFilter(value, search, keywords);

export function CommandPalette() {
  const qc = useQueryClient();
  const { paletteOpen, set, setView, setQuery, openCompose } = useStore();
  const { data } = useAccounts();
  const { pref, setPref } = useTheme();
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
          <Command loop filter={paletteFilter} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
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
                <Command.Item value={SEARCH_ITEM} onSelect={run(() => (setView("all"), setQuery(search)))}>
                  <SearchIcon /> Search all mail for “{search}”
                </Command.Item>
              )}
              <Group searching={!!search} heading="Actions">
                <Command.Item onSelect={run(() => openCompose())}>
                  <PenSquareIcon /> New message <Kbd k="C" />
                </Command.Item>
                <Command.Item onSelect={run(() => checkForMail(data?.accounts ?? [], qc))}>
                  <RefreshCwIcon /> Check for new mail
                </Command.Item>
                <Command.Item onSelect={run(() => set({ settingsOpen: true }))}>
                  <PlusIcon /> Add a Gmail account
                </Command.Item>
                <Command.Item onSelect={run(() => set({ settingsOpen: true }))}>
                  <SettingsIcon /> Settings <Kbd k="," />
                </Command.Item>
                <Command.Item onSelect={run(() => set({ helpOpen: true }))}>
                  <KeyboardIcon /> Keyboard shortcuts <Kbd k="?" />
                </Command.Item>
              </Group>
              <Group searching={!!search} heading="Theme">
                {THEMES.map((t) => (
                  <Command.Item key={t.pref} value={t.label} keywords={t.keywords} onSelect={run(() => setPref(t.pref))}>
                    <t.icon /> {t.label} {pref === t.pref && <CheckIcon className="ml-auto" />}
                  </Command.Item>
                ))}
              </Group>
              <Group searching={!!search} heading="Go to">
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
              </Group>
              {!!data?.accounts.length && (
                <Group searching={!!search} heading="Accounts">
                  <Command.Item value="account all" onSelect={run(() => setView(useStore.getState().view, null))}>
                    <InboxIcon /> All accounts
                  </Command.Item>
                  {data.accounts.map((a) => (
                    <Command.Item key={a.id} value={`account ${a.email}`} onSelect={run(() => setView(useStore.getState().view, a.id))}>
                      <span className="mx-[5px] size-1.5 rounded-full" style={{ background: a.color }} /> {a.email}
                    </Command.Item>
                  ))}
                </Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * A headed group, or while searching just its items: cmdk ranks the items of a group only among
 * themselves and never reorders groups, so Enter would run the first group's best match, not the best one.
 */
const Group = ({ searching, heading, children }: { searching: boolean; heading: string; children: React.ReactNode }) =>
  searching ? children : <Command.Group heading={heading}>{children}</Command.Group>;

const Kbd = ({ k }: { k: string }) => <kbd className="ml-auto">{k}</kbd>;
