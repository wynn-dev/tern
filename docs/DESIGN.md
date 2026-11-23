# Tern: design

## Goals

1. Better UX than Gmail: one calm, dense, keyboard-first inbox across several Gmail accounts.
2. Instant: no spinner between you and your mail.
3. Self-contained and self-hosted: one binary, one data folder, one command to install.
4. AI that saves real time (triage, summaries, drafts) on the user's Claude subscription.

## Shape

```
 browser (React SPA) ──HTTP/SSE──▶ tern serve (Bun + Hono) ──▶ Gmail REST API (per-account OAuth)
                                        │
                                        ├── SQLite (WAL, FTS5): accounts, messages, threads, labels
                                        └── Claude Agent SDK ──▶ local `claude` CLI (user's subscription)
```

Everything ships as a single file: `bun build --compile` bundles the server, the CLI and the built web UI (embedded via `scripts/embed.ts`).

## Data and sync (`src/server/sync.ts`, `db.ts`)

- **Initial sync:** list the last `sync.initialDays` days of mail (capped at `sync.maxInitial`) plus the 200 newest spam messages, which Gmail leaves out of listings, then fetch it 8 at a time in `format=full`. Rows go into SQLite in batches, and each batch is pushed to the UI as it lands, so the inbox fills in live.
- **Incremental sync:** every `sync.intervalSec` (30 s by default), run Gmail `history.list` from the stored `historyId`. Only new messages are fetched in full. A label change only refreshes that message's labels. If the history id has expired (404), it falls back to a full resync.
- **Threads table:** a denormalised row per conversation (flags, participants, last date, AI verdict), rebuilt from its messages whenever one changes. List queries hit a single indexed table, so they never touch messages.
- **Search:** an FTS5 index over subject, sender and body, kept in sync by triggers. It does prefix matching (`invo` finds *invoice*). Search runs locally, so it's instant and works offline.
- **Tokens:** sealed with AES-256-GCM using a per-install key (`secret.key`, mode 0600).

## Actions (`actions.ts`)

Actions are optimistic twice: the UI patches its cache right away, and the server applies the change to SQLite before calling Gmail. If Gmail refuses, the labels are put back and the UI is told. Archive, trash and spam show an Undo toast.

## Triage and inbox zero (`stats.ts`, `components/inbox-zero.tsx`)

