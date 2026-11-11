#!/usr/bin/env python3
"""30 画风色序 v3：全 30 组动态取色，按切点颜色排序。
用法: python3 color_order_v3.py <上游参考包根> <交付根> <标准片段目录(color_clips.py 输出)>
与 v2 的区别：
- 60 段全部是视频（S11 的 B 除外，没有视频地址，只能用静帧），每 0.25 s 取 1 帧，共 32 帧。
- 每段分别量「入场」（首 15 帧 = 0.5 s）、「出场」（末 15 帧）和全段主色；入场/出场窗口与成品切点复测一致。
- 切换分按切点算：第 i 组出场色接第 i+1 组入场色，上层 A、中层 B 各算一次。
  彩色对彩色：(1−cos Δh)/2；只要有一侧是黑白或低饱和：0.85×min(1, |ΔL|/0.45)。
  另加材质交替 +0.25、同材质 −0.4，少女与猫 A 相邻 −0.8，卡尔 B 相邻 −0.5。开场固定 S04 蓝图（同旧表）。
"""
import csv, json, math, os, random, sys
import cv2, numpy as np
PKG, OUT, CL = sys.argv[1:4]
IDX = json.load(open(os.path.join(PKG, '30画风色序参考/30画风_颜色与来源索引.json')))
OLD = list(csv.DictReader(open(os.path.join(PKG, '03_30画风播放顺序_暂排.csv'), encoding='utf-8-sig')))
LOG = {(a, b): c for a, b, c in json.load(open(os.path.join(CL, 'clips_log.json')))}
MAT = {r['画风']: (r['切换依据'].split('→')[-1].strip() if '→' in r['切换依据'] else '线条') for r in OLD}

def frames(path):
    cap = cv2.VideoCapture(path); out = []
    for k in range(32):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(k * 7.5)); ok, f = cap.read()
        if ok: out.append((k * 0.25, f))
    return out
