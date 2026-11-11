#!/usr/bin/env python3
"""30 画风色序预排 v2。

用法: cd /private/tmp && python3 color_order.py <上游参考包根目录> <交付根目录>
模型（依上游参考包 00_先读我.md）：9:16 成片里上层 A、中层 B 同步 8 秒，所以每次换画风时
上层 A_i→A_{i+1}、中层 B_i→B_{i+1} 同时换色。切换分 = 两层各自的色差分 + 材质交替分 − 同内容相邻罚分。
- 彩色层之间：色相差越接近 180° 越好（(1−cos Δh)/2）。
- 有一侧是黑白／低饱和：改用明暗反差（|ΔL|/0.45，封顶 1）× 0.85。
取色：这次 13 组用成片 MP4（A 用上游参考包参考视频，B 用 完成片/），每 0.5 s 取 1 帧；其余 17 组只有上游参考包静态帧。
"""
import csv, json, math, os, random, sys
import cv2, numpy as np

PKG, OUT = sys.argv[1], sys.argv[2]
IDX = json.load(open(os.path.join(PKG, '30画风色序参考/30画风_颜色与来源索引.json')))
OLD = list(csv.DictReader(open(os.path.join(PKG, '03_30画风播放顺序_暂排.csv'), encoding='utf-8-sig')))
OURS = ['S06', 'S08', 'S12', 'S22', 'S23', 'S24', 'S25', 'S27', 'S28', 'S29', 'S30', 'S33', 'S34']

# 材质类别：取旧表「切换依据」里 "X → Y" 的 Y 作为该行画风的材质；第 1 行蓝图为「线条」
MAT = {}
for row in OLD:
    tgt = row['切换依据'].split('→')[-1].strip() if '→' in row['切换依据'] else '线条'
    MAT[row['画风']] = tgt

def frames_from_video(path, step=0.5):
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS) or 30; n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    out = []
    for k in range(int(n / fps / step)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int((k + 0.5) * step * fps)); ok, f = cap.read()
        if ok: out.append(f)
    return out

def crop_active(f):
    """去掉 4:3 片门两侧黑边（S25 等），避免黑边把明度拉低。"""
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY); cols = np.where(g.mean(0) > 8)[0]
    return f[:, cols[0]:cols[-1] + 1] if len(cols) > g.shape[1] * 0.5 else f

def measure(frames):
    hist = np.zeros(36); chroma = []; lum = []; px = []
    for f in frames:
        f = crop_active(f); f = cv2.resize(f, (320, int(320 * f.shape[0] / f.shape[1])))
        hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV).reshape(-1, 3).astype(float)
        h, s, v = hsv[:, 0] * 2, hsv[:, 1] / 255, hsv[:, 2] / 255
        m = (s > 0.25) & (v > 0.15); w = s * v
        hist += np.bincount((h[m] // 10).astype(int) % 36, weights=w[m], minlength=36)
        chroma.append(m.mean()); lum.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).mean() / 255)
        px.append(np.c_[f.reshape(-1, 3)[m], h[m]])
    sm = sum(np.roll(hist, k) * wk for k, wk in [(-2, .25), (-1, .6), (0, 1), (1, .6), (2, .25)])
    pk = int(sm.argmax()); cr = float(np.mean(chroma))
    allpx = np.concatenate(px) if px else np.zeros((0, 4))
    near = allpx[np.abs(((allpx[:, 3] - (pk * 10 + 5)) + 180) % 360 - 180) < 25] if len(allpx) else allpx
    if cr < 0.12 or len(near) < 50:                    # 黑白／低饱和
        L = float(np.mean(lum)); g = int(L * 255); return dict(hue=None, chroma=round(cr, 3), lum=round(L, 3), hex='#%02x%02x%02x' % (g, g, g))
    ang = np.deg2rad(near[:, 3]); hue = (math.degrees(math.atan2(np.sin(ang).mean(), np.cos(ang).mean())) + 360) % 360
    b, gg, r = np.median(near[:, :3], 0).astype(int)
    return dict(hue=round(hue, 1), chroma=round(cr, 3), lum=round(float(np.mean(lum)), 3), hex='#%02x%02x%02x' % (r, gg, b))

