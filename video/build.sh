#!/bin/sh
# Builds the Aegis product video: narration → score and mix → frames → MP4s.
# Usage: ./build.sh            (regenerates the scratch narration with macOS `say`)
#        ./build.sh --keep-vo  (keeps build/vo/*.aiff, e.g. a recorded voiceover)
set -eu
cd "$(dirname "$0")"
mkdir -p build/vo

if [ "${1:-}" != "--keep-vo" ]; then
  while IFS='|' read -r id text; do
    say -v Samantha -r 182 -o "build/vo/$id.aiff" "$text"
  done <<'EOF'
01|Every day, you click hundreds of links, and download files you've never seen before.
02|Most security tools wait until a file is already on your Mac, and only catch threats they've seen before.
03|Meet Aegis. It checks every link and every download, before it reaches you.
04a|Each one gets a verdict.
04b|Malicious.
04c|Suspicious.
04d|Unknown.
04e|Or clean.
05a|Phishing links are stopped at the click, and judged without ever being opened.
05b|Domain age.
05c|Lookalike brands.
05d|Safe Browsing.
05e|And certificate records.
06|Risky downloads are held in memory, before they ever touch your disk.
07a|Then two independent AI analysts take it apart at once, each in its own throwaway sandbox, with the network switched off.
07b|Factory Droid, on Daytona.
07c|And Chalk, on Chalk Compute.
08|Aegis compares their answers. The more severe one wins, and AI can only raise a verdict, never lower it.
09|Then it explains what would have happened, in plain English, with the exact code that does it.
10|On your phone? Text Aegis a screenshot, and get a verdict back in seconds.
11|Everything lives in your menu bar. Always watching, never in the way.
12|Aegis. Know before you click.
EOF
fi

node audio.mjs
../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron render.cjs build/silent.mp4 30
for v in "mix aegis-promo" "mix_novo aegis-promo-no-vo"; do
  set -- $v
  ffmpeg -y -loglevel error -i build/silent.mp4 -i "build/$1.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$2.mp4"
  echo "wrote video/$2.mp4"
done
