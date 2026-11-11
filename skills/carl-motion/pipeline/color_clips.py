#!/usr/bin/env python3
"""把 30 组 A/B 的所选 8 秒窗统一切成 640×360 / 30fps / 240 帧的标准片段，供动态取色和拼接验证用。
用法: python3 color_clips.py <上游参考包根> <交付根> <远端原片目录> <输出目录> [宽 高]（默认 640 360；排口播版素材用 1080 608）
- 这次 13 组：A = 上游参考包 参考视频/Sxx_A_8秒.mp4，B = 交付 完成片/Sxx_B_8s.mp4（全长 8 s）
- 其余 17 组：远端原片按索引 selected_start 起取 8 s，有 crop 先裁切（crop = [w, h, x, y]），再缩放，必要时加黑边成 16:9
- S11 的 B 原例没有视频地址：这次补做了 完成片/S11_B_8s.mp4，有它就用它；都没有时才用上游参考包静帧铺满 8 s
"""
import json, os, subprocess, sys
PKG, OUT, REM, DST = sys.argv[1:5]
W, H = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (640, 360)
os.makedirs(DST, exist_ok=True)
IDX = json.load(open(os.path.join(PKG, '30画风色序参考/30画风_颜色与来源索引.json')))
OURS = {'S06', 'S08', 'S12', 'S22', 'S23', 'S24', 'S25', 'S27', 'S28', 'S29', 'S30', 'S33', 'S34'}
VF = f'scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p'
def cut(src, dst, start=0.0, crop=None, still=False):
    vf = (f'crop={crop[0]}:{crop[1]}:{crop[2]}:{crop[3]},' if crop else '') + VF
    if still: a = ['-loop', '1', '-t', '8', '-i', src]
    else: a = ['-ss', f'{start:.4f}', '-t', '8', '-i', src]
    subprocess.run(['ffmpeg', '-v', 'error', '-y'] + a + ['-vf', vf, '-frames:v', '240', '-an', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', dst], check=True)
log = []
for x in IDX:
    sid = x['id']
    for k in ('A', 'B'):
        dst = os.path.join(DST, f'{sid}_{k}.mp4')
        if sid in OURS:
            src = os.path.join(PKG, f'参考视频/{sid}_A_8秒.mp4') if k == 'A' else os.path.join(OUT, f'完成片/{sid}_B_8s.mp4')
            cut(src, dst); log.append((sid, k, '这次成片／包内 8 秒 A'))
        else:
            c = x['cases'][k.lower()]; src = os.path.join(REM, f'{sid}_{k}.mp4')
            if os.path.exists(own := os.path.join(OUT, f'完成片/{sid}_{k}_8s.mp4')): cut(own, dst); log.append((sid, k, '这次补做成片'))   # 这次补做的优先：S11 的 B 原例没有视频，S05 的 B 换成英文讲解版
            elif os.path.exists(src): cut(src, dst, c['selected_start'], c.get('crop')); log.append((sid, k, f'远端原片 {c["selected_start"]:.2f}s 起 8 s'))
            else: cut(os.path.join(PKG, c['poster']), dst, still=True); log.append((sid, k, '无视频地址，静帧占位'))
json.dump(log, open(os.path.join(DST, 'clips_log.json'), 'w'), ensure_ascii=False, indent=1)
print(len(log), 'clips;', [l for l in log if '静帧' in l[2]])