S = []
for x in IDX:
    sid, name = x['id'], x['style']
    if sid in OURS:
        A = frames_from_video(os.path.join(PKG, f'参考视频/{sid}_A_8秒.mp4'))
        B = frames_from_video(os.path.join(OUT, f'完成片/{sid}_B_8s.mp4')); how = '成片动态采样（每 0.5 s）'
    else:
        A = [cv2.imread(os.path.join(PKG, x['cases']['a']['poster']))]
        B = [cv2.imread(os.path.join(PKG, x['cases']['b']['poster']))] if x['cases'].get('b', {}).get('poster') else A
        how = '上游参考包静态帧（未取得完整 MP4）'
    S.append(dict(id=sid, name=name, mat=MAT.get(name, '?'), A=measure(A), B=measure(B), how=how, old=x['current_order']))

def layer(a, b):
    if a['hue'] is not None and b['hue'] is not None:
        d = abs((a['hue'] - b['hue'] + 180) % 360 - 180); return (1 - math.cos(math.radians(d))) / 2, f'{d:.0f}°'
    dl = abs(a['lum'] - b['lum']); return 0.85 * min(1, dl / 0.45), f'ΔL {dl:.2f}'

GIRL = {'S22', 'S23', 'S24'}; CARL = {'S22', 'S23', 'S24', 'S25'}
def trans(i, j):
    a, b = S[i], S[j]; sa, _ = layer(a['A'], b['A']); sb, _ = layer(a['B'], b['B'])
    sc = sa + sb + (0.25 if a['mat'] != b['mat'] else -0.4)
    if a['id'] in GIRL and b['id'] in GIRL: sc -= 0.8      # A 都是少女与猫，别相邻
    elif a['id'] in CARL and b['id'] in CARL: sc -= 0.5    # B 都是卡尔，尽量拉开
    return sc

n = len(S); T = [[trans(i, j) for j in range(n)] for i in range(n)]
start = next(i for i, s in enumerate(S) if s['id'] == 'S04')   # 开场沿用旧表：蓝图建立主色基准
def total(p): return sum(T[p[k]][p[k + 1]] for k in range(n - 1))
best = None
for seed in range(24):
    rnd = random.Random(seed); rest = [i for i in range(n) if i != start]; rnd.shuffle(rest); p = [start] + rest; cur = total(p); temp = 2.0
    for it in range(60000):
        i, j = sorted(rnd.sample(range(1, n), 2)); q = p[:i] + p[i:j + 1][::-1] + p[j + 1:]
        c = total(q)
        if c > cur or rnd.random() < math.exp((c - cur) / temp): p, cur = q, c
        temp = max(0.01, temp * 0.9998)
    if best is None or cur > best[1]: best = (p, cur)
order, score = best
old_order = sorted(range(n), key=lambda i: S[i]['old'])

os.makedirs(os.path.join(OUT, '色序'), exist_ok=True)
rows = []
for k, i in enumerate(order):
    s = S[i]; nxt = S[order[k + 1]] if k + 1 < n else None
    la = layer(s['A'], nxt['A'])[1] if nxt else ''; lb = layer(s['B'], nxt['B'])[1] if nxt else ''
    rows.append({'顺序': k + 1, '编号': s['id'], '画风': s['name'], '材质': s['mat'], '旧序': s['old'],
                 'A主色': s['A']['hex'], 'A色相': s['A']['hue'] if s['A']['hue'] is not None else '黑白', 'A明度': s['A']['lum'],
                 'B主色': s['B']['hex'], 'B色相': s['B']['hue'] if s['B']['hue'] is not None else '黑白', 'B明度': s['B']['lum'],
                 '到下一组·上层A': la, '到下一组·中层B': lb, '到下一组·材质': (f"{s['mat']} → {nxt['mat']}" if nxt else ''),
                 '切换分': round(T[i][order[k + 1]], 2) if nxt else '', '取色方式': s['how']})
with open(os.path.join(OUT, '色序/30画风播放顺序_v2.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
json.dump(dict(order=[S[i]['id'] for i in order], score=round(score, 2), old_score=round(total(old_order), 2),
               styles=S), open(os.path.join(OUT, '色序/色序_实测数据.json'), 'w'), ensure_ascii=False, indent=1)
print('new score', round(score, 2), 'old order score (same metric)', round(total(old_order), 2))
for r in rows: print(r['顺序'], r['编号'], r['画风'], r['A主色'], r['A色相'], '|', r['B主色'], r['B色相'], '→', r['到下一组·上层A'], r['到下一组·中层B'], r['到下一组·材质'], r['切换分'])
