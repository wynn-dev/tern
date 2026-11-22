#!/bin/sh
# Install Tern from its prebuilt edge release:
#
#   curl -fsSL https://raw.githubusercontent.com/wynn-dev/tern/main/install.sh | sh
#
# Downloads the binary for this machine, checks it against checksums.txt, puts
# it at ~/.local/bin/tern and runs `tern install`, which starts the background
# service. Run it again to update.
#
#   TERN_DOWNLOAD_URL  where to fetch tern-<os>-<arch> and checksums.txt from
#                      (for testing; default: the edge release on GitHub)
#   TERN_SKIP_SETUP=1  only install the binary, don't run `tern install`
set -eu

base_url="${TERN_DOWNLOAD_URL:-https://github.com/wynn-dev/tern/releases/download/edge}"
# `tern install` copies itself here and the service runs from here, so the
# binary goes straight to it rather than leaving a second copy elsewhere
bin_dir="$HOME/.local/bin"
bin="$bin_dir/tern"

say() { printf '%s\n' "$*"; }
fail() { printf 'tern install: %s\n' "$*" >&2; exit 1; }

os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported OS: $os. Prebuilt binaries are for Linux and macOS; on anything else, build from source (see the README)." ;;
esac
case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "unsupported CPU: $arch. Prebuilt binaries are for x64 and arm64; on anything else, build from source (see the README)." ;;
esac
# a shell under Rosetta reports x86_64 on Apple silicon; use the native build
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then
  arch=arm64
fi
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  fail "this looks like a musl system (Alpine?). The Linux binaries need glibc; build from source instead (see the README)."
fi
asset="tern-$os-$arch"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  fail "needs curl or wget to download Tern; install one and run this again."
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "needs sha256sum or shasum to verify the download; install one and run this again."
fi

tmp=$(mktemp -d 2>/dev/null || mktemp -d -t tern)
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

say "Downloading $asset from $base_url"
fetch "$base_url/$asset" "$tmp/tern" || fail "couldn't download $base_url/$asset"
fetch "$base_url/checksums.txt" "$tmp/checksums.txt" || fail "couldn't download $base_url/checksums.txt"

want=$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/checksums.txt")
[ -n "$want" ] || fail "checksums.txt has no entry for $asset"
got=$(sha256 "$tmp/tern")
[ "$got" = "$want" ] || fail "checksum mismatch for $asset (expected $want, got $got). Try again; if it keeps failing, please open an issue."

updating=false
[ -e "$bin" ] && updating=true
mkdir -p "$bin_dir"
chmod 755 "$tmp/tern"
# move over the old binary so a running service keeps its file
mv -f "$tmp/tern" "$bin"
say "Installed tern $("$bin" version 2>/dev/null || true) to $bin"

path_hint() {
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) say "Add $bin_dir to your PATH to run \`tern\` from anywhere:  export PATH=\"$bin_dir:\$PATH\"" ;;
  esac
}

if [ "${TERN_SKIP_SETUP:-}" = 1 ]; then
  path_hint
  say "Run \`$bin install\` to start Tern as a background service, or \`$bin serve\` to run it in the foreground."
  exit 0
fi

# Tern's own installer writes the systemd/launchd service and starts it. Give it
# the terminal so it can offer to set up Google, even when piped from curl.
say ""
if [ -t 1 ] && (: </dev/tty) 2>/dev/null; then
  "$bin" install </dev/tty || setup_failed=1
else
  "$bin" install </dev/null || setup_failed=1
fi
if [ -n "${setup_failed:-}" ]; then
  fail "the binary is installed, but \`tern install\` couldn't set up the background service (see above). Fix that and run \`$bin install\` again, or run \`$bin serve\` in the foreground."
fi
# `tern install` doesn't restart a systemd service that's already running
if $updating && [ "$os" = linux ]; then
  "$bin" restart >/dev/null 2>&1 || true
fi

say ""
say "If you haven't yet, connect Google with \`tern setup google\` (once), then add your Gmail accounts in Settings."
say "Guide: https://github.com/wynn-dev/tern#connect-google-once"
