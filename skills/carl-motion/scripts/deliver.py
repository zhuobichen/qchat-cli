#!/usr/bin/env python3
"""carl-motion delivery gate: frames (or an MP4) in, a red / yellow / green verdict out.

    python3 deliver.py --frames <work_dir>/frames --out clip.mp4 [--crf 16] [--palette "#e8541e,#1d3557"] [--ref A.mp4]
    python3 deliver.py --video clip_raw.mp4 --out clip.mp4

House spec: 1920×1080, 30 fps, exactly 240 frames (8.000 s), H.264 High, yuv420p, no audio.
  red     spec broken, wrong frame count, black frames, decode errors. Nothing is copied to --out. Exit 2.
  yellow  plays fine but needs a human look: jump frames, long still runs. Clip is written. Exit 1.
  info    printed only, never changes the verdict: palette distance from --palette.
  green   clip is written. Exit 0.
The report (contact sheet at 0.5/2/4/6/7.5 s, numbers, delivery.md) goes to <out>.qa/ next to the clip.
Needs: Python 3.9+, numpy, opencv-python, ffmpeg/ffprobe on PATH. No A reference is required.
"""
import argparse, glob, json, os, shutil, subprocess, sys, tempfile
import numpy as np
import cv2

W, H, FPS, N = 1920, 1080, 30, 240
TIMES = [0.5, 2, 4, 6, 7.5]


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def encode(frames, dst, crf):
    r = run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-start_number', '1',
             '-i', os.path.join(frames, '%04d.png'), '-frames:v', str(N), '-vf', f'scale={W}:{H}:flags=lanczos,format=yuv420p',
             '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-profile:v', 'high', '-r', str(FPS),
             '-movflags', '+faststart', dst])
    return r.returncode == 0, r.stderr.strip()


def probe(p):
    r = run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries',
             'stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', p])
    d = json.loads(r.stdout or '{}'); st = d.get('streams', [])
    v = next((s for s in st if s['codec_type'] == 'video'), {})
    return {'width': v.get('width'), 'height': v.get('height'), 'codec': v.get('codec_name'), 'profile': v.get('profile'),
            'pix_fmt': v.get('pix_fmt'), 'fps': v.get('r_frame_rate'), 'frames': int(v.get('nb_read_frames') or 0),
            'duration': float(d.get('format', {}).get('duration') or 0), 'audio': sum(s['codec_type'] == 'audio' for s in st)}


def gray_frames(p, w=192, h=108):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-vf', f'scale={w}:{h},format=gray', '-f', 'rawvideo', '-'], capture_output=True)
    return np.frombuffer(r.stdout, np.uint8).reshape(-1, h, w).astype(np.float32)


def hex2lab(h):
    h = h.strip().lstrip('#'); bgr = np.uint8([[[int(h[4:6], 16), int(h[2:4], 16), int(h[0:2], 16)]]])
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[0, 0].astype(np.float32)


def palette_drift(clip, palette):
    """Smallest Lab distance from each palette colour to the clip's 4 s frame, after a small k-means."""
    cap = cv2.VideoCapture(clip); cap.set(cv2.CAP_PROP_POS_FRAMES, 120); ok, fr = cap.read()
    if not ok: return None
    px = cv2.cvtColor(cv2.resize(fr, (160, 90)), cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32)
    _, _, centers = cv2.kmeans(px, 8, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 3, cv2.KMEANS_PP_CENTERS)
    return {h: round(float(np.linalg.norm(centers - hex2lab(h), axis=1).min()), 1) for h in palette}


