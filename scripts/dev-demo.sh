#!/bin/sh
# rebuild the UI and restart the demo server from source
set -e
cd "$(dirname "$0")/.."
bun run build:web >/dev/null && bun run build:embed >/dev/null
pkill -f "tern serve --demo" 2>/dev/null || true
pkill -f "main.ts serve --demo" 2>/dev/null || true
sleep 0.3
mkdir -p .data
TERN_HOME=$PWD/.data setsid nohup bun src/cli/main.ts serve --demo --port 7420 > .data/demo.log 2>&1 &
sleep 1.2
cat .data/demo.log
