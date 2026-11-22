# Tern

A fast, quiet, self-hosted mail client for all your Gmail accounts at once, with Claude doing the triage.

- **One inbox for every account.** Each one is color-coded and can be filtered on its own, and you send from whichever account you pick.
- **Fast by design.** Mail syncs into a local SQLite database with full-text search, so the UI never waits on Google. Actions show up instantly and sync in the background. The list is virtualized, and threads are prefetched when you hover them.
- **Keyboard first.** `j`/`k`, `e` to archive, `r` to reply, `⌘K` for everything else. Built with Geist, shadcn/ui and motion.
- **AI on your Claude subscription.** Claude sorts new mail into smart views (Important, Personal, Work, Finance, Travel, …), writes a one-line summary for each thread, flags the ones that need your reply, summarizes long threads and drafts replies in your voice. All of it runs through the Claude Agent SDK on your own Claude Code login, never through a pay-per-use API key unless you [point it at your own endpoint](#your-own-ai-endpoint).
- **One binary.** `tern install` sets it up as a background service (launchd on macOS, systemd on Linux).

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/wynn-dev/tern/main/install.sh | sh
```

This downloads the prebuilt binary for your machine (Linux or macOS, x64 or arm64) from the rolling [`edge` release](https://github.com/wynn-dev/tern/releases/tag/edge), which is rebuilt from every push to `main`. It checks the binary against `checksums.txt`, puts it at `~/.local/bin/tern` and runs `tern install`, which starts the background service. Run the same line again to update. To only install the binary, set `TERN_SKIP_SETUP=1`.

Or build from source with [Bun](https://bun.sh):

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

Next to each model, Settings › AI has a reasoning effort: Default, Low, Medium, High, Extra high or Max. Default sends none, so Claude Code picks the model's own default. Higher effort thinks longer, so answers are slower and use more of your Claude limits (or your endpoint's tokens). Sorting runs in the background on every new thread, so keep it on Default or Low. From the shell: `tern config ai.writeEffort high`, `tern config ai.classifyEffort low`; `""` sets either back to Default.

#### Your own AI endpoint

To use your own Anthropic-compatible endpoint and key instead of your Claude login, open *Settings → AI → Your own endpoint* and fill in:

- **Endpoint URL**, e.g. `https://llm.example.com` (Claude Code adds `/v1/messages`).
- **API key**. Tern encrypts it at rest, the same way as your Google client secret, and never sends it back to the browser or writes it to the log. Settings only show whether a key is set.
- **Send the key as** `x-api-key` (the default, like `ANTHROPIC_API_KEY`) or a `Bearer` token (like `ANTHROPIC_AUTH_TOKEN`).

The Sorting and Summaries & drafts models then become text fields, so you can type whatever names your endpoint uses. Every call still goes through Claude Code and the Agent SDK, which is why Claude Code has to be installed even with your own endpoint. *Use my Claude login instead* clears the endpoint and key. From the shell, use `tern config ai.baseUrl https://llm.example.com`, `tern config ai.apiKey <key>` and `tern config ai.keyHeader bearer`. The status dot and `tern doctor` both say which mode Tern is in.

With no endpoint set, Tern removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` from the environment Claude Code runs in, so a key or URL left over in the server's environment can't send your mail somewhere else or bill an API account.

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

New mail shows up within about 10 seconds. Tern asks Gmail for changes every 10 seconds, and also as soon as you come back to the Tern tab. Each check costs a sliver of Gmail's quota. To check less often, run `tern config sync.intervalSec 60` and then `tern restart`. `tern config sync.intervalSec 10` puts it back to the default. While Gmail is rate-limiting Tern, checks wait until Gmail allows them again, and the account says it's catching up.

Keyboard: `j/k` move · `enter` open · `e` archive · `#` trash · `s` star · `u` unread · `r` reply · `a` reply all · `c` compose · `/` search · `g i` inbox · `⌘K` commands · `?` all shortcuts.

## Develop

```sh
bun run demo           # server with three fake accounts on :7420, no Google needed
bun run dev:web        # Vite on :5173, proxies /api to :7420
bun test
bun run typecheck
```

To test `install.sh` without a release, build a binary, serve it with its checksums and point the script at that server:

```sh
bun run build:web && bun run build:embed
bun build --compile --minify --target=bun-linux-x64 src/cli/main.ts --outfile dist/release/tern-linux-x64
(cd dist/release && sha256sum tern-* > checksums.txt && python3 -m http.server 8765) &
TERN_DOWNLOAD_URL=http://127.0.0.1:8765 sh install.sh
```

See [docs/DESIGN.md](docs/DESIGN.md) for the architecture.
