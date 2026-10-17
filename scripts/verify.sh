#!/bin/sh
# Verifies what works today and writes the evidence to logs/<date-time>/:
#   environment.txt, one .log per check, results.tsv (check, exit code, expected, log),
#   bridge-smoke.log (HTTP checks against a running app), app status and scan log as JSON,
#   and screenshots of every screen (real mode and demo mode).
# Runs the app in throwaway profiles on spare ports, so it never touches a running Aegis or your
# real history, and stops only the processes it starts.
# Usage: sh scripts/verify.sh
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
STAMP=$(date +%Y-%m-%d-%H%M)
OUT="logs/$STAMP"
mkdir -p "$OUT/screens"
RESULTS="$OUT/results.tsv"
printf 'check\texit\texpected\tlog\n' > "$RESULTS"
EXT_ID=$(node -p "require('fs').readFileSync('src/shared/constants.ts','utf8').match(/EXTENSION_ID = '([a-p]{32})'/)[1]")

# step <name> <expected exit> <log file> <command...>
step() {
  name=$1
  expected=$2
  log=$3
  shift 3
  "$@" > "$OUT/$log" 2>&1
  code=$?
  printf '%s\t%s\t%s\t%s\n' "$name" "$code" "$expected" "$log" >> "$RESULTS"
  echo "$name: exit $code (expected $expected)"
}

{
  echo "date:      $(date)"
  echo "git:       $(git rev-parse --short HEAD) on $(git branch --show-current)"
  echo "node:      $(node -v)"
  echo "pnpm:      $(pnpm -v)"
  echo "electron:  $(node -p "require('electron/package.json').version")"
  echo "macOS:     $(sw_vers -productVersion) ($(uname -m))"
  echo "uncommitted changes:"
  git status --short
} > "$OUT/environment.txt"

# 1. Static checks and unit tests
step "typecheck (main, renderer, extension)" 0 typecheck.log pnpm -s typecheck
step "lint + tokens.css check" 0 lint.log pnpm -s lint
step "unit tests (vitest, verbose)" 0 tests.log pnpm -s exec vitest run --reporter=verbose

# 2. Builds
step "production build (electron-vite)" 0 build.log pnpm -s exec electron-vite build
step "extension build" 0 extension-build.log pnpm -s build:extension
step "extension ID matches the manifest key" 0 extension-id.log node -e "
  const c = require('crypto'); const m = require('./extension/dist/manifest.json');
  const id = [...c.createHash('sha256').update(Buffer.from(m.key, 'base64')).digest('hex').slice(0, 32)]
    .map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
  console.log('from manifest key:', id); console.log('in constants.ts: ', '$EXT_ID');
  process.exit(id === '$EXT_ID' ? 0 : 1)"
step "fn add-on build (node-gyp)" 0 native-build.log pnpm -s build:native
step "fn add-on loads in Electron" 0 native-load.log env ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "
  const a = require('./native/fn-key/build/Release/fn_key.node');
  console.log('exports:', Object.keys(a).join(', ')); process.exit(typeof a.start === 'function' && typeof a.stop === 'function' ? 0 : 1)"
step "build:sandbox placeholder fails loudly" 1 placeholder-sandbox.log pnpm -s build:sandbox
step "eval placeholder fails loudly" 1 placeholder-eval.log pnpm -s eval

# 3. The real app (empty history) in a throwaway profile: bridge checks, health, screenshots
PORT=47398
REAL="$OUT/screens/real"
mkdir -p "$REAL"
AEGIS_USER_DATA="$OUT/profile-real" AEGIS_BRIDGE_PORT=$PORT AEGIS_CAPTURE_DIR="$REAL" \
  AEGIS_CAPTURE_ROUTES=overview,links,downloads,report,accuracy,messages,settings \
  ./node_modules/.bin/electron-vite dev > "$OUT/app-real.log" 2>&1 &
APP=$!
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Origin: chrome-extension://$EXT_ID" "http://127.0.0.1:$PORT/status")" = 200 ] || [ $i -ge 90 ]; do
  sleep 1
  i=$((i + 1))
done

