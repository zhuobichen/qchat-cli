#!/usr/bin/env python3
"""S07 扁平矢量 B（英文讲解版）：10,000 YEARS AGO… PEOPLE BEGAN TO FARM …AND STORED THEIR GRAIN
用法: JOBS=8 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
原 B 是第三方日文讲解片；这里讲同一故事的第一拍（人类开始种地、存粮），构图和角色全部自绘。
做法（对齐上游参考包 S07 的扁平矢量配方：SVG+GSAP 的手感）：
- 全部是纯色多边形，无渐变、无纹理；六个色相（钴蓝、薄荷绿、明黄、珊瑚红、奶油白、深靛），每个色相最多再配一档更深的平涂色做体积。
- 一镜到底：世界坐标里摆好整条场景，镜头 30 fps 连续平移和推拉；PIL 2× 超采样画，再缩回 1920×1080。
- 动作用 GSAP 的缓动公式：back.out 弹性入场、back.in 收走、elastic.out 太阳、power3.inOut 运镜；入场带约 10% 挤压拉伸，stagger 两帧。
- 同一时刻只让一个主体做主动作：太阳 → 标题 → 田垄 → 麦子 → 房子 → 农人 → 陶罐 → 粮筐倒粮；云、麦浪、太阳光芒只做背景微动。
节拍：0–1.7 s 太阳弹出、标题 10,000 YEARS AGO… 逐字弹出再缩进左上角时间签 → 1.7–4.3 s 字幕 PEOPLE BEGAN TO FARM，田垄擦出、麦子一列列弹起、两间房子落地、农人招手 →
4.3–5.3 s 镜头横移到粮仓，字幕换成 …AND STORED THEIR GRAIN → 5.0–7.9 s 三只陶罐弹出，粮筐落下，依次给三只罐子倒粮，粮堆鼓起，粮筐飞走，停到 8 s。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, SS, FPS, N = 1920, 1080, 2, 30, 240
ROUND = '/System/Library/Fonts/SFNSRounded.ttf'
_fc = {}
def font(size):
    k = max(2, int(size))
    if k not in _fc:
        f = ImageFont.truetype(ROUND, k); f.set_variation_by_name('Black'); _fc[k] = f
    return _fc[k]

# —— 色板：六个色相，各带一档深色 ——
BLUE, BLUE_D = (46, 54, 230), (30, 34, 170)
MINT, MINT_D = (52, 214, 150), (24, 160, 112)
YEL, YEL_D = (255, 198, 44), (236, 146, 18)
RED, RED_D = (244, 78, 58), (186, 46, 40)
CREAM = (255, 244, 222)
NAVY = (27, 23, 72)
SKIN = (250, 168, 120)

# —— GSAP 缓动 ——
def cl(u): return min(max(u, 0.0), 1.0)
def seg(t, a, b): return cl((t - a) / (b - a))
def back_out(u, s=1.70158): u = cl(u); return 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2
def back_in(u, s=1.70158): u = cl(u); return (s + 1) * u ** 3 - s * u ** 2
def elastic_out(u):
    u = cl(u)
    return u if u in (0.0, 1.0) else 2 ** (-10 * u) * math.sin((u * 10 - 0.75) * 2 * math.pi / 3) + 1
def p3io(u): u = cl(u); return 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2
def p2o(u): u = cl(u); return 1 - (1 - u) ** 2
def lerp(a, b, u): return a + (b - a) * u
def pop(t, t0, dur=0.38, squash=0.12):
    """弹性入场：返回 (sx, sy)；挤压拉伸约 10%。"""
    u = seg(t, t0, t0 + dur); s = back_out(u, 2.2); st = squash * math.sin(math.pi * u) * (1 - u) * 2
    return s * (1 - st), s * (1 + st)

# —— 镜头 ——
def sine_io(u): u = cl(u); return 0.5 - 0.5 * math.cos(math.pi * u)
def camera(t):
    """一镜到底：开场轻微拉远 → 下移看田 → 匀速慢漂 → 1.5 s 正弦缓动横移到粮仓（2.2 s） → 慢推。"""
    keys = [(0.0, 980, 560, 1.08, p3io), (1.6, 980, 560, 1.0, p3io), (2.3, 1040, 640, 0.95, p3io), (3.7, 1070, 640, 0.95, lambda u: u),
            (5.9, 2060, 610, 1.12, sine_io), (8.0, 2100, 590, 1.18, p2o)]
    for (t0, x0, y0, z0, _), (t1, x1, y1, z1, e) in zip(keys, keys[1:]):
        if t <= t1:
            u = e(seg(t, t0, t1)); return lerp(x0, x1, u), lerp(y0, y1, u), lerp(z0, z1, u)
    return keys[-1][1:4]

class Draw:
    def __init__(s, cam):
        s.im = Image.new('RGB', (W * SS, H * SS), BLUE); s.d = ImageDraw.Draw(s.im); s.cx, s.cy, s.z = cam
        s.par = 1.0                                                      # 视差：天空层只跟镜头走一小部分
    def P(s, x, y):
        p = s.par; cx, cy, z = 980 + (s.cx - 980) * p, 560 + (s.cy - 560) * p, 1 + (s.z - 1) * p
        return ((x - cx) * z * SS + W * SS / 2, (y - cy) * z * SS + H * SS / 2)
    def poly(s, pts, col): s.d.polygon([s.P(*p) for p in pts], fill=col)
    def line(s, pts, w, col): s.d.line([s.P(*p) for p in pts], fill=col, width=max(1, int(w * s.z * SS)), joint='curve')
    # 屏幕坐标（HUD）
    def spoly(s, pts, col): s.d.polygon([(x * SS, y * SS) for x, y in pts], fill=col)
    def stext(s, xy, txt, size, col, anchor='ms'): s.d.text((xy[0] * SS, xy[1] * SS), txt, font=font(size * SS), fill=col, anchor=anchor)

def ell(cx, cy, rx, ry, n=56, a0=0, a1=2 * math.pi):
    return [(cx + rx * math.cos(a), cy + ry * math.sin(a)) for a in np.linspace(a0, a1, n)]
def rrect(x0, y0, x1, y1, r, n=10):
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2); pts = []
    for cx, cy, a in ((x1 - r, y0 + r, -math.pi / 2), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, math.pi / 2), (x0 + r, y0 + r, math.pi)):
        pts += [(cx + r * math.cos(a + k * math.pi / 2 / (n - 1)), cy + r * math.sin(a + k * math.pi / 2 / (n - 1))) for k in range(n)]
    return pts
def xf(pts, px, py, sx=1.0, sy=1.0, rot=0.0):
    """局部坐标（以支点为原点）→ 世界坐标：先缩放再旋转。"""
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return [(px + (x * sx) * c - (y * sy) * s, py + (x * sx) * s + (y * sy) * c) for x, y in pts]

# —— 场景元素 ——
CLOUDS = [(640, 280, 0.8), (1020, 120, 0.75), (2050, 160, 0.9), (2700, 110, 0.7), (3150, 200, 1.0)]
def backdrop(D, t):
    D.poly([(-2000, -2000), (5000, -2000), (5000, 3000), (-2000, 3000)], BLUE)
    # 太阳：0 s 起 elastic 弹出，光芒慢转
    D.par = 0.18
    s = 0.45 + 0.55 * elastic_out(seg(t, 0.0, 0.9)); sx, sy = 1560, 250
    for k in range(12):
        a = math.radians(t * 18 + k * 30)
        r0, r1, hw = 140 * s, 192 * s, 0.09
        D.poly([(sx + r0 * math.cos(a - hw), sy + r0 * math.sin(a - hw)), (sx + r1 * math.cos(a), sy + r1 * math.sin(a)), (sx + r0 * math.cos(a + hw), sy + r0 * math.sin(a + hw))], YEL)
    D.poly(ell(sx, sy, 112 * s, 112 * s), YEL)
    for k, (x, y, sc) in enumerate(CLOUDS):
        x += t * 14 * (1.2 - 0.3 * sc)
        for dx, dy, rx, ry in ((0, 0, 95, 40), (-70, 12, 55, 28), (55, 8, 60, 30), (-10, -28, 52, 40)):
            D.poly(ell(x + dx * sc, y + dy * sc, rx * sc, ry * sc, 40), CREAM)
        D.poly([(x - 125 * sc, y + 14 * sc), (x + 115 * sc, y + 14 * sc), (x + 115 * sc, y + 40 * sc), (x - 125 * sc, y + 40 * sc)], CREAM)
    # 远山、近丘、地面
    D.par = 0.6
    D.poly([(-1500, 900)] + [(x, 620 - 70 * max(0, math.sin(x / 210 + 0.6)) ** 1.5) for x in range(-1500, 4200, 30)] + [(4200, 900)], BLUE_D)
    D.par = 1.0
    D.poly([(-1500, 900)] + [(x, 676 - 34 * math.sin(x / 330 + 2.0)) for x in range(-1500, 4200, 30)] + [(4200, 900)], MINT_D)
    D.poly([(-1500, 712), (4200, 712), (4200, 2400), (-1500, 2400)], MINT)
    for k, (x, y, sc) in enumerate(BUSHES):                           # 前景草丛（静止的装饰块）
        D.poly(ell(x, y, 62 * sc, 36 * sc, 40, math.pi, 2 * math.pi), MINT_D)
        D.poly(ell(x - 34 * sc, y, 40 * sc, 26 * sc, 32, math.pi, 2 * math.pi), MINT_D)
        D.poly(ell(x + 20 * sc, y - 18 * sc, 12 * sc, 8 * sc, 16), YEL if k % 2 else RED)
    # 右侧的树（镜头移过去时有前景层次），随风轻摆
    for k, (x, g, sc) in enumerate(((2620, 760, 1.0), (2800, 735, 0.75), (2950, 770, 1.1))):
        sw = 4 * math.sin(t * 2.2 + k)
        D.poly([(x - 10 * sc, g), (x + 10 * sc, g), (x + 6 * sc, g - 120 * sc), (x - 6 * sc, g - 120 * sc)], RED_D)
        D.poly(ell(x + sw * sc, g - 160 * sc, 70 * sc, 78 * sc), MINT_D)
        D.poly(ell(x - 18 * sc + sw * sc, g - 176 * sc, 34 * sc, 38 * sc), MINT)

BUSHES = [(260, 1040, 1.0), (760, 1000, 0.8), (1480, 1050, 1.1), (1880, 990, 0.7), (2560, 1000, 0.9), (2980, 1030, 1.0)]
FX0, FX1 = 120, 1170
ROWS = [744, 790, 836, 884, 934]
def field(D, t):
    # 田垄：从左往右擦出（back.out），每垄 stagger 2 帧
    for k, y in enumerate(ROWS):
        u = back_out(seg(t, 1.85 + k * 0.067, 2.3 + k * 0.067), 1.4)
        if u <= 0: continue
        th = 18 + 3 * k; x1 = FX0 + (FX1 - FX0 + 40 * k) * u
        D.poly(rrect(FX0 - 20 * k, y - th / 2, x1 - 20 * k, y + th / 2, th / 2), RED_D)
    # 麦子：按列 stagger 2 帧弹起（挤压拉伸），之后跟风轻摆
    for k, y in enumerate(ROWS):
        sc = 0.72 + 0.09 * k
        for c in range(8):
            t0 = 2.42 + c * 0.067 + k * 0.034
            sx, sy = pop(t, t0, 0.36)
            if sy <= 0.01: continue
            x = FX0 + 60 - 20 * k + c * (FX1 - FX0 - 40) / 7.6
            sway = 5 * math.sin(t * 2.6 - c * 0.5 - k * 0.3) * cl((t - t0 - 0.36) / 0.3)
            wheat(D, x, y - 4, sc * sx, sc * sy, sway)

def wheat(D, x, y, sx, sy, sway):
    for dx, h, lean in ((-16, 74, -9), (0, 92, 0), (16, 70, 10)):
        rot = lean + sway
        D.line(xf([(dx * 0.4, 0), (dx * 0.4, -h)], x, y, sx, sy, rot), 6, YEL_D)
        D.poly(xf(ell(dx * 0.4, -h - 14, 10, 24, 24), x, y, sx, sy, rot), YEL)
        for j in range(3):
            yy = -h + 4 - j * 11
            D.poly(xf([(dx * 0.4 - 3, yy), (dx * 0.4 - 15, yy - 14), (dx * 0.4 - 11, yy - 2)], x, y, sx, sy, rot), YEL)
            D.poly(xf([(dx * 0.4 + 3, yy), (dx * 0.4 + 15, yy - 14), (dx * 0.4 + 11, yy - 2)], x, y, sx, sy, rot), YEL)

def house(D, x, g, w, h, sx, sy):
    """支点在墙底中点。"""
    if sy <= 0.01: return
    T = lambda pts: xf(pts, x, g, sx, sy)
    D.poly(T([(-w / 2, 0), (w / 2, 0), (w / 2, -h), (-w / 2, -h)]), CREAM)
    D.poly(T([(w * 0.18, 0), (w / 2, 0), (w / 2, -h), (w * 0.18, -h)]), (240, 214, 180))   # 侧墙暗面（同色相深一档）
    D.poly(T([(-w / 2 - 36, -h + 6), (0, -h - w * 0.52), (w / 2 + 36, -h + 6)]), RED)
    D.poly(T([(0, -h - w * 0.52), (w / 2 + 36, -h + 6), (w * 0.12, -h + 6)]), RED_D)
    D.poly(T(rrect(-w * 0.32, -h * 0.62, -w * 0.06, 0, 18)), NAVY)
    D.poly(T(rrect(w * 0.08 - 6, -h * 0.66, w * 0.36 - 6, -h * 0.4, 6)), NAVY)
    D.poly(T(rrect(w * 0.08 + 2, -h * 0.66 + 8, w * 0.36 - 14, -h * 0.4 - 8, 3)), YEL)

def farmer(D, x, g, t, sx, sy):
    if sy <= 0.01: return
    T = lambda pts, rot=0: xf(pts, x, g, sx, sy, rot)
    D.poly(T(rrect(-26, -62, -6, 0, 6)), NAVY); D.poly(T(rrect(6, -62, 26, 0, 6)), NAVY)
    D.poly(T([(-44, -56), (44, -56), (30, -150), (-30, -150)]), CREAM)
    D.poly(T([(-40, -86), (40, -86), (39, -74), (-41, -74)]), RED)
    wave = 30 * math.sin(max(0.0, t - 4.0) * 11) * cl((t - 3.95) / 0.3) * (1 - seg(t, 4.6, 4.9))
    sh = (24, -140)
    arm = xf([(-8, 0), (8, 0), (8, -78), (-8, -78)], 0, 0, 1, 1, 28 + wave); arm = [(a + sh[0], b + sh[1]) for a, b in arm]
    D.poly(T(arm), CREAM)
    hx, hy = sh[0] + 78 * math.sin(math.radians(28 + wave)), sh[1] - 78 * math.cos(math.radians(28 + wave))
    D.poly(T(ell(hx, hy, 15, 15, 24)), SKIN)
    D.poly(T(rrect(-34, -146, -14, -82, 9)), CREAM)
    D.poly(T(ell(0, -186, 40, 40)), SKIN)
    D.poly(T(ell(0, -196, 44, 34, 40, math.pi, 2 * math.pi) + [(44, -192), (-44, -192)]), NAVY)
    D.poly(T(ell(14, -184, 6, 7, 16)), NAVY)
    D.poly(T(ell(-6, -168, 14, 8, 20, 0, math.pi)), RED_D)

JARS = [(1950, 784, 1.0), (2150, 772, 1.22), (2345, 792, 0.86)]   # 底部支点 x, 地面 y, 尺寸
def jar_profile(h=170, w=82):
    prof = [(0.0, 0.58), (0.12, 0.86), (0.42, 1.0), (0.7, 0.86), (0.86, 0.52), (0.92, 0.46), (0.97, 0.58), (1.0, 0.58)]
    R = [(w * r, -h * y) for y, r in prof]; L = [(-w * r, -h * y) for y, r in reversed(prof)]
    return R + L
def jar(D, x, g, sc, sx, sy, heap):
    if sy <= 0.01: return
    h, w = 170 * sc, 82 * sc
    T = lambda pts: xf(pts, x, g, sx, sy)
    body = jar_profile(h, w); D.poly(T(body), RED)
    D.poly(T([(px, py) for px, py in body if px >= 0] + [(w * 0.3, -h), (w * 0.3, 0)]), RED_D)
    # 奶油色腰带 + 一排倒三角
    y0 = -h * 0.56; bw = w * 0.985
    D.poly(T([(-bw, y0 - 9 * sc), (bw, y0 - 9 * sc), (bw, y0 + 9 * sc), (-bw, y0 + 9 * sc)]), CREAM)
    for k in range(5):
        bx = -w * 0.64 + k * w * 0.32
        D.poly(T([(bx - 13 * sc, y0 + 16 * sc), (bx + 13 * sc, y0 + 16 * sc), (bx, y0 + 36 * sc)]), CREAM)
    D.poly(T(ell(0, -h, w * 0.58, 12 * sc, 32)), NAVY)
    if heap > 0.01:                                                    # 粮堆鼓出罐口
        hs = heap; D.poly(T(ell(0, -h, w * 0.62 * hs, 46 * sc * hs, 40, math.pi, 2 * math.pi)), YEL)
        for k, (dx, dy) in enumerate(((-18, -14), (6, -26), (24, -10), (-2, -6))):
            D.poly(T(ell(dx * sc * hs, -h + dy * sc * hs, 5 * sc, 3.5 * sc, 12)), YEL_D)

# 粮筐：落下 → 倒第一罐 → 跳到第二罐 → 倒 → 第三罐 → 飞走
POUR = [(6.04, 6.34), (6.72, 7.02), (7.4, 7.64)]
def tilt(t, a, b):
    if t < a - 0.1: return 0.0
    if t < a: return -10 * math.sin(math.pi * seg(t, a - 0.1, a))                 # 预备回拉
    if t < b: return 42 * back_out(seg(t, a, a + 0.14), 2.5)                       # 冲出
    return 42 * (1 - p3io(seg(t, b, b + 0.1)))                                     # 回正
def basket_state(t):
    hov = [(jx - 112 * s, g - 170 * s - 130) for jx, g, s in JARS]
    if t < 5.7: return None
    if t < 5.94:                                                                    # 落下回弹
        u = back_out(seg(t, 5.7, 5.94), 1.6); return hov[0][0], lerp(hov[0][1] - 560, hov[0][1], u), 0.0, 1.0
    for i, (a, b) in enumerate(POUR):
        if i < 2:
            h0, h1 = b + 0.1, POUR[i + 1][0] - 0.1
            if t < h0: return hov[i][0], hov[i][1], tilt(t, a, b), 1.0
            if t < h1:                                                             # 弧线跳到下一罐，落地挤压
                u = p3io(seg(t, h0, h1)); x = lerp(hov[i][0], hov[i + 1][0], u); y = lerp(hov[i][1], hov[i + 1][1], u) - 90 * math.sin(math.pi * u)
                return x, y, -8 * math.sin(math.pi * u), 1.0
        else:
            x, y = hov[2]
            if t < 7.74: return x, y, tilt(t, a, b), 1.0
            u = back_in(seg(t, 7.74, 7.96), 1.4); return x + 900 * u, y - 700 * u, -20 * u, 1.0

def basket(D, st):
    x, y, rot, s = st
    T = lambda pts: xf(pts, x, y, s, s, rot)
    D.poly(T(ell(0, -48, 92, 26, 40, math.pi, 2 * math.pi)), YEL)              # 冒尖的谷子
    D.poly(T([(-96, -48), (96, -48), (70, 48), (-70, 48)]), RED_D)
    for yy in (-18, 16):
        D.poly(T([(-92 + (yy + 48) * 0.27, yy - 7), (92 - (yy + 48) * 0.27, yy - 7), (92 - (yy + 55) * 0.27, yy + 7), (-92 + (yy + 55) * 0.27, yy + 7)]), CREAM)
    D.poly(T(rrect(-104, -60, 104, -40, 10)), RED)
    return xf([(100, -54)], x, y, s, s, rot)[0]

def stream(D, t, lip, i):
    a, b = POUR[i]
    if not (a + 0.06 <= t < b + 0.06): return
    jx, g, sc = JARS[i]; mx, my = jx, g - 170 * sc - 6
    k_end = 1.0 if t < b else 1 - seg(t, b, b + 0.06)
    for k in range(9):
        s = ((t - a) * 3.2 + k / 9) % 1.0
        if s > k_end + 1e-6 and t >= b: continue
        px = lerp(lip[0], mx, s); py = lip[1] + (my - lip[1]) * s * s + 14 * math.sin(k * 2.1)
        D.poly(ell(px + 6 * math.sin(k * 1.7), py, 8, 11, 14), YEL if k % 3 else YEL_D)

# —— HUD：标题与字幕 ——
HEAD = '10,000 YEARS AGO…'
def chars_layout(txt, size):
    f = font(size); xs, x = [], 0.0
    for i, ch in enumerate(txt):
        w = f.getlength(ch); xs.append(x + w / 2); x += w
    return xs, x
def headline(D, t):
    if t < 0.06: return
    size0 = 112; xs, tw = chars_layout(HEAD, size0)
    # 变形：1.35–1.65 s 缩成左上角时间签
    m = p3io(seg(t, 1.35, 1.65)); sc = lerp(1.0, 0.48, m)
    cx0, by0 = 690, 380
    left1, by1 = 92, 132
    ox = lerp(cx0 - tw / 2, left1, m); oy = lerp(by0, by1, m)
    x1 = -1.0
    if t >= 1.5:                                                      # 时间签底板：横向擦出，盖到哪个字，哪个字就换成深靛色
        u = back_out(seg(t, 1.5, 1.75), 1.8)
        x0, x1 = 66, 66 + (tw * 0.48 + 52) * u
        D.spoly([(a + 6, b + 6) for a, b in rrect(x0, 72, x1, 156, 18)], NAVY)
        D.spoly(rrect(x0, 72, x1, 156, 18), YEL)
    for i, ch in enumerate(HEAD):
        if ch == ' ': continue
        sx, sy = pop(t, 0.06 + i * 0.067, 0.34, 0.14)
        if sy <= 0.02: continue
        px, py = ox + xs[i] * sc, oy
        sz = size0 * sc * sy
        if px + 30 * sc > x1:
            D.stext((px + 9 * sc, py + 9 * sc), ch, sz, NAVY)
            D.stext((px, py), ch, sz, CREAM)
        else:
            D.stext((px, py), ch, sz, NAVY)

CAPS = [('PEOPLE BEGAN TO FARM', 1.7), ('…AND STORED THEIR GRAIN', 5.1)]
def caption(D, t):
    """字幕胶囊：第一句 back.out 弹出；换句时胶囊不收走，宽度 power3 变形，旧字压扁消失、新字弹出。"""
    (t1, a), (t2, b) = CAPS; size = 66
    if t < a: return
    w1, w2 = font(size).getlength(t1) / 2 + 48, font(size).getlength(t2) / 2 + 48
    s = back_out(seg(t, a, a + 0.36), 2.0)
    hw = lerp(w1, w2, p3io(seg(t, b, b + 0.3))) * s; hh = 58 * min(1.0, s * 1.15)
    cx, cy = W / 2, 948
    D.spoly([(x + 8, y + 8) for x, y in rrect(cx - hw, cy - hh, cx + hw, cy + hh, hh)], BLUE_D)
    D.spoly(rrect(cx - hw, cy - hh, cx + hw, cy + hh, hh), NAVY)
    if t < b + 0.12:
        k = s * (1 - back_in(seg(t, b, b + 0.12), 1.5))
        if k > 0.3: D.stext((cx, cy + size * 0.36), t1, size * k, CREAM)
    else:
        k = back_out(seg(t, b + 0.12, b + 0.4), 2.0)
        if k > 0.05: D.stext((cx, cy + size * 0.36 * k), t2, size * k, CREAM)

def frame(i):
    t = i / FPS
    D = Draw(camera(t))
    backdrop(D, t)
    field(D, t)
    house(D, 1400, 762, 230, 120, *pop(t, 3.42, 0.42))
    house(D, 1660, 742, 170, 96, *pop(t, 3.62, 0.42))
    farmer(D, 1235, 790, t, *pop(t, 3.92, 0.36))
    st = basket_state(t)
    for k, (x, g, sc) in enumerate(JARS):
        a, b = POUR[k]
        heap = back_out(seg(t, a + 0.18, b + 0.1), 2.0)
        jar(D, x, g, sc, *pop(t, 5.3 + k * 0.1, 0.4), heap)
    if st is not None:
        lip = basket(D, st)
        for k in range(3): stream(D, t, lip, k)
    headline(D, t)
    caption(D, t)
    img = cv2.resize(np.asarray(D.im), (W, H), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(OUT, f'{i + 1:04d}.png'), img[..., ::-1])

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
