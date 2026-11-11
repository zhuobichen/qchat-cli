#!/usr/bin/env python3
"""开场候选·人眼抢眼度：把每个画风当开场时，观众前 10 秒实际看到的画面按人眼的色彩空间打分。
用法: python3 opener_salience.py <交付根> <标准片段目录(color_clips.py 640×360 输出)>
前 10 秒 = 开场组 8 秒 + 按 v4 轮转后下一组的前 2 秒；A、B 上下叠成一屏一起算（9:16 版式里两层同时可见）。
每秒取 6 帧，缩到 160 宽，转 CIELAB 后量五项：
  特异点  每帧 ΔE 的 95 分位（像素到整屏平均色的距离），一团跳色在平淡底子上最高
  峰值彩度  Lab 彩度 C 的 95 分位
  暖色抢眼  C>35 且色相落在品红到黄（Lab h 300°–80°）的像素占比，人眼先注意暖色
  明暗反差  L 的标准差
  运动  相邻帧平均绝对差
五项各自做 z 分数后加权相加（特异点 2、峰值彩度 1、暖色 1、反差 0.5、运动 1）；
时间上前 3 秒权重 2、3–8 秒 1、第 8–10 秒 1.5（换组那一下观众最容易划走），另报最弱一秒。
输出 色序/开场候选_人眼.csv
"""
import csv, json, os, sys
import cv2, numpy as np
OUT, CL = sys.argv[1:3]
order = json.load(open(os.path.join(OUT, '色序/色序_v4_实测数据.json')))['order']
names = {s['id']: s['name'] for s in json.load(open(os.path.join(OUT, '色序/色序_v4_实测数据.json')))['styles']}
FPS, STEP = 30, 5

def frames(sid, n):
    caps = [cv2.VideoCapture(os.path.join(CL, f'{sid}_{k}.mp4')) for k in 'AB']; out = []
    for i in range(n):
        fr = [c.read()[1] for c in caps]
        if i % STEP == 0: out.append(cv2.resize(np.vstack(fr), (160, 180), interpolation=cv2.INTER_AREA))
    return out

def metrics(fs):
    rows, prev = [], None
    for f in fs:
        lab = cv2.cvtColor(f.astype(np.float32) / 255, cv2.COLOR_BGR2LAB).reshape(-1, 3); L, a, b = lab.T
        C = np.hypot(a, b); h = np.degrees(np.arctan2(b, a)) % 360
        de = np.linalg.norm(lab - lab.mean(0), axis=1)
        warm = ((C > 35) & ((h >= 300) | (h <= 80))).mean()
        mot = 0.0 if prev is None else float(np.abs(f.astype(np.float32) - prev).mean()); prev = f.astype(np.float32)
        rows.append([np.percentile(de, 95), np.percentile(C, 95), warm, L.std(), mot])
    m = np.array(rows); m[0, 4] = m[1, 4]; return m        # 每秒 6 行

cache = {}
def get(sid, n):
    if (sid, n) not in cache: cache[(sid, n)] = metrics(frames(sid, n))
    return cache[(sid, n)]

T = {}
for k, sid in enumerate(order):
    nxt = order[(k + 1) % len(order)]
    T[sid] = (np.vstack([get(sid, 240), get(nxt, 60)]), nxt)          # 60 行 = 10 s × 6
allm = np.vstack([v[0] for v in T.values()]); mu, sd = allm.mean(0), allm.std(0)
W = np.array([2, 1, 1, .5, 1])
tw = np.array([2] * 18 + [1] * 30 + [1.5] * 12)
res = []
for sid, (m, nxt) in T.items():
    z = ((m - mu) / sd) @ W; per_s = z.reshape(10, 6).mean(1)
    raw = m.mean(0)
    res.append({'编号': sid, '画风': names[sid], '下一组': f'{nxt} {names[nxt]}', '人眼抢眼分': round(float((z * tw).sum() / tw.sum()), 2),
                '前3秒': round(float(per_s[:3].mean()), 2), '8到10秒': round(float(per_s[8:].mean()), 2),
                '最弱一秒': f'{int(per_s.argmin())}s {per_s.min():.2f}',
                '特异点ΔE': round(float(raw[0]), 1), '峰值彩度': round(float(raw[1]), 1), '暖色占比': round(float(raw[2]), 3),
                '明暗反差': round(float(raw[3]), 1), '运动': round(float(raw[4]), 1),
                '首帧ΔE': round(float(m[0, 0]), 1), '首帧亮度L': round(float(cv2.cvtColor(frames(sid, 1)[0].astype(np.float32) / 255, cv2.COLOR_BGR2LAB)[..., 0].mean()), 1)})
res.sort(key=lambda r: -r['人眼抢眼分'])
dst = os.path.join(OUT, '色序/开场候选_人眼.csv')
with open(dst, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(res[0].keys())); w.writeheader(); w.writerows(res)
for r in res: print(*r.values(), sep=' | ')
