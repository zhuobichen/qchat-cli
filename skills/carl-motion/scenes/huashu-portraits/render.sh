#!/usr/bin/env bash
# carl-motion engine entry · Egyptian mural / Van Gogh / Monet (Node + canvas)
# Usage: render.sh <work_dir> <s22_egypt|s23_wheat|s24_bridge>
# Writes the final 240 frames to <work_dir>/frames/0001.png … 0240.png (1920×1080).
# Encode and check them with (<skill> = the carl-motion skill folder): python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out <clip.mp4>
set -euo pipefail
WORK="$(mkdir -p "${1:?usage: render.sh <work_dir> <s22_egypt|s23_wheat|s24_bridge>}" && cd "$1" && pwd)"
cd "$(dirname "$0")"
SCENE="${2:?usage: render.sh <work_dir> <s22_egypt|s23_wheat|s24_bridge>}"
[ -d node_modules ] || npm ci --silent
rm -rf "$WORK/frames"
node render.cjs "$SCENE" "$WORK/frames"
