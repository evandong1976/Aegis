#!/bin/sh
# Tile stills/*.png into one contact sheet for review: sh sheet.sh out.png
n=$(ls stills/*.png | wc -l | tr -d ' ')
ffmpeg -y -loglevel error -pattern_type glob -i 'stills/*.png' -vf "scale=960:540,tile=2x$(( (n + 1) / 2 )):padding=6:color=white" -frames:v 1 "$1"
