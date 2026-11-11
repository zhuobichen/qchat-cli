#!/usr/bin/env bash
# carl-motion engine entry · Chinese Ink Wash
# Usage: render.sh <work_dir>
# Writes the final 240 frames to <work_dir>/frames/0001.png … 0240.png (1920×1080).
# Encode and check them with (<skill> = the carl-motion skill folder): python3 <skill>/scripts/deliver.py --frames <work_dir>/frames --out <clip.mp4>
set -euo pipefail
WORK="$(mkdir -p "${1:?usage: render.sh <work_dir>}" && cd "$1" && pwd)"
cd "$(dirname "$0")"
JOBS="${JOBS:-8}" python3 scene.py "$WORK/frames"
