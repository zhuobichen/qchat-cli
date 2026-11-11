#!/usr/bin/env python3
"""S11 Risograph 孔版套印 B：MAKE IT / MOVE IT 公园骑行。
用法: JOBS=4 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
做法（对齐 A 和 lemo risograph 配方）：
- 三块印版分开画：蓝、黄、荧光粉，每块是 0–1 的网调图；半调网点各用不同网角，满版处是实地。
- 合成按油墨正片叠底：纸色 × Π(1 − 覆盖 × (1 − 墨色))，黄压蓝出绿、粉压蓝出紫、粉压黄出橙，和 A 的配色同源。
- 套印错位：每块版各自偏移，字砸下来时粉版做衰减震荡，6.5 s 全版一次错开再回正（RisoMisregistrationHit 的手法）。
- 元素动作按 12 fps 走（每拍停两帧半），镜头推近按 30 fps 连续；纸纤维、墨量不匀、针孔都按拍刷新。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, SS, FPS, N = 1920, 1080, 2, 30, 240
PAPER = np.array([242, 236, 221], np.float32) / 255
INK = {'yellow': np.array([255, 222, 40]) / 255, 'pink': np.array([255, 72, 150]) / 255, 'blue': np.array([40, 118, 196]) / 255}
ANG = {'yellow': 0, 'pink': 75, 'blue': 15}                    # 网角
CELL = 9.0                                                      # 网点周期（px）
BLACK = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 215 * SS, index=9)   # Condensed Black
SMALL = ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc', 24 * SS, index=1)
rng0 = np.random.default_rng(11)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
SCREEN = {}
for k, a in ANG.items():
    r = math.radians(a); u = (xx * math.cos(r) + yy * math.sin(r)) * 2 * math.pi / CELL; v = (-xx * math.sin(r) + yy * math.cos(r)) * 2 * math.pi / CELL
    SCREEN[k] = (np.cos(u) * np.cos(v) + 1) / 2                   # 0..1 的网点阈值
FIBER = cv2.GaussianBlur(rng0.random((H, W), np.float32), (0, 0), 1.2)
FIBER = (FIBER - FIBER.mean()) / FIBER.std()
BLOT = {k: cv2.resize(rng0.random((9, 16), np.float32), (W, H), interpolation=cv2.INTER_CUBIC) for k in INK}   # 墨量不匀
PETALS = [(rng0.uniform(0, W), rng0.uniform(-200, 900), rng0.uniform(0.5, 1.4), rng0.uniform(0, 6.3)) for _ in range(46)]

ease = lambda x: 1 - (1 - min(max(x, 0), 1)) ** 3
def osc(t, t0, amp, dur=0.55, freq=3.2):
    """砸下后的衰减震荡：t0 前为 0。"""
    if t < t0: return 0.0
    u = t - t0; return amp * math.exp(-u / (dur / 3)) * math.cos(2 * math.pi * freq * u)

class Plate:
    def __init__(self): self.im = Image.new('L', (W * SS, H * SS), 0); self.d = ImageDraw.Draw(self.im)
    def tone(self, v): return int(round(v * 255))
    def ellipse(self, cx, cy, rx, ry, v): self.d.ellipse([(cx - rx) * SS, (cy - ry) * SS, (cx + rx) * SS, (cy + ry) * SS], fill=self.tone(v))
    def poly(self, pts, v): self.d.polygon([(x * SS, y * SS) for x, y in pts], fill=self.tone(v))
    def rect(self, x0, y0, x1, y1, v): self.d.rectangle([x0 * SS, y0 * SS, x1 * SS, y1 * SS], fill=self.tone(v))
    def line(self, pts, w, v): self.d.line([(x * SS, y * SS) for x, y in pts], fill=self.tone(v), width=int(w * SS), joint='curve')
    def text(self, xy, s, font, v, scale=1.0, anchor='la'):
        if scale == 1.0: self.d.text((xy[0] * SS, xy[1] * SS), s, font=font, fill=self.tone(v), anchor=anchor); return
        f2 = ImageFont.truetype(font.path, int(font.size * scale), index=font.index)
        self.d.text((xy[0] * SS, xy[1] * SS), s, font=f2, fill=self.tone(v), anchor=anchor)
    def array(self): return cv2.resize(np.asarray(self.im, np.float32) / 255, (W, H), interpolation=cv2.INTER_AREA)

def word(plates, x, y, s, t_in, te, v=1.0, step=0.12):
    """逐字砸入：每个字在 t_in + i·step 出现，第一拍放大 1.18 再落回。"""
    cx = x
    for i, ch in enumerate(s):
        w = BLACK.getlength(ch) / SS
        ti = t_in + i * step
        if te >= ti and ch != ' ':
            sc = 1.18 if te < ti + 1 / 12 + 1e-6 else 1.0
            for p in plates: p.text((cx + w / 2, y + 108), ch, BLACK, v, sc, anchor='mm')
        cx += w - 6
    return cx

def frame(i):
    t = i / FPS; te = math.floor(t * 12) / 12          # 元素按 12 fps 走
    P = {k: Plate() for k in INK}; Y, Pk, B = P['yellow'], P['pink'], P['blue']
    # —— 天空、太阳、田野、小路 ——
    Y.rect(0, 0, W, 520, 0.30); Y.rect(0, 520, W, 1000, 0.95)
    for k in range(12): B.rect(0, 600 + k * 34, W, 617 + k * 34, 0.36); B.rect(0, 617 + k * 34, W, 634 + k * 34, 0.27)   # 割草条纹
    B.rect(0, 520, W, 600, 0.30)
    sun_r = 165 * ease(t / 0.9); Y.ellipse(1600, 235, sun_r, sun_r, 1.0)
    for k in range(3): Pk.rect(0, 470 + k * 16, W, 476 + k * 16, 0.55)            # 地平线粉色细条
    Y.rect(0, 896, W, 966, 0.22)
    B.d.rectangle([0, 896 * SS, W * SS, 966 * SS], fill=0)                          # 小路留纸白
    for k in range(18): B.rect(40 + k * 108, 928, 92 + k * 108, 934, 0.6)             # 路面虚线
    # —— 树：蓝树干，粉树冠依次弹出 ——
    for k in range(9):
        x = 110 + k * 215; tk = 0.9 + k * 0.13
        if te < tk: continue
        s = 1.12 if te < tk + 1 / 12 + 1e-6 else 1.0
        B.rect(x - 7, 545, x + 7, 640, 1.0)
        Pk.ellipse(x, 520, 92 * s, 70 * s, 0.82); Pk.ellipse(x - 30, 505, 28 * s, 20 * s, 1.0)
        B.ellipse(x + 20, 535, 24 * s, 14 * s, 0.25)
    # 长椅
    for bx in (520, 1380):
        B.rect(bx, 700, bx + 120, 712, 1.0); B.rect(bx, 724, bx + 120, 734, 1.0); B.rect(bx + 8, 734, bx + 16, 768, 1.0); B.rect(bx + 104, 734, bx + 112, 768, 1.0)
    # —— 骑车人：12 fps 位移，轮辐与踏板跟着转 ——
    if 1.8 <= te <= 7.6:
        X0 = -300 + (te - 1.8) / 5.6 * 2520; GY = 932; K = 1.35
        q = lambda lx, ly: (X0 + lx * K, GY + ly * K)                              # 局部坐标（以后轮与前轮中点、地面为原点）
        r = 66; ang = -X0 / (r * K)
        rear, front, crank = q(-112, -r), q(112, -r), q(-4, -58)
        seat, bar = q(-40, -172), q(82, -186)
        B.ellipse(X0, GY + 10, 250, 16, 0.35)                                     # 投影
        for c in (rear, front):
            R = r * K; B.d.ellipse([(c[0] - R) * SS, (c[1] - R) * SS, (c[0] + R) * SS, (c[1] + R) * SS], outline=255, width=int(11 * SS))
            for s_ in range(6):
                a = ang + s_ * math.pi / 3; B.line([c, (c[0] + R * math.cos(a), c[1] + R * math.sin(a))], 4, 0.9)
        hb = q(76, -168)
        B.line([rear, crank, seat, rear], 12, 1.0); B.line([crank, hb, front], 12, 1.0); B.line([seat, hb], 12, 1.0)
        B.line([hb, bar, q(108, -190)], 10, 1.0)
        for sgn, v in ((1, 1.0), (-1, 0.55)):
            a = ang * 0.9 + (sgn < 0) * math.pi
            pd = (crank[0] + 34 * K * math.cos(a), crank[1] + 34 * K * math.sin(a))
            hip = (seat[0] + 6 * K, seat[1] - 18 * K); kn = ((hip[0] + pd[0]) / 2 + 34 * K, (hip[1] + pd[1]) / 2 - 30 * K)
            B.line([hip, kn, pd], 26, v)
        sh = q(12, -300)
        Pk.poly([(seat[0] - 24, seat[1] - 14), (seat[0] + 38, seat[1] - 32), (sh[0] + 35, sh[1] + 8), (sh[0] - 35, sh[1] - 5)], 1.0)   # 粉外套
        Pk.line([(sh[0] + 8, sh[1] + 24), q(62, -226), (bar[0] + 10, bar[1] - 2)], 23, 1.0)
        Y.ellipse(sh[0] + 19, sh[1] - 68, 43, 48, 1.0)                                 # 头
        B.d.chord([(sh[0] - 27) * SS, (sh[1] - 122) * SS, (sh[0] + 65) * SS, (sh[1] - 30) * SS], 180, 360, fill=255)   # 头发
        wv = math.sin(te * 14) * 18
        Y.poly([(sh[0] - 8, sh[1] - 16), (sh[0] + 32, sh[1] - 5), (sh[0] - 150, sh[1] - 35 + wv), (sh[0] - 200, sh[1] - 8 - wv)], 1.0)   # 黄围巾
    # —— 花瓣 ——
    for (px, py, sp, ph) in PETALS:
        yv = (py + te * 60 * sp) % 1000; xv = (px + te * 90 * sp + 20 * math.sin(te * 2 + ph)) % W
        Pk.ellipse(xv, yv, 6, 4, 1.0)
    # —— 大字：MAKE IT（蓝实地 + 粉版回声），MOVE IT（粉实地 + 蓝版回声） ——
    bp = Plate(); pp = Plate(); pp2 = Plate(); bp2 = Plate()
    ea = max(0.0, 1 - (t - 1.15) / 0.5); eb = max(0.0, 1 - (t - 4.35) / 0.5)          # 回声版在最后一个字砸下 0.3 s 后淡出
    word([bp], 90, 40, 'MAKE IT', 0.15, te); word([pp], 90, 40, 'MAKE IT', 0.15, te, v=ea)
    word([pp2], 430, 232, 'MOVE IT', 3.35, te); word([bp2], 430, 232, 'MOVE IT', 3.35, te, v=0.85 * eb)
    # —— 小字与底栏 ——
    B.rect(90, 1012, W - 90, 1014, 1.0)
    B.text((90, 1028), 'N° 11 — RISO MOTION STUDY', SMALL, 1.0); B.text((W - 90, 1028), 'BLUE · PINK · YELLOW', SMALL, 1.0, anchor='ra')
    if te >= 5.6: Pk.text((W / 2, 1028), 'MAKE IT MOVE', SMALL, 1.0, anchor='ma')

    # —— 套印错位 ——
    kick = lambda amp: osc(t, 6.5, amp, dur=1.0, freq=1.6)
    hitA = sum(osc(t, 0.15 + 0.12 * k, 26, 0.5) for k in range(7))
    hitB = sum(osc(t, 3.35 + 0.12 * k, -24, 0.5) for k in range(7))
    jit = lambda k: (math.sin(te * 37 + k) * 1.5, math.cos(te * 23 + k * 2) * 1.5)    # 每拍的小抖
    off = {'yellow': (kick(10) + jit(1)[0], kick(14) + jit(1)[1]), 'pink': (kick(22) + jit(2)[0], -kick(10) + jit(2)[1]), 'blue': (-kick(18) + jit(3)[0], kick(8) + jit(3)[1])}
    cov = {}
    for k, p in P.items():
        a = p.array()
        if k == 'blue': a = np.maximum(np.maximum(a, shift(bp.array(), 0, 0)), shift(bp2.array(), hitB, -hitB * 0.3))
        if k == 'pink': a = np.maximum(np.maximum(a, shift(pp.array(), hitA, hitA * 0.25)), shift(pp2.array(), 0, 0))
        a = shift(a, *off[k])
        sc = SCREEN[k]; ht = np.clip((a - sc) * 6 + 0.5, 0, 1)                         # 网点；实地处（a≈1）自然填满
        ht = np.where(a > 0.97, a, ht)
        rs = np.random.default_rng(int(te * 12) * 7 + len(k))
        grain = 0.82 + 0.10 * BLOT[k] + 0.05 * FIBER[(np.arange(H) + int(te * 12) * 3) % H][:, :]
        pin = (rs.random((H // 3, W // 3)) > 0.035).astype(np.float32); pin = cv2.resize(pin, (W, H), interpolation=cv2.INTER_NEAREST)
        cov[k] = np.clip(ht * grain * (0.75 + 0.25 * pin), 0, 1)
    img = np.ones((H, W, 3), np.float32) * PAPER * (1 + 0.025 * FIBER[..., None])
    for k in ('yellow', 'pink', 'blue'): img *= 1 - cov[k][..., None] * (1 - INK[k])
    # 镜头：8 秒推近 3%，连续
    s = 1 + 0.03 * ease(t / 8); M = cv2.getRotationMatrix2D((W / 2, H * 0.55), 0, s)
    img = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    cv2.imwrite(os.path.join(OUT, f'{i + 1:04d}.png'), np.clip(img[..., ::-1] * 255, 0, 255).astype(np.uint8))

def shift(a, dx, dy):
    if abs(dx) < 1e-3 and abs(dy) < 1e-3: return a
    return cv2.warpAffine(a, np.float32([[1, 0, dx], [0, 1, dy]]), (W, H), flags=cv2.INTER_LINEAR, borderValue=0)

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
