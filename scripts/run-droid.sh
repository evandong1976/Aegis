#!/bin/sh
# usage: scripts/run-droid.sh <logfile> <title> [VAR=value ...]
# Runs scripts/try-droid.mts with Droid inside a Daytona sandbox, keys from the repo's env files,
# scrubbed from the output, which is shown and saved to <logfile>. Exits with try-droid's status.
[ $# -ge 2 ] || { echo "usage: $0 <logfile> <title> [VAR=value ...]" >&2; exit 2; }
OUT=$1; TITLE=$2; shift 2
M=$(cd "$(dirname "$0")/.." && pwd)
EF=""
for f in "$M/.env" "$M/.env.local"; do [ -f "$f" ] && EF="$EF --env-file=$f"; done
[ -n "$EF" ] || { echo "no .env or .env.local in $M" >&2; exit 2; }
DROID=${DROID_PATH:-$(command -v droid)}
[ -n "$DROID" ] || { echo "no droid CLI on PATH; install it or set DROID_PATH" >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"
STATUS=$(mktemp)
cd "$M" || exit 2
{
  echo "# $TITLE: branch $(git branch --show-current), base $(git rev-parse --short HEAD) + working tree, $(date '+%Y-%m-%d %H:%M %Z'); droid $("$DROID" --version 2>&1 | head -1) at $DROID; env files:$EF"
  t0=$(date +%s)
  env AEGIS_TRY_DROID_INSIDE=1 DROID_PATH="$DROID" "$@" node --experimental-strip-types --no-warnings=ExperimentalWarning $EF scripts/try-droid.mts 2>&1
  rc=$?; echo $rc > "$STATUS"
  echo "exit=$rc wall=$(( $(date +%s)-t0 )) s"
} | node $EF -e '
let t=require("fs").readFileSync(0,"utf8");
for (const k of ["FACTORY_API_KEY","DAYTONA_API_KEY"]) { const v=process.env[k]; if (v) t=t.split(v).join("<"+k+">") }
process.stdout.write(t)' | tee "$OUT"
rc=$(cat "$STATUS"); rm -f "$STATUS"
exit "${rc:-1}"
