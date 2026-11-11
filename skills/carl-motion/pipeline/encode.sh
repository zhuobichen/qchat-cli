#!/usr/bin/env bash
# 用法: encode.sh <PNG帧目录(0001.png..0240.png)> <输出mp4>
set -euo pipefail
IN="$1"; OUT="$2"
n=$(ls "$IN"/*.png | wc -l | tr -d ' ')
[ "$n" -ge 240 ] || { echo "只有 $n 帧，需要 240" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"
ffmpeg -hide_banner -loglevel error -y -framerate 30 -start_number 1 -i "$IN/%04d.png" \
  -frames:v 240 -vf "scale=1920:1080:flags=lanczos,format=yuv420p" -an \
  -c:v libx264 -preset slow -crf 16 -profile:v high -r 30 -movflags +faststart "$OUT"
echo "ENCODED $OUT"