def crop_active(f):
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY); cols = np.where(g.mean(0) > 8)[0]; rows = np.where(g.mean(1) > 8)[0]
    if len(cols) > g.shape[1] * 0.5 and len(rows) > g.shape[0] * 0.5: return f[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
    return f
def measure(fs):
    hist = np.zeros(36); chroma = []; lum = []; px = []
    for f in fs:
        f = crop_active(f); hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(float)
        h, s, v = hsv[:, 0] * 2, hsv[:, 1] / 255, hsv[:, 2] / 255; m = (s > 0.25) & (v > 0.15); w = s * v
        hist += np.bincount((h[m] // 10).astype(int) % 36, weights=w[m], minlength=36)
        chroma.append(m.mean()); lum.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).mean() / 255); px.append(np.c_[f.reshape(-1, 3)[m], h[m]])
    sm = sum(np.roll(hist, k) * wk for k, wk in [(-2, .25), (-1, .6), (0, 1), (1, .6), (2, .25)]); pk = int(sm.argmax()); cr = float(np.mean(chroma))
    allpx = np.concatenate(px); near = allpx[np.abs(((allpx[:, 3] - (pk * 10 + 5)) + 180) % 360 - 180) < 25]
    L = round(float(np.mean(lum)), 3)
    if cr < 0.12 or len(near) < 50: g = int(L * 255); return dict(hue=None, chroma=round(cr, 3), lum=L, hex='#%02x%02x%02x' % (g, g, g))
    ang = np.deg2rad(near[:, 3]); hue = (math.degrees(math.atan2(np.sin(ang).mean(), np.cos(ang).mean())) + 360) % 360
    b, g, r = np.median(near[:, :3], 0).astype(int)
    return dict(hue=round(hue, 1), chroma=round(cr, 3), lum=L, hex='#%02x%02x%02x' % (r, g, b))

S = []
for x in IDX:
    sid = x['id']; rec = dict(id=sid, name=x['style'], mat=MAT.get(x['style'], '?'), old=x['current_order'])
    for k in ('A', 'B'):
        fs = frames(os.path.join(CL, f'{sid}_{k}.mp4'))
        cap = cv2.VideoCapture(os.path.join(CL, f'{sid}_{k}.mp4')); ed = []
        while True:
            ok, f = cap.read()
            if not ok: break
            ed.append(f)
        # 入场／出场 = 切点两侧各 15 帧（0.5 s），与 color_stitch_verify.py 在成品上复测的窗口一致
        rec[k] = dict(all=measure([f for _, f in fs]), entry=measure(ed[:15]), exit=measure(ed[-15:]), src=LOG[(sid, k)])
    S.append(rec); print(sid, rec['A']['all']['hex'], rec['A']['all']['hue'], '|', rec['B']['all']['hex'], rec['B']['all']['hue'], flush=True)

def layer(a, b):
    if a['hue'] is not None and b['hue'] is not None:
        d = abs((a['hue'] - b['hue'] + 180) % 360 - 180); return (1 - math.cos(math.radians(d))) / 2, f'{d:.0f}°'
    dl = abs(a['lum'] - b['lum']); return 0.85 * min(1, dl / 0.45), f'ΔL {dl:.2f}'
GIRL = {'S22', 'S23', 'S24'}; CARL = {'S22', 'S23', 'S24', 'S25'}
def trans(i, j):
    a, b = S[i], S[j]
    sc = layer(a['A']['exit'], b['A']['entry'])[0] + layer(a['B']['exit'], b['B']['entry'])[0] + (0.25 if a['mat'] != b['mat'] else -0.4)
    if a['id'] in GIRL and b['id'] in GIRL: sc -= 0.8
    elif a['id'] in CARL and b['id'] in CARL: sc -= 0.5
    return sc
n = len(S); T = [[trans(i, j) for j in range(n)] for i in range(n)]
start = next(i for i, s in enumerate(S) if s['id'] == 'S04')
def total(p): return sum(T[p[k]][p[k + 1]] for k in range(n - 1))
best = None
for seed in range(32):
    rnd = random.Random(seed); rest = [i for i in range(n) if i != start]; rnd.shuffle(rest); p = [start] + rest; cur = total(p); temp = 2.0
    for it in range(80000):
        if rnd.random() < 0.5: i, j = sorted(rnd.sample(range(1, n), 2)); q = p[:i] + p[i:j + 1][::-1] + p[j + 1:]
        else:
            i = rnd.randrange(1, n); e = p[i]; q = p[:i] + p[i + 1:]; j = rnd.randrange(1, n); q = q[:j] + [e] + q[j:]
        c = total(q)
        if c > cur or rnd.random() < math.exp((c - cur) / temp): p, cur = q, c
        temp = max(0.005, temp * 0.99985)
    if best is None or cur > best[1]: best = (p, cur)
order, score = best
idx = {s['id']: i for i, s in enumerate(S)}
v2 = json.load(open(os.path.join(OUT, '色序/色序_实测数据.json')))['order']
old = [s['id'] for s in sorted(S, key=lambda s: s['old'])]
sc_of = lambda ids: round(total([idx[i] for i in ids]), 2)
rows = []
for k, i in enumerate(order):
    s = S[i]; nx = S[order[k + 1]] if k + 1 < n else None
    rows.append({'顺序': k + 1, '编号': s['id'], '画风': s['name'], '材质': s['mat'], '旧序': s['old'], 'v2序': v2.index(s['id']) + 1,
                 'A主色': s['A']['all']['hex'], 'A色相': s['A']['all']['hue'] if s['A']['all']['hue'] is not None else '黑白', 'A明度': s['A']['all']['lum'],
                 'B主色': s['B']['all']['hex'], 'B色相': s['B']['all']['hue'] if s['B']['all']['hue'] is not None else '黑白', 'B明度': s['B']['all']['lum'],
                 '切点·上层A（出→入）': layer(s['A']['exit'], nx['A']['entry'])[1] if nx else '',
                 '切点·中层B（出→入）': layer(s['B']['exit'], nx['B']['entry'])[1] if nx else '',
                 '切点·材质': f"{s['mat']} → {nx['mat']}" if nx else '', '切换分': round(T[i][order[k + 1]], 2) if nx else '',
                 'A取色来源': s['A']['src'], 'B取色来源': s['B']['src']})
with open(os.path.join(OUT, '色序/30画风播放顺序_v3.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
json.dump(dict(order=[S[i]['id'] for i in order], score=round(score, 2), score_v2_order=sc_of(v2), score_old_order=sc_of(old), styles=S),
          open(os.path.join(OUT, '色序/色序_v3_实测数据.json'), 'w'), ensure_ascii=False, indent=1)
print('v3', round(score, 2), '| v2 order under v3 data', sc_of(v2), '| old order', sc_of(old))
for r in rows: print(r['顺序'], r['编号'], r['画风'], r['A主色'], r['A色相'], '|', r['B主色'], r['B色相'], '→', r['切点·上层A（出→入）'], r['切点·中层B（出→入）'], r['切点·材质'], r['切换分'])
