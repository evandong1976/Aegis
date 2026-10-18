#!/bin/sh
# Builds the combined Aegis product video from cut.json: frames -> soundtrack -> both MP4s.
# Usage: sh build.sh            (resumes from frames/cut; delete it after editing a scene)
#        sh build.sh --audio    (soundtrack and mux only, e.g. after recording a real voiceover)
set -eu
cd "$(dirname "$0")"
[ "${1:-}" = "--audio" ] || node cut.mjs
python3 score.py
for pair in "mix_vo:aegis-product-video.mp4" "mix_novo:aegis-product-video-no-vo.mp4"; do
  mix=${pair%%:*}; out=${pair#*:}
  ffmpeg -y -loglevel error -i build-silent.mp4 -i "audio/build/$mix.wav" -map 0:v -map 1:a -c:v copy \
    -af "loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000" -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart "$out"
  echo "wrote video/$out"
done