SMOKE="$OUT/bridge-smoke.log"
: > "$SMOKE"
pass=0
fail=0
# check <description> <expected status> <curl args...>
check() {
  desc=$1
  want=$2
  shift 2
  got=$(curl -s -o "$OUT/.body" -w '%{http_code}' "$@")
  body=$(head -c 160 "$OUT/.body")
  if [ "$got" = "$want" ]; then r=PASS; pass=$((pass + 1)); else r=FAIL; fail=$((fail + 1)); fi
  printf '%s  expected %s got %s  %s\n      body: %s\n' "$r" "$want" "$got" "$desc" "$body" >> "$SMOKE"
}
B="http://127.0.0.1:$PORT"
O="Origin: chrome-extension://$EXT_ID"
J="Content-Type: application/json"
check "GET /status from the Aegis extension" 200 -H "$O" "$B/status"
check "GET /status with no Origin" 403 "$B/status"
check "GET /status from a web page" 403 -H "Origin: https://evil.example" "$B/status"
check "GET /status from another extension" 403 -H "Origin: chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$B/status"
check "GET /status with a rebinding Host header" 403 -H "$O" -H "Host: evil.example:$PORT" "$B/status"
check "OPTIONS /status preflight from the extension" 204 -X OPTIONS -H "$O" "$B/status"
check "POST /ping heartbeat" 200 -X POST -H "$O" -H "$J" -d '{"extensionVersion":"0.1.0","at":"2026-10-17T00:00:00Z"}' "$B/ping"
check "POST /trust example.com" 200 -X POST -H "$O" -H "$J" -d '{"domain":"example.com"}' "$B/trust"
check "POST /trust with an empty domain" 400 -X POST -H "$O" -H "$J" -d '{"domain":""}' "$B/trust"
check "POST /page (milestone 2)" 501 -X POST -H "$O" -H "$J" -d '{}' "$B/page"
check "POST /download (milestone 3)" 501 -X POST -H "$O" "$B/download"
check "POST /inspect (milestone 7)" 501 -X POST -H "$O" -H "$J" -d '{}' "$B/inspect"
check "GET /scan/abc (milestone 3)" 501 -H "$O" "$B/scan/abc"
check "GET /nope" 404 -H "$O" "$B/nope"
rm -f "$OUT/.body"
{
  echo ""
  echo "listening sockets on port $PORT (must be 127.0.0.1 only):"
  lsof -nP -iTCP:$PORT -sTCP:LISTEN
} >> "$SMOKE"
printf 'bridge smoke (%s pass, %s fail)\t%s\t0\tbridge-smoke.log\n' "$pass" "$fail" "$fail" >> "$RESULTS"
echo "bridge smoke: $pass pass, $fail fail"

i=0
while [ ! -f "$REAL/status.json" ] && [ $i -lt 150 ]; do sleep 1; i=$((i + 1)); done
sleep 1
pkill -P "$APP" 2>/dev/null
kill "$APP" 2>/dev/null
grep -E "\[renderer (error|warning)\]" "$OUT/app-real.log" > "$OUT/renderer-errors.log"
errs=$(wc -l < "$OUT/renderer-errors.log" | tr -d ' ')
printf 'renderer console errors (real mode)\t%s\t0\trenderer-errors.log\n' "$errs" >> "$RESULTS"

# 4. Demo mode screenshots (separate profile and port via capture.sh)
sh scripts/capture.sh "$OUT/screens/demo" overview,links,downloads,report,accuracy,messages,settings > /dev/null
cp "$OUT/screens/demo/dev.log" "$OUT/app-demo.log" 2>/dev/null
rm -f "$OUT/screens/demo/dev.log"
grep -E "\[renderer (error|warning)\]" "$OUT/app-demo.log" > "$OUT/renderer-errors-demo.log"
errs=$(wc -l < "$OUT/renderer-errors-demo.log" | tr -d ' ')
printf 'renderer console errors (demo mode)\t%s\t0\trenderer-errors-demo.log\n' "$errs" >> "$RESULTS"

# Shrink screenshots so the evidence stays small in git.
for f in "$OUT"/screens/*/*.png; do sips -Z 1400 "$f" > /dev/null 2>&1; done

echo ""
echo "Evidence written to $OUT"
column -t -s "$(printf '\t')" "$RESULTS"
