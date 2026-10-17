#!/bin/sh
# Dev aid: launches Aegis on the demo database in its own profile, screenshots the panel and each
# route into $1 (default /tmp/aegis-capture), then stops only the process it started.
# Usage: sh scripts/capture.sh [out-dir] [routes]
set -eu
OUT="${1:-/tmp/aegis-capture}"
ROUTES="${2:-overview,links,downloads,report,settings,accuracy,messages}"
mkdir -p "$OUT"
PROFILE="$OUT/profile"
AEGIS_DEMO=1 AEGIS_USER_DATA="$PROFILE" AEGIS_BRIDGE_PORT=47399 AEGIS_CAPTURE_DIR="$OUT" \
  AEGIS_CAPTURE_ROUTES="$ROUTES" AEGIS_CAPTURE_SCAN=invoice_oct AEGIS_CAPTURE_SCROLL="${AEGIS_CAPTURE_SCROLL:-}" \
  ./node_modules/.bin/electron-vite dev > "$OUT/dev.log" 2>&1 &
PID=$!
LAST=$(echo "$ROUTES" | tr ',' '\n' | tail -1)
if [ -n "${AEGIS_CAPTURE_SCROLL:-}" ]; then LAST="$LAST-scrolled"; fi
i=0
while [ ! -f "$OUT/$LAST.png" ] && [ $i -lt 120 ]; do sleep 1; i=$((i + 1)); done
pkill -P "$PID" 2>/dev/null || true
kill "$PID" 2>/dev/null || true
ls "$OUT"
