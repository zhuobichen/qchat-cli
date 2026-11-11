#!/usr/bin/env bash
# carl-motion engine entry · White-model Projection (Blender)
# Usage: render.sh <work_dir>
# Writes the final 240 frames to <work_dir>/frames/0001.png … 0240.png (1920×1080).
# Encode and check them with (<skill> = the carl-motion skill folder): python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out <clip.mp4>
set -euo pipefail
WORK="$(mkdir -p "${1:?usage: render.sh <work_dir>}" && cd "$1" && pwd)"
cd "$(dirname "$0")"
python3 project.py "$WORK/proj"
blender -b -P scene.py -- "$WORK/raw" "$WORK/proj" 0 239 1 100 32
python3 overlay.py "$WORK/raw" "$WORK/frames"
