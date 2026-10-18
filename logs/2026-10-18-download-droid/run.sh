#!/bin/sh
# Download end-to-end run with Droid as the analyst (feature/aiSec; adapted from
# ../2026-10-17-download-e2e/). Throwaway app profile, bridge port, downloads folder and
# Chrome profile under $RUN (outside the repo); evidence in this folder.
# Usage, from the repo root: sh logs/2026-10-17-download-e2e/run.sh <run-dir>
set -u
LOG="$(cd "$(dirname "$0")" && pwd)"
RUN="$1"
PORT=47398
SITE=8766
rm -rf "$RUN" && mkdir -p "$RUN/Downloads" "$RUN/app"
rm -f "$LOG"/*.png "$LOG"/*.txt "$LOG"/*.json "$LOG"/*.log

# An old file already in the folder: the watcher must leave it alone even when it changes.
echo "old notes" > "$RUN/Downloads/old-notes.txt"
touch -t 202601010000 "$RUN/Downloads/old-notes.txt"

pnpm -s build:extension > "$LOG/extension-build.log" 2>&1
cp -R extension/dist "$RUN/ext"
sed -i '' "s/47321/$PORT/g" "$RUN/ext/background.js" "$RUN/ext/offscreen.js" "$RUN/ext/popup.js"

node "$LOG/server.mjs" "$SITE" "$(pwd)" > "$LOG/site.log" 2>&1 &
SITE_PID=$!

# FACTORY_API_KEY stays set: Droid analyses each download that needs the cloud. Dev captures never
# run the start-up live tests. Keys come from .env (and .env.local if present).
AEGIS_USER_DATA="$RUN/app" AEGIS_BRIDGE_PORT=$PORT AEGIS_DOWNLOADS_DIR="$RUN/Downloads" \
  AEGIS_CAPTURE_DIR="$LOG" AEGIS_CAPTURE_DELAY_MS=330000 AEGIS_CAPTURE_ROUTES=downloads,report \
  AEGIS_CAPTURE_SCAN=aegis-terminal-demo \
  ./node_modules/.bin/electron-vite dev > "$LOG/app.log" 2>&1 &
APP_PID=$!
i=0
until curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/status"; do
  sleep 1; i=$((i + 1)); [ $i -gt 90 ] && echo "app never started" && break
done
sleep 3


node "$LOG/e2e.mjs" "$RUN/ext" "$LOG" "$RUN/Downloads" "$RUN/app" "$SITE" 2>&1 | tee "$LOG/e2e.log"

# Let the capture (screenshots, status.json, log.json) finish, then stop what this script started.
i=0
while [ ! -f "$LOG/status.json" ] && [ $i -lt 400 ]; do sleep 1; i=$((i + 1)); done
sleep 1
pkill -P "$APP_PID" 2>/dev/null; kill "$APP_PID" "$SITE_PID" 2>/dev/null

node --env-file-if-exists=.env --env-file-if-exists=.env.local "$LOG/leak-check.mjs" | tee "$LOG/leak-check.txt"