- The milestone is **zero unread in the Inbox**, per account and for All accounts; read mail may stay. An empty Inbox says "Inbox zero" instead of "Zero unread".
- Every action you take in Tern is counted toward the server's local day in SQLite. `triage_threads` holds a row per thread you cleared that day, either by reading it while it was unread in the inbox or by archiving, trashing or spamming it out of the inbox, so a thread counts once however much you do to it. Undo (`?undo=1` on the action) and Mark unread take the thread back off the count. `zero_days` records the days an action left no unread mail in the inbox, per account and `''` for All accounts. The streak is the run of zero days ending today, or ending yesterday until today is reached. `GET /api/stats?account=` serves today's count, the streak and the last 30 days.
- The client updates the counts optimistically, like the sidebar counts: cleared today ticks up and the streak gains today the moment you reach zero, without waiting for the server.
- While you triage, the list header rolls its unread count down and shows "N cleared today", with a hairline showing progress toward zero (cleared ÷ cleared + unread). Archived rows collapse out (170 ms) where they were while the rest slide up. The list has already changed by then, so the next key acts at once. Rows that come back (undo) or arrive slide in.
- The Inbox has two views, Unread (the default) and All, switched with `v` or the "Unread · All" words in the list header and remembered in `localStorage` per account and for All accounts. Unread asks the server for `?unread=1`. The thread you open stays listed, read, while it's open, even once a refetch has left it out. When you move on (j/k, Esc, or another row) it collapses out like an archived row. `j` on the last one closes it. A search lists every match, whichever view is set.
- In the Unread view, once nothing is left, the zero moment (the day's art, the date, cleared today and the streak) takes the place of the list and the reader. The header and search box stay.
- In the All view at zero, a band with the day's art tops the list, and the reader pane (with nothing open) shows the art with the date, a line, cleared today and the streak. The art is generated SVG, seeded by the day: one of five palettes (each with light and dark colours, switched by CSS variables) and one of four compositions. It plays a short entrance the first time the page reaches zero, then stays still. `prefers-reduced-motion` turns all of it off, both the CSS and motion (`MotionConfig reducedMotion="user"`).

## Live updates

There's one SSE stream, `/api/events`. Sync, AI and actions emit `{type, keys}`. The client batches events for 250 ms and then invalidates the affected React Query caches, so there's no polling.

## AI (`ai.ts`)

- Calls go through `query()` from `@anthropic-ai/claude-agent-sdk` with **no tools**, no setting sources, no persisted session and JSON-schema structured output. `ANTHROPIC_API_KEY` is removed from the child's environment, so it always uses the Claude Code login, which is the user's subscription.
- **Triage:** inbox threads from the last 14 days that haven't been classified since their latest message are sent in batches of 20, one call per batch, to keep subscription usage low. Each thread gets a category, a priority from 0 to 3, a 14-word summary and a `needs_reply` flag. A new message clears the verdict, so the thread gets re-triaged.
- **Summarize thread** and **Draft reply** run on demand with the "write" model. The draft is in the user's voice, taken from their last few sent messages in that thread.
- Prompts tell the model to ignore instructions inside emails (prompt-injection hygiene). Quoted history is stripped before sending to save tokens.

## UI (`src/web`)

- React 19, TanStack Query (cache and optimistic updates), TanStack Virtual (list), zustand (UI state), cmdk (⌘K), radix primitives styled as shadcn/ui, motion for layout and presence animations, Geist and Geist Mono.
- Motion budget: 100–250 ms with one shared ease (`cubic-bezier(.2,.9,.1,1)`) and springs with little bounce. Lists slide on removal with CSS transforms, which stays cheap even under virtualisation.
- HTML mail is rendered in a sandboxed iframe (no scripts) with a strict CSP. Remote images are blocked until you click to load them, which defeats tracking pixels. Links open in a new tab.
- The view lives in the URL (`/label/Clients/<account>/<thread>?account=…&q=…`, see `lib/route.ts`), so refresh restores it and Back/Forward move between views. zustand stays the source of truth and the URL follows it: a new folder, account, search or opened thread pushes a history entry, while j/k and search refinements replace it (coalesced, so holding j doesn't flood history). Closing a thread or clearing a search goes back to the entry it came from.
- User labels are matched by name, so a label that several accounts share is one view; spam only appears under Spam.
- Mail is marked read after 600 ms on a thread, so flicking through with j/k doesn't mark everything read.

## Updates (`update.ts`, `scripts/compile.ts`)

- Every binary has its build identity, the `main` commit and the build time, compiled in with `bun build --define`. The release workflow sets the same identity on all four binaries and publishes it as `build.json`, uploaded last, next to the binaries and `checksums.txt`.
- The server fetches `build.json` from the edge release's download URL, not the GitHub API, so checks don't count against the unauthenticated API limit. It checks 10 s after it starts and every 6 h after that, or right away when someone clicks *Check for updates*. An update exists when edge is on a different commit that was built later.
- `POST /api/update` and `tern update` share one path: download the platform asset, verify its sha256, write it to a temp file beside `~/.local/bin/tern`, then rename it over the old binary. When the service is running, its manager is checked first, a hard link keeps the old binary as `tern.old`, and the restart is requested with `systemctl --user --no-block restart` or `launchctl kickstart -k`. If that's refused, `tern.old` is renamed back. The new process deletes `tern.old` once it's up. The page sees the event stream drop and reconnect, and polls `/api/update` until the new build answers.

## Security

- Binds to `127.0.0.1` by default. `tern password` adds a password (argon2 hash, signed `SameSite=Strict` session cookie).
- Every mutating API call requires an `X-Tern: 1` header, which blocks CSRF from other origins.
- Tern never deletes mail permanently: trash goes to Gmail's Trash.

## Not yet

- Attachments in compose, rich-text compose, drafts synced to Gmail
- Gmail push (Pub/Sub) instead of the 30 s poll
- Snooze and send-later (both need a scheduler)
- Natural-language search ("receipts from Stripe last month") through Claude
- Mobile layout
