#!/bin/sh
# Combine the rendered picture with each mix, loudness-normalised to -14 LUFS (streaming standard).
set -e
cd "$(dirname "$0")"
for pair in "mix_vo:aegis-product-video.mp4" "mix_novo:aegis-product-video-no-vo.mp4"; do
  mix=${pair%%:*}; out=${pair#*:}
  ffmpeg -y -loglevel error -i build-silent.mp4 -i "audio/build/$mix.wav" \
    -map 0:v -map 1:a -c:v copy \
    -af "loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000" -c:a aac -b:a 256k -ar 48000 \
    -shortest -movflags +faststart "$out"
  echo "$out"
done
