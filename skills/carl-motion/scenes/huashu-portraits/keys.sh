#!/usr/bin/env bash
# 关键帧预览：0.5/2/4/6/7.5 s 拼成一张。用法: ./keys.sh <场景名> <输出jpg>
set -euo pipefail
cd "$(dirname "$0")"
K=$(mktemp -d)
node render.cjs "$1" "$K" 15,60,120,180,225 >/dev/null
ffmpeg -v error -y -i "$K/0016.png" -i "$K/0061.png" -i "$K/0121.png" -i "$K/0181.png" -i "$K/0226.png" -filter_complex \
 "[0]scale=960:540[a];[1]scale=960:540[b];[2]scale=960:540[c];[3]scale=960:540[d];[4]scale=960:540[e];color=black:s=960x540,trim=end_frame=1[f];[a][b]hstack[r1];[c][d]hstack[r2];[e][f]hstack[r3];[r1][r2][r3]vstack=inputs=3" \
 -frames:v 1 "$2"
cp "$K/0121.png" "${2%.jpg}_4s.png"
rm -rf "$K"
echo "$2"