def contact(clip, dst):
    cap = cv2.VideoCapture(clip); tiles = []
    for t in TIMES:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * FPS)); ok, fr = cap.read()
        fr = fr if ok else np.zeros((H, W, 3), np.uint8)
        fr = cv2.resize(fr, (480, 270)); cv2.putText(fr, f'{t}s', (10, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        tiles.append(fr)
    cv2.imwrite(dst, np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 85])


def main():
    ap = argparse.ArgumentParser(description='carl-motion delivery gate')
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument('--frames', help='folder with 0001.png … 0240.png')
    src.add_argument('--video', help='an already encoded clip to check (re-encoded to the house spec)')
    ap.add_argument('--out', required=True, help='where the delivered MP4 goes (only on green or yellow)')
    ap.add_argument('--crf', type=int, default=16)
    ap.add_argument('--palette', default='', help='comma-separated hex colours from the style card')
    ap.add_argument('--ref', help='optional A reference clip, for a motion comparison')
    a = ap.parse_args()

    out = os.path.abspath(a.out); rep = out + '.qa'; os.makedirs(rep, exist_ok=True)
    red, yellow, info, fixes, res = [], [], [], [], {}
    tmp = tempfile.mkdtemp(prefix='carl-motion-')
    clip = os.path.join(tmp, 'clip.mp4')

    if a.frames:
        pngs = sorted(glob.glob(os.path.join(a.frames, '[0-9][0-9][0-9][0-9].png')))
        want = [os.path.join(a.frames, f'{i:04d}.png') for i in range(1, N + 1)]
        missing = [os.path.basename(p) for p in want if p not in set(pngs)]
        res['frames_found'] = len(pngs)
        if missing:
            red.append(f'{len(missing)} of 240 frames missing (first: {missing[0]})')
            fixes.append('Re-run the engine; it must write 0001.png … 0240.png into one folder.')
        else:
            for p in (want[0], want[-1]):
                im = cv2.imread(p)
                if im is None or im.shape[:2] != (H, W):
                    red.append(f'{os.path.basename(p)} is {None if im is None else im.shape[1::-1]}, not 1920×1080')
                    fixes.append('Render at 1920×1080; do not rely on the encoder to rescale.')
                    break
        if not red:
            ok, err = encode(a.frames, clip, a.crf)
            if not ok: red.append(f'encode failed: {err[:200]}'); fixes.append('Check ffmpeg is installed and the PNGs are readable.')
    else:
        r = run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', a.video, '-frames:v', str(N), '-vf',
                 f'scale={W}:{H}:flags=lanczos,format=yuv420p', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', str(a.crf),
                 '-profile:v', 'high', '-r', str(FPS), '-movflags', '+faststart', clip])
        if r.returncode: red.append(f're-encode failed: {r.stderr.strip()[:200]}')

    if not red:
        s = probe(clip); res['spec'] = s
        bad = [k for k, ok in [('size', (s['width'], s['height']) == (W, H)), ('codec', s['codec'] == 'h264'), ('pix_fmt', s['pix_fmt'] == 'yuv420p'),
                               ('fps', s['fps'] == '30/1'), ('frames', s['frames'] == N), ('duration', abs(s['duration'] - 8) < 1e-3),
                               ('audio', s['audio'] == 0)] if not ok]
        if bad: red.append('spec off: ' + ', '.join(f'{k}={s.get(k)}' for k in bad)); fixes.append('The source must be exactly 240 frames at 30 fps.')
        dec = run(['ffmpeg', '-v', 'error', '-xerror', '-i', clip, '-f', 'null', '-'])
        if dec.returncode or dec.stderr.strip(): red.append('full decode reported errors')

        g = gray_frames(clip); diff = np.abs(np.diff(g, axis=0)).mean(axis=(1, 2))
        black = [int(i) + 1 for i in np.where(g.mean(axis=(1, 2)) < 6)[0]]
        jumps = [int(i) + 2 for i in np.where((diff > 6 * np.median(diff)) & (diff > 8))[0]]
        still = best = 0
        for d in diff: still = still + 1 if d < 0.02 else 0; best = max(best, still)
        res['motion'] = {'mean_absdiff': round(float(diff.mean()), 3), 'black_frames': black, 'jump_frames': jumps, 'longest_still_run': best}
        if black: red.append(f'{len(black)} black frames (first: {black[0]})'); fixes.append('Something drew nothing on those frames; check the start time and the first beat.')
        if jumps: yellow.append(f'jump frames {jumps[:8]}{" …" if len(jumps) > 8 else ""}: fine if they are designed cuts or beat changes, say which')
        if best >= 15: yellow.append(f'{best} frames in a row with no visible change: the clip may read as frozen')
        if a.palette:
            drift = palette_drift(clip, [x for x in a.palette.split(',') if x.strip()]); res['palette_drift'] = drift
            far = {k: v for k, v in (drift or {}).items() if v > 25}
            if far: info.append(f'palette at 4 s is far from the card colours (Lab ΔE > 25): {far}. The card palette is sampled from the example clips, so this is a hint, not a fault.')
        if a.ref:
            ga = gray_frames(a.ref); res['ref_mean_absdiff'] = round(float(np.abs(np.diff(ga, axis=0)).mean()), 3)
        contact(clip, os.path.join(rep, 'contact.jpg'))

    verdict = 'red' if red else 'yellow' if yellow else 'green'
    res.update(verdict=verdict, red=red, yellow=yellow, info=info)
    json.dump(res, open(os.path.join(rep, 'report.json'), 'w'), ensure_ascii=False, indent=1)
    if verdict != 'red':
        os.makedirs(os.path.dirname(out), exist_ok=True); shutil.move(clip, out)
        lines = [f'# Delivery · {os.path.basename(out)}', '', f'Verdict: **{verdict}**', '',
                 f'Spec: {res["spec"]["width"]}×{res["spec"]["height"]}, {res["spec"]["fps"]} fps, {res["spec"]["frames"]} frames, {res["spec"]["duration"]:.3f} s, H.264 {res["spec"]["pix_fmt"]}, no audio.',
                 f'Motion: mean frame difference {res["motion"]["mean_absdiff"]}, longest still run {res["motion"]["longest_still_run"]} frames.', '',
                 'Needs a human look:' if yellow else 'Nothing flagged.'] + [f'- {y}' for y in yellow] + [f'- info: {i_}' for i_ in info] + ['', 'Contact sheet: contact.jpg (0.5 / 2 / 4 / 6 / 7.5 s).']
        open(os.path.join(rep, 'delivery.md'), 'w').write('\n'.join(lines) + '\n')
    shutil.rmtree(tmp, ignore_errors=True)

    mark = {'green': 'GREEN', 'yellow': 'YELLOW', 'red': 'RED'}[verdict]
    print(f'{mark}  {out if verdict != "red" else "(not delivered)"}')
    for r_ in red: print(f'  red: {r_}')
    for y in yellow: print(f'  yellow: {y}')
    for i_ in info: print(f'  info: {i_}')
    for f_ in dict.fromkeys(fixes): print(f'  fix: {f_}')
    print(f'  report: {rep}')
    sys.exit({'green': 0, 'yellow': 1, 'red': 2}[verdict])


if __name__ == '__main__':
    main()
