#!/usr/bin/env python3
"""按 v3 顺序拼出 9:16 全序预览（上层 A、中层 B、底部留口播区），并在拼好的成品上逐切点复测颜色。
用法: python3 color_stitch_verify.py <交付根> <标准片段目录> <临时目录> [版本，默认 v3；v4 读 色序_v4_实测数据.json]
输出（交付根/色序/）：
  色序v3_全序预览_9x16.mp4   540×960 / 30fps / 30×8 s = 240 s，仅供看色序，不是成片
  色序v3_切点验证.csv        每个切点：切前末 0.5 s 和切后首 0.5 s，上层、中层分别重新取色
  色序v3_切点总览_1.jpg / _2.jpg  每个切点切前末帧和切后首帧的上层、中层并排
"""
import csv, json, os, subprocess, sys, math
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont
OUT, CL, TMP = sys.argv[1:4]; V = sys.argv[4] if len(sys.argv) > 4 else 'v3'
os.makedirs(TMP, exist_ok=True)
D = json.load(open(os.path.join(OUT, f'色序/色序_{V}_实测数据.json'))); S = {s['id']: s for s in D['styles']}; order = D['order']
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
W, H, AY, BY, LH = 540, 960, 64, 380, 304          # 上层 A 在 y=64，中层 B 在 y=380，各 540×304
segs = []
for k, sid in enumerate(order):
    bg = Image.new('RGB', (W, H), (18, 18, 18)); d = ImageDraw.Draw(bg)
    f1, f2 = ImageFont.truetype(FONT, 26), ImageFont.truetype(FONT, 18)
    d.text((16, 16), f'{k + 1:02d}  {sid}  {S[sid]["name"]}', font=f1, fill=(240, 240, 236))
    d.text((16, AY + LH + 2), 'A', font=f2, fill=(160, 160, 160)); d.text((16, BY + LH + 2), 'B', font=f2, fill=(160, 160, 160))
    d.rectangle([0, 712, W, H], fill=(40, 40, 40)); d.text((W // 2 - 70, 820), '口播区（预留）', font=f2, fill=(120, 120, 120))
    if S[sid]['B']['src'].startswith('无视频'): d.text((300, BY + LH + 2), 'B 无视频地址·静帧占位', font=f2, fill=(220, 90, 70))
    bp = os.path.join(TMP, f'bg_{k:02d}.png'); bg.save(bp)
    sp = os.path.join(TMP, f'seg_{k:02d}.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-t', '8', '-i', bp, '-i', os.path.join(CL, f'{sid}_A.mp4'), '-i', os.path.join(CL, f'{sid}_B.mp4'),
                    '-filter_complex', f'[1]scale={W}:{LH}[a];[2]scale={W}:{LH}[b];[0][a]overlay=0:{AY}[x];[x][b]overlay=0:{BY},fps=30,format=yuv420p',
                    '-frames:v', '240', '-an', '-c:v', 'libx264', '-crf', '24', '-preset', 'fast', sp], check=True)
    segs.append(sp)
lst = os.path.join(TMP, 'list.txt'); open(lst, 'w').write(''.join(f"file '{s}'\n" for s in segs))
final = os.path.join(OUT, f'色序/色序{V}_全序预览_9x16.mp4')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', '-movflags', '+faststart', final], check=True)

# —— 在拼好的成品上逐切点复测 ——
sys.path.insert(0, os.path.dirname(__file__))
from color_measure import measure, layer
cap = cv2.VideoCapture(final); allf = {}; nread = 0
keep = {i for k in range(1, len(order)) for i in range(240 * k - 15, 240 * k + 15)}      # 只留切点前后各 15 帧，整片读进内存要 11 GB
while True:
    ok, f = cap.read()
    if not ok: break
    if nread in keep: allf[nread] = f
    nread += 1
assert nread == 240 * len(order), nread
top = lambda f: f[AY:AY + LH]; mid = lambda f: f[BY:BY + LH]
rows, tiles = [], []
for k in range(len(order) - 1):
    c = 240 * (k + 1)
    pre, post = [allf[i] for i in range(c - 15, c)], [allf[i] for i in range(c, c + 15)]
    pa, pb = measure([top(f) for f in pre]), measure([top(f) for f in post]); qa, qb = measure([mid(f) for f in pre]), measure([mid(f) for f in post])
    ta, ma = layer(pa, pb), layer(qa, qb)          # (分数, 标签)
    rows.append({'切点': f'{k + 1}→{k + 2}', '时间': f'{c / 30:.0f}s', '从': order[k], '到': order[k + 1],
                 '上层切前': pa['hex'], '上层切后': pb['hex'], '上层差': ta[1], '中层切前': qa['hex'], '中层切后': qb['hex'], '中层差': ma[1],
                 '上层分': round(ta[0], 2), '中层分': round(ma[0], 2), '判定': '弱' if min(ta[0], ma[0]) < 0.35 else ('一般' if ta[0] + ma[0] < 1.2 else '好')})
    row = np.hstack([cv2.resize(top(allf[c - 1]), (240, 135)), cv2.resize(top(allf[c]), (240, 135)), np.full((135, 12, 3), 255, np.uint8),
                     cv2.resize(mid(allf[c - 1]), (240, 135)), cv2.resize(mid(allf[c]), (240, 135))])
    lab = np.full((135, 150, 3), 245, np.uint8); cv2.putText(lab, f'{k + 1}>{k + 2}', (8, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (30, 30, 30), 2)
    cv2.putText(lab, rows[-1]['判定'] == '弱' and 'WEAK' or '', (8, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (40, 50, 200), 2)
    tiles.append(np.hstack([lab, row]))
with open(os.path.join(OUT, f'色序/色序{V}_切点验证.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
half = (len(tiles) + 1) // 2
for i, part in enumerate([tiles[:half], tiles[half:]]):
    cv2.imwrite(os.path.join(OUT, f'色序/色序{V}_切点总览_{i + 1}.jpg'), np.vstack(part), [cv2.IMWRITE_JPEG_QUALITY, 85])
print('frames', nread); [print(r['切点'], r['从'], '→', r['到'], '上层', r['上层差'], '中层', r['中层差'], r['判定']) for r in rows]
