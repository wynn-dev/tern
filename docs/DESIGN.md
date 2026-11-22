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

- **Initial sync:** list the last `sync.initialDays` days of mail (capped at `sync.maxInitial`), then fetch it 8 at a time in `format=full`. Rows go into SQLite in batches, and each batch is pushed to the UI as it lands, so the inbox fills in live.
- **Incremental sync:** every `sync.intervalSec` (30 s by default), run Gmail `history.list` from the stored `historyId`. Only new messages are fetched in full. A label change only refreshes that message's labels. If the history id has expired (404), it falls back to a full resync.
- **Threads table:** a denormalised row per conversation (flags, participants, last date, AI verdict), rebuilt from its messages whenever one changes. List queries hit a single indexed table, so they never touch messages.
- **Search:** an FTS5 index over subject, sender and body, kept in sync by triggers. It does prefix matching (`invo` finds *invoice*). Search runs locally, so it's instant and works offline.
- **Tokens:** sealed with AES-256-GCM using a per-install key (`secret.key`, mode 0600).

## Actions (`actions.ts`)

Actions are optimistic twice: the UI patches its cache right away, and the server applies the change to SQLite before calling Gmail. If Gmail refuses, the labels are put back and the UI is told. Archive, trash and spam show an Undo toast.

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
- Mail is marked read after 600 ms on a thread, so flicking through with j/k doesn't mark everything read.

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
