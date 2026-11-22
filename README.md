# Tern

A fast, quiet, self-hosted mail client for all your Gmail accounts at once, with Claude doing the triage.

- **One inbox for every account.** Each one is color-coded and can be filtered on its own, and you send from whichever account you pick.
- **Fast by design.** Mail syncs into a local SQLite database with full-text search, so the UI never waits on Google. Actions show up instantly and sync in the background. The list is virtualized, and threads are prefetched when you hover them.
- **Keyboard first.** `j`/`k`, `e` to archive, `r` to reply, `⌘K` for everything else. Built with Geist, shadcn/ui and motion.
- **AI on your Claude subscription.** Claude sorts new mail into smart views (Important, Personal, Work, Finance, Travel, …), writes a one-line summary for each thread, flags the ones that need your reply, summarizes long threads and drafts replies in your voice. All of it runs through the Claude Agent SDK on your own Claude Code login, never through a pay-per-use API key.
- **One binary.** `tern install` sets it up as a background service (launchd on macOS, systemd on Linux).

## Install

```sh
bun install
bun run build          # → dist/tern, a single self-contained binary
./dist/tern install    # installs ~/.local/bin/tern and starts the service
```

Then open http://localhost:7420.

### Connect Google (once)

Tern talks to Gmail through *your own* Google OAuth client, so your mail only ever flows between Google, your machine and Claude.

1. Create a project at https://console.cloud.google.com/projectcreate.
2. Enable the Gmail API.
3. On the OAuth consent screen, choose **External**, add your Gmail addresses as test users, then **Publish app**. While an app is in *Testing*, Google expires its sign-ins every 7 days. Once it's published (unverified is fine for personal use), they don't expire. When you sign in you'll see an "unverified app" warning: click *Advanced → Go to Tern*.
4. Create an **OAuth client ID** of type **Web application** with the redirect URI `http://localhost:7420/oauth/callback`.
5. Run `tern setup google` (or open Settings in the app) and paste the client ID and secret.

After that, add each Gmail account from **Settings → Add Gmail account**.

**Tern on another machine (a home server, say):** keep the redirect URI on `localhost`. After you sign in, Google sends your browser to a localhost page that won't load. Copy that page's address and paste it under *Settings → "Google couldn't send you back here?"*. To skip that step, put Tern behind HTTPS and set `tern config publicUrl https://mail.example.com`, then use that URL in the redirect URI.

### Turn on AI

Install [Claude Code](https://claude.com/claude-code) on the same machine, then run `claude` once and sign in with your Claude account. Tern finds it on `PATH` and uses that login. Run `tern doctor` to check. Models are set in Settings: Haiku sorts mail, Sonnet writes.

## Use

| Command | |
|---|---|
| `tern status` | service state, URL, data dir |
| `tern open` | open in the browser |
| `tern logs -f` | follow the log |
| `tern restart` / `stop` / `start` | |
| `tern password` | require a password (do this before exposing Tern beyond localhost) |
| `tern config [key] [value]` | e.g. `tern config port 8080`, `tern config sync.initialDays 120` |
| `tern doctor` | check the service, Google and Claude |
| `tern uninstall [--purge]` | remove the service (and with `--purge`, all local data) |

Keyboard: `j/k` move · `enter` open · `e` archive · `#` trash · `s` star · `u` unread · `r` reply · `a` reply all · `c` compose · `/` search · `g i` inbox · `⌘K` commands · `?` all shortcuts.

## Develop

```sh
bun run demo           # server with three fake accounts on :7420, no Google needed
bun run dev:web        # Vite on :5173, proxies /api to :7420
bun test
bun run typecheck
```

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture.
