#!/usr/bin/env python3
"""30 画风色序 v4：在 v3 的顺序上做三处改动，不重新优化。
用法: python3 color_order_v4.py <交付根> <标准片段目录(color_clips.py 640×360 输出)> [开场编号，默认 S08；用户 2026-10-27 定为 S05]
- 去掉 S25 黑白橡皮管（用户 2026-10-27 决定），剩 29 组；原来 S17→S25→S19 变成 S17→S19。
- S11 的 B 换成这次补做的成片；S05、S19、S04、S14、S03、S35、S07 的日文讲解 B 换成这次做的英文讲解版；这些组都重新取色（全段、入场、出场，窗口同 v3）。
- 用户认可 v3 的先后关系，只换开场：把序列整体轮转到开场编号，原来末组接回原来首组（S27→S04）。
  开场按前 1.5 s 的抓眼度挑，见 色序/开场候选.csv（由本脚本一并输出）。
输出 色序/30画风播放顺序_v4.csv、色序/色序_v4_实测数据.json、色序/开场候选.csv
"""
import csv, json, os, sys
import cv2, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from color_measure import measure, layer
OUT, CL = sys.argv[1:3]; OPEN = sys.argv[3] if len(sys.argv) > 3 else 'S08'
V3 = json.load(open(os.path.join(OUT, '色序/色序_v3_实测数据.json')))
S = {s['id']: s for s in V3['styles'] if s['id'] != 'S25'}

def read(p):
    cap = cv2.VideoCapture(p); fs = []
    while True:
        ok, f = cap.read()
        if not ok: break
        fs.append(f)
    return fs
REDO = [x for x in S if os.path.exists(os.path.join(OUT, f'完成片/{x}_B_8s.mp4')) and S[x]['B']['src'].startswith('远端')] + ['S11']   # 这次替换或补做的 B
for sid in dict.fromkeys(REDO):
    fs = read(os.path.join(CL, f'{sid}_B.mp4')); assert len(fs) == 240
    S[sid]['B'] = dict(all=measure(fs[::8][:32]), entry=measure(fs[:15]), exit=measure(fs[-15:]), src='这次补做成片')

GIRL = {'S22', 'S23', 'S24'}; CARL = {'S22', 'S23', 'S24'}
def T(i, j):
    a, b = S[i], S[j]
    sc = layer(a['A']['exit'], b['A']['entry'])[0] + layer(a['B']['exit'], b['B']['entry'])[0] + (0.25 if a['mat'] != b['mat'] else -0.4)
    if i in GIRL and j in GIRL: sc -= 0.8
    elif i in CARL and j in CARL: sc -= 0.5
    return sc
total = lambda o: round(sum(T(o[k], o[k + 1]) for k in range(len(o) - 1)), 2)
base = [x for x in V3['order'] if x != 'S25']

# —— 开场候选：前 45 帧（1.5 s）的彩度、运动、反差，A、B 两层各算，z 分数相加 ——
def hook(p):
    fs = read(p)[:45]; f32 = [f.astype(np.float32) for f in fs]; col = []
    for f in f32[::5]:
        b, g, r = f[..., 0], f[..., 1], f[..., 2]; rg = r - g; yb = .5 * (r + g) - b
        col.append(np.hypot(rg.std(), yb.std()) + .3 * np.hypot(rg.mean(), yb.mean()))     # Hasler–Süsstrunk 彩度
    mot = np.mean([np.abs(f32[i] - f32[i - 1]).mean() for i in range(1, 45)])
    con = np.mean([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).std() for f in fs[::5]])
    return [float(np.mean(col)), float(mot), float(con), float(cv2.cvtColor(fs[0], cv2.COLOR_BGR2GRAY).mean())]
H = {sid: hook(os.path.join(CL, f'{sid}_A.mp4')) + hook(os.path.join(CL, f'{sid}_B.mp4')) for sid in base}
M = np.array([H[s] for s in base]); cols = [0, 1, 2, 4, 5, 6]
z = ((M[:, cols] - M[:, cols].mean(0)) / M[:, cols].std(0)).sum(1)
cand = []
for k, sid in enumerate(base):
    rot = base[k:] + base[:k]
    cand.append({'编号': sid, '画风': S[sid]['name'], '抓眼分': round(float(z[k]), 2),
                 'A彩度': round(H[sid][0], 1), 'A运动': round(H[sid][1], 1), 'A反差': round(H[sid][2], 1), 'A首帧亮度': round(H[sid][3], 1),
                 'B彩度': round(H[sid][4], 1), 'B运动': round(H[sid][5], 1), 'B反差': round(H[sid][6], 1), 'B首帧亮度': round(H[sid][7], 1),
                 '轮转后色序总分': total(rot)})
cand.sort(key=lambda r: -r['抓眼分'])
with open(os.path.join(OUT, '色序/开场候选.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(cand[0].keys())); w.writeheader(); w.writerows(cand)

k0 = base.index(OPEN); order = base[k0:] + base[:k0]
rows = []
for k, sid in enumerate(order):
    s = S[sid]; nx = S[order[k + 1]] if k + 1 < len(order) else None
    rows.append({'顺序': k + 1, '编号': sid, '画风': s['name'], '材质': s['mat'], 'v3序': V3['order'].index(sid) + 1,
                 'A主色': s['A']['all']['hex'], 'A色相': s['A']['all']['hue'] if s['A']['all']['hue'] is not None else '黑白',
                 'B主色': s['B']['all']['hex'], 'B色相': s['B']['all']['hue'] if s['B']['all']['hue'] is not None else '黑白',
                 '切点·上层A（出→入）': layer(s['A']['exit'], nx['A']['entry'])[1] if nx else '',
                 '切点·中层B（出→入）': layer(s['B']['exit'], nx['B']['entry'])[1] if nx else '',
                 '切点·材质': f"{s['mat']} → {nx['mat']}" if nx else '', '切换分': round(T(sid, order[k + 1]), 2) if nx else '',
                 'A取色来源': s['A']['src'], 'B取色来源': s['B']['src']})
with open(os.path.join(OUT, '色序/30画风播放顺序_v4.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
json.dump(dict(order=order, opener=OPEN, score=total(order), score_v3_minus_S25=total(base), styles=[S[x] for x in order]),
          open(os.path.join(OUT, '色序/色序_v4_实测数据.json'), 'w'), ensure_ascii=False, indent=1)
for sid in dict.fromkeys(REDO): print(sid, 'B', S[sid]['B']['all'], '| A', S[sid]['A']['all']['hex'], S[sid]['A']['all']['hue'])
print('v4', total(order), 'v3 去掉 S25 未轮转', total(base), '开场', OPEN)
for c in cand[:6]: print(c['编号'], c['画风'], c['抓眼分'], c['轮转后色序总分'])
print(' → '.join(order))
