#!/usr/bin/env python3
"""Check this machine can render a carl-motion engine before you start.

    python3 doctor.py                 # base tools: python, numpy, opencv, Pillow, ffmpeg
    python3 doctor.py risograph       # plus what scenes/risograph/engine.json asks for
    python3 doctor.py --all           # every engine, one line each

Exit 0 when everything required is present, 1 otherwise. Missing fonts are warnings:
the engines fall back to a default face, which changes the look but not the render.
"""
import importlib, json, os, re, shutil, subprocess, sys

SKILL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMPORT = {'opencv-python': 'cv2', 'opencv-python-headless': 'cv2', 'Pillow': 'PIL', 'numpy': 'numpy', 'scipy': 'scipy', 'openpyxl': 'openpyxl'}
BASE = {'pip': ['numpy', 'opencv-python', 'Pillow'], 'binaries': ['ffmpeg', 'ffprobe']}


def version(cmd, pat):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout
        m = re.search(pat, out); return m.group(1) if m else '?'
    except Exception:
        return None


def check(req, fonts=()):
    miss, warn = [], []
    if sys.version_info < (3, 9): miss.append(f'python >= 3.9 (have {sys.version.split()[0]})')
    for pkg in req.get('pip') or []:
        try: importlib.import_module(IMPORT.get(pkg, pkg))
        except Exception: miss.append(f'pip install {pkg}')
    for b in req.get('binaries') or []:
        if not shutil.which(b): miss.append(f'{b} on PATH')
    if req.get('blender'):
        v = version(['blender', '-b', '--version'], r'Blender (\d+\.\d+)') if shutil.which('blender') else None
        if not v: miss.append(f'blender {req["blender"]} on PATH')
        elif v != req['blender']: warn.append(f'blender {v} (built with {req["blender"]}; output may differ)')
    if req.get('node'):
        v = version(['node', '--version'], r'v(\d+)') if shutil.which('node') else None
        need = int(re.sub(r'\D', '', req['node']) or 0)
        if not v or v == '?' or int(v) < need: miss.append(f'node {req["node"]}')
    for f in fonts:
        if f.startswith('/') and not os.path.exists(f): warn.append(f'font not found: {f}')
    return miss, warn


def engine(slug):
    p = os.path.join(SKILL, 'scenes', slug, 'engine.json')
    if not os.path.exists(p): sys.exit(f'no engine "{slug}" (looked for {p})')
    return json.load(open(p))


def report(name, miss, warn):
    print(('OK   ' if not miss else 'MISS ') + name)
    for m in miss: print(f'     missing: {m}')
    for w in warn: print(f'     note:    {w}')


if __name__ == '__main__':
    args = sys.argv[1:]
    bad = False
    m, w = check(BASE); report('base tools', m, w); bad |= bool(m)
    slugs = sorted(os.listdir(os.path.join(SKILL, 'scenes'))) if args == ['--all'] else args
    for s in slugs:
        e = engine(s); m, w = check(e.get('requires', {}), e.get('fonts', [])); report(f'{s} ({e.get("stack")})', m, w); bad |= bool(m)
    sys.exit(1 if bad else 0)
