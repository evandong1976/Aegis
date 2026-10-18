#!/bin/sh
# A real Chrome download drawn in the live view (feature/download-live-view). Serves demo/ as in
# demo/README.md (plus setup.exe, a harmless "MZ" header and zeros, for a file that isn't a
# shell script), downloads one file through the built extension in headless Chrome, and lets the
# app (real Daytona, Droid when FACTORY_API_KEY is set) screenshot its live view every 2 s.
# Throwaway app profile, bridge port, downloads folder and Chrome profile under <run-dir>.
# Usage, from the repo root: sh logs/2026-10-18-download-live-view/run.sh <run-dir> <file> <out-name>
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$1"
FILE="$2"
LOG="$HERE/$3"
PORT=47398
SITE=8765
rm -rf "$RUN" "$LOG" && mkdir -p "$RUN/Downloads" "$RUN/app" "$RUN/site" "$LOG"

cp demo/*.command "$RUN/site/"
node -e "process.stdout.write(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4094)]))" > "$RUN/site/setup.exe"

pnpm -s build:extension > "$LOG/extension-build.log" 2>&1
cp -R extension/dist "$RUN/ext"
sed -i '' "s/47321/$PORT/g" "$RUN/ext/background.js" "$RUN/ext/offscreen.js" "$RUN/ext/popup.js"

python3 -m http.server "$SITE" --bind 127.0.0.1 --directory "$RUN/site" > "$LOG/site.log" 2>&1 &
SITE_PID=$!

# Dev captures never run the start-up live tests. Keys come from .env (and .env.local).
AEGIS_USER_DATA="$RUN/app" AEGIS_BRIDGE_PORT=$PORT AEGIS_DOWNLOADS_DIR="$RUN/Downloads" \
  AEGIS_CAPTURE_DIR="$LOG" AEGIS_CAPTURE_DELAY_MS=3000 AEGIS_CAPTURE_ROUTES=downloads \
  AEGIS_CAPTURE_LIVE=download \
  ./node_modules/.bin/electron-vite dev > "$LOG/app.log" 2>&1 &
APP_PID=$!
i=0
until curl -s -o /dev/null -X POST "http://127.0.0.1:$PORT/status"; do
  sleep 1; i=$((i + 1)); [ $i -gt 90 ] && echo "app never started" && break
done
sleep 6

node "$HERE/e2e.mjs" "$RUN/ext" "$LOG" "$RUN/Downloads" "$RUN/app" "http://127.0.0.1:$SITE/$FILE" 2>&1 | tee "$LOG/e2e.log"

# The capture ends a few seconds after the verdict, with status.json and log.json.
i=0
while [ ! -f "$LOG/status.json" ] && [ $i -lt 400 ]; do sleep 1; i=$((i + 1)); done
sleep 1
pkill -P "$APP_PID" 2>/dev/null; kill "$APP_PID" "$SITE_PID" 2>/dev/null

node --env-file-if-exists=.env --env-file-if-exists=.env.local "$HERE/leak-check.mjs" | tee "$LOG/leak-check.txt"
