#!/usr/bin/env python3
"""S14 贴纸科普 B（英文讲解版）：MICE FOUND THE GRAIN → THEN THE WILDCAT ARRIVED
用法: JOBS=8 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
原 B 是第三方日文讲解片（牛皮纸底上的贴纸村子）；这里讲同一故事的第三拍，做成一张科普事实卡，构图和贴纸全部自绘。
做法（对齐上游参考包 S14 的贴纸科普配方：mg-styles-15 19-paperclip）：
- 一张约 3700×1200 的大画布，蓝灰底 #E9EEF2 + 点阵；界面只用三色加一个强调色：深靛字和柱、灰蓝辅助线、红色强调。
- 贴纸是程序画的仿照片抠图（陶罐、老鼠、野猫）：毛色带细噪声和体积明暗，外面做一圈约 10 px 的白色模切边（先闭运算抹平凹口再膨胀），
  贴纸边缘一道极细的灰边，底下一层小投影；贴纸拍下时投影由远到近、由虚到实。
- 柱状图按真实比例生长（每格 10 只，柱高 = 数值 × 固定像素），数值和大计数器跟着柱子滚动；标注为示意数据。
- 镜头 30 fps 连续：开场慢慢拉远，2.3 s 正弦长缓动横移到画布右半，最后慢推；猫贴纸拍下时镜头轻震一下。
节拍：0–3.3 s MICE FOUND THE GRAIN：陶罐贴纸拍下，五只老鼠贴纸依次拍上，柱状图五根柱子逐根长高，计数器 0→48 →
3.3–5.6 s 镜头横移到右半，标题 THEN THE WILDCAT ARRIVED 擦出，两只老鼠贴纸拍上 → 5.75 s 虎斑野猫贴纸拍下，老鼠逃出画外 →
6.45 s 拍上 Felis lybica · African wildcat 标签和引线，补一行 Ancestor of today's house cats，慢推到 8 s。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, SS, FPS, N = 1920, 1080, 2, 30, 240
SPR = 2.4                                   # 贴纸贴图：每个世界单位 2.4 像素
HN = '/System/Library/Fonts/HelveticaNeue.ttc'
DIN = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
F_TITLE, F_BOLD, F_MED, F_BI = (HN, 9), (HN, 1), (HN, 10), (HN, 3)
F_NUM = (DIN, 0)
_fc = {}
def font(key, size):
    k = (key, max(2, int(round(size))))
    if k not in _fc: _fc[k] = ImageFont.truetype(key[0], k[1], index=key[1])
    return _fc[k]

# —— 界面色：三色 + 一个强调色 ——
BG = (233, 238, 242); DOT = (204, 212, 221)
INK = (31, 41, 58); GREY = (140, 154, 170); RED = (232, 66, 44)

# —— 缓动 ——
def cl(u): return min(max(u, 0.0), 1.0)
def seg(t, a, b): return cl((t - a) / (b - a))
def lerp(a, b, u): return a + (b - a) * u
def back_out(u, s=1.70158): u = cl(u); return 1 + (s + 1) * (u - 1) ** 3 + s * (u - 1) ** 2
def back_in(u, s=1.70158): u = cl(u); return (s + 1) * u ** 3 - s * u ** 2
def p3o(u): u = cl(u); return 1 - (1 - u) ** 3
def p4o(u): u = cl(u); return 1 - (1 - u) ** 4
def sine_io(u): u = cl(u); return 0.5 - 0.5 * math.cos(math.pi * u)

def vwn_path(c0, z0, c1, z1, rho=2.0):
    """van Wijk & Nuij 平滑缩放平移：先拉远看全画布再推进，屏幕上的感知速度恒定。"""
    w0, w1 = W / z0, W / z1; u1 = math.hypot(c1[0] - c0[0], c1[1] - c0[1])
    bb = lambda i, wi: (w1 * w1 - w0 * w0 + (-1) ** i * rho ** 4 * u1 * u1) / (2 * wi * rho * rho * u1)
    r = lambda v: math.log(-v + math.sqrt(v * v + 1))
    r0, r1 = r(bb(0, w0)), r(bb(1, w1)); S = (r1 - r0) / rho
    def at(e):
        s = S * e; u = w0 / rho ** 2 * (math.cosh(r0) * math.tanh(rho * s + r0) - math.sinh(r0)); w = w0 * math.cosh(r0) / math.cosh(rho * s + r0)
        return lerp(c0[0], c1[0], u / u1), lerp(c0[1], c1[1], u / u1), W / w
    return at
PATH = vwn_path((960, 545), 1.0, (2700, 590), 1.1)
def camera(t):
    """0–2.8 s 慢拉远看左半；2.8–5.8 s 沿平滑缩放路径先退到全画布总览再推进右半（正弦缓动）；之后匀速慢推到结尾。"""
    if t < 2.8: u = sine_io(t / 2.8); x, y, z = lerp(960, 960, u), lerp(525, 545, u), lerp(1.06, 1.0, u)
    elif t < 5.8: x, y, z = PATH(sine_io(seg(t, 2.8, 5.8)))
    else: u = seg(t, 5.8, 8.0); x, y, z = lerp(2700, 2680, u), lerp(590, 600, u), lerp(1.1, 1.16, u)
    if t >= 6.0:                                                      # 猫贴纸拍下：镜头轻震
        d = t - 6.0; a = 7 * math.exp(-d / 0.09) * math.cos(2 * math.pi * 9 * d); y += a / z
    return x, y, z

# ———————————————— 贴纸贴图（每个进程第一次用到时生成） ————————————————
def mask(wu, hu, fn):
    """在 2× 超采样的 L 图上画形状（fn(d, P, k)，P 把局部世界坐标映到像素），返回 SPR 分辨率的 0–1 遮罩。"""
    k = SPR * 2; im = Image.new('L', (int(wu * k), int(hu * k)), 0); d = ImageDraw.Draw(im)
    fn(d, lambda x, y: (x * k, y * k), k)
    return cv2.resize(np.asarray(im, np.float32) / 255, (int(wu * SPR), int(hu * SPR)), interpolation=cv2.INTER_AREA)
def E(d, P, cx, cy, rx, ry): d.ellipse([*P(cx - rx, cy - ry), *P(cx + rx, cy + ry)], fill=255)
def Lw(d, P, k, pts, w): d.line([P(*p) for p in pts], fill=255, width=max(1, int(w * k)), joint='curve')
def Pg(d, P, pts): d.polygon([P(*p) for p in pts], fill=255)

_rng = np.random.default_rng(14)
def fur_noise(h, w, sx=0.8, sy=2.6):
    n = cv2.GaussianBlur(_rng.standard_normal((h, w)).astype(np.float32), (0, 0), sigmaX=sx, sigmaY=sy)
    return n / (n.std() + 1e-6)
def vol(m, sig):
    """体积明暗：遮罩模糊后往左上取光，边缘暗、受光面亮。"""
    b = cv2.GaussianBlur(m, (0, 0), sig); s = int(sig * 0.6)
    b = np.roll(b, (s, s), (0, 1))
    return np.clip(0.72 + 0.42 * b, 0.6, 1.12)
class Art:
    def __init__(s, wu, hu): s.wu, s.hu = wu, hu; s.h, s.w = int(hu * SPR), int(wu * SPR); s.rgb = np.zeros((s.h, s.w, 3), np.float32); s.a = np.zeros((s.h, s.w), np.float32)
    def m(s, fn): return mask(s.wu, s.hu, fn)
    def lay(s, m, col, noise=0.0, shade=0.0, clip=None, op=1.0):
        if clip is not None: m = m * clip
        c = np.ones((s.h, s.w, 3), np.float32) * np.array(col, np.float32) / 255
        if noise: c = c * (1 + noise * fur_noise(s.h, s.w)[..., None])
        if shade: c = c * vol(m, shade * SPR)[..., None]
        m = m * op
        s.rgb = s.rgb * (1 - m[..., None]) + c * m[..., None]; s.a = np.maximum(s.a, m)

def die_cut(art, border=22):
    """白色模切边：闭运算抹平凹口 → 膨胀 border 像素 → 细灰边；贴纸表面一道很淡的斜向反光。"""
    pad = border + 30
    a = np.pad(art.a, pad); rgb = np.pad(art.rgb, ((pad, pad), (pad, pad), (0, 0)))
    hard = (a > 0.4).astype(np.uint8)
    kc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * border + 1, 2 * border + 1))
    closed = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (61, 61)))
    d = cv2.dilate(closed, kc).astype(np.float32)
    d = np.clip((cv2.GaussianBlur(d, (0, 0), 1.6) - 0.5) * 3 + 0.5, 0, 1)
    edge = np.clip(d * (1 - np.clip((cv2.erode(d, np.ones((5, 5), np.uint8)) - 0.5) * 3 + 0.5, 0, 1)), 0, 1)
    white = np.ones_like(rgb) * np.array([0.995, 0.995, 0.99], np.float32)
    out = white * (1 - a[..., None]) + rgb * a[..., None]
    out = out * (1 - 0.18 * edge[..., None])
    h, w = a.shape; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    band = np.exp(-(((xx + yy * 0.8) / (w + h) - 0.32) / 0.07) ** 2)    # 覆膜反光
    out = np.clip(out + 0.07 * band[..., None] * d[..., None], 0, 1)
    rgba = np.dstack([out, d]); return Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA')

def make_jar():
    A = Art(330, 400)
    prof = [(0.0, 0.5), (0.1, 0.78), (0.38, 1.0), (0.66, 0.9), (0.84, 0.6), (0.9, 0.5), (0.95, 0.58), (1.0, 0.6)]
    def body(d, P, k):
        R = [(165 + 140 * r, 395 - 300 * y) for y, r in prof]; Lp = [(165 - 140 * r, 395 - 300 * y) for y, r in reversed(prof)]
        Pg(d, P, R + Lp)
    mb = A.m(body); A.lay(mb, (178, 92, 58), noise=0.05, shade=40)
    A.lay(A.m(lambda d, P, k: (Lw(d, P, k, [(42, 248), (288, 248)], 5), Lw(d, P, k, [(46, 262), (284, 262)], 5))), (120, 58, 38), clip=mb, op=0.8)
    for j in range(7):                                                         # 一圈刻划的波纹
        x = 60 + j * 34
        A.lay(A.m(lambda d, P, k, x=x: Lw(d, P, k, [(x, 290), (x + 17, 305), (x + 34, 290)], 4)), (120, 58, 38), clip=mb, op=0.7)
    A.lay(A.m(lambda d, P, k: E(d, P, 165, 112, 86, 18)), (96, 46, 30))
    heap = A.m(lambda d, P, k: d.chord([*P(70, 40), *P(260, 150)], 180, 360, fill=255))
    A.lay(heap, (222, 178, 90), noise=0.12, shade=22)
    rs = np.random.default_rng(3)
    grains = A.m(lambda d, P, k: [E(d, P, x, y, 6, 3.5) for x, y in zip(rs.uniform(80, 250, 70), rs.uniform(48, 108, 70))])
    A.lay(grains, (176, 128, 54), clip=heap, op=0.7)
    return die_cut(A)

def make_mouse():
    A = Art(210, 120)
    A.lay(A.m(lambda d, P, k: Lw(d, P, k, [(66, 78), (36, 90), (14, 74), (6, 48), (14, 30)], 6)), (196, 150, 142), shade=4)
    A.lay(A.m(lambda d, P, k: (E(d, P, 84, 108, 11, 6), E(d, P, 126, 106, 11, 6))), (214, 160, 150))
    body = A.m(lambda d, P, k: (E(d, P, 98, 74, 60, 36), E(d, P, 148, 64, 34, 28), Pg(d, P, [(160, 50), (200, 68), (160, 82)])))
    A.lay(body, (126, 116, 108), noise=0.09, shade=14)
    A.lay(A.m(lambda d, P, k: E(d, P, 108, 92, 44, 13)), (200, 192, 182), clip=body, noise=0.05)
    A.lay(A.m(lambda d, P, k: E(d, P, 134, 34, 22, 22)), (138, 126, 118), shade=6)
    A.lay(A.m(lambda d, P, k: E(d, P, 134, 34, 14, 14)), (232, 168, 166), shade=4)
    A.lay(A.m(lambda d, P, k: E(d, P, 166, 58, 6.5, 6.5)), (16, 14, 14))
    A.lay(A.m(lambda d, P, k: E(d, P, 164, 56, 2.2, 2.2)), (250, 250, 250))
    A.lay(A.m(lambda d, P, k: E(d, P, 199, 68, 5.5, 4.5)), (226, 140, 140))
    A.lay(A.m(lambda d, P, k: (Lw(d, P, k, [(190, 70), (214, 62)], 1.2), Lw(d, P, k, [(190, 72), (214, 78)], 1.2))), (70, 64, 60), op=0.8)
    return die_cut(A, 20)

def make_cat():
    """坐姿虎斑野猫（非洲野猫）：沙黄底毛、深色虎斑、M 形额纹、环纹尾巴黑尾尖、绿黄眼。"""
    A = Art(560, 640); FUR, DARK, CREAM = (198, 162, 112), (82, 62, 44), (236, 222, 194)
    tail_pts = [(400, 590), (470, 576), (512, 520), (516, 450), (500, 390), (512, 340)]
    tail = A.m(lambda d, P, k: Lw(d, P, k, tail_pts, 40))
    A.lay(tail, FUR, noise=0.1, shade=12)
    for j, u in enumerate((0.42, 0.56, 0.7, 0.82)):                            # 尾巴环纹
        i = int(u * (len(tail_pts) - 1)); f = u * (len(tail_pts) - 1) - i
        x = lerp(tail_pts[i][0], tail_pts[i + 1][0], f); y = lerp(tail_pts[i][1], tail_pts[i + 1][1], f)
        A.lay(A.m(lambda d, P, k, x=x, y=y: E(d, P, x, y, 26, 9)), DARK, clip=tail, op=0.85)
    A.lay(A.m(lambda d, P, k: Lw(d, P, k, tail_pts[-2:], 40)), (34, 28, 24), clip=tail)
    body = A.m(lambda d, P, k: (E(d, P, 370, 498, 124, 112), E(d, P, 280, 420, 152, 186)))
    A.lay(body, FUR, noise=0.1, shade=40)
    stripes = A.m(lambda d, P, k: [Lw(d, P, k, s, 15) for s in (
        [(330, 360), (352, 402), (350, 446)], [(376, 352), (404, 396), (410, 440)], [(420, 384), (446, 428), (452, 470)],
        [(330, 470), (366, 500), (380, 540)], [(400, 470), (440, 500), (460, 540)], [(300, 300), (330, 330)], [(352, 300), (380, 330)])])
    A.lay(cv2.GaussianBlur(stripes, (0, 0), 2), DARK, clip=body, op=0.75)
    A.lay(A.m(lambda d, P, k: E(d, P, 236, 400, 76, 124)), CREAM, noise=0.08, clip=body, shade=20)
    legs = A.m(lambda d, P, k: (d.rounded_rectangle([*P(176, 380), *P(226, 600)], radius=24 * k, fill=255), d.rounded_rectangle([*P(254, 384), *P(304, 604)], radius=24 * k, fill=255)))
    A.lay(legs, FUR, noise=0.1, shade=14)
    A.lay(A.m(lambda d, P, k: [Lw(d, P, k, [(x, y), (x + 50, y + 2)], 10) for x in (176, 254) for y in (470, 512)]), DARK, clip=legs, op=0.7)
    A.lay(A.m(lambda d, P, k: (E(d, P, 201, 600, 34, 17), E(d, P, 280, 604, 34, 17))), CREAM, noise=0.06, shade=6)
    # 头
    for ex in (((148, 156), (152, 46), (226, 118)), ((260, 114), (334, 44), (344, 156))):
        A.lay(A.m(lambda d, P, k, ex=ex: Pg(d, P, ex)), FUR, noise=0.08, shade=12)
    A.lay(A.m(lambda d, P, k: (Pg(d, P, [(166, 140), (162, 72), (210, 120)]), Pg(d, P, [(276, 118), (326, 70), (328, 140)]))), (200, 136, 118), shade=6)
    head = A.m(lambda d, P, k: (E(d, P, 244, 198, 118, 102), E(d, P, 244, 236, 130, 70)))
    A.lay(head, FUR, noise=0.09, shade=34)
    hs = A.m(lambda d, P, k: [Lw(d, P, k, s, 9) for s in (
        [(212, 150), (216, 112)], [(244, 146), (244, 106)], [(276, 150), (272, 112)], [(228, 152), (236, 126)], [(260, 152), (252, 126)],
        [(170, 210), (130, 222)], [(318, 210), (358, 222)], [(150, 246), (190, 240)], [(338, 246), (298, 240)])])
    A.lay(cv2.GaussianBlur(hs, (0, 0), 1.5), DARK, clip=head, op=0.8)
    A.lay(A.m(lambda d, P, k: (E(d, P, 226, 254, 32, 24), E(d, P, 262, 254, 32, 24), E(d, P, 244, 282, 28, 15))), CREAM, noise=0.05, shade=8)
    for ex in (198, 290):
        A.lay(A.m(lambda d, P, k, ex=ex: E(d, P, ex, 202, 27, 19)), (40, 36, 26))
        A.lay(A.m(lambda d, P, k, ex=ex: E(d, P, ex, 202, 23, 16)), (178, 182, 64), shade=5)
        A.lay(A.m(lambda d, P, k, ex=ex: E(d, P, ex + 2, 202, 5, 14)), (12, 12, 10))
        A.lay(A.m(lambda d, P, k, ex=ex: E(d, P, ex - 7, 196, 4, 4)), (252, 252, 248))
    A.lay(A.m(lambda d, P, k: Pg(d, P, [(232, 236), (256, 236), (244, 250)])), (196, 116, 108))
    A.lay(A.m(lambda d, P, k: (Lw(d, P, k, [(244, 250), (244, 262)], 2.5), Lw(d, P, k, [(244, 262), (230, 268)], 2.5), Lw(d, P, k, [(244, 262), (258, 268)], 2.5))), (70, 52, 40))
    A.lay(A.m(lambda d, P, k: [Lw(d, P, k, [(x0, y0), (x1, y1)], 1.6) for x0, y0, x1, y1 in (
        (214, 256, 120, 244), (214, 262, 118, 268), (216, 268, 126, 290), (274, 256, 368, 244), (274, 262, 370, 268), (272, 268, 362, 290))]), (250, 248, 240), op=0.9)
    return die_cut(A)

def make_tag():
    """标签贴纸：深靛底白字，红点，外面同样一圈白模切边。"""
    s = 54; fa, fb = font(F_BI, s * SPR), font(F_BOLD, s * SPR)
    t1, t2 = 'Felis lybica', '  ·  African wildcat'
    w = (fa.getlength(t1) + fb.getlength(t2)) / SPR + 120; h = 96
    A = Art(w + 4, h + 4)
    A.lay(A.m(lambda d, P, k: d.rounded_rectangle([*P(2, 2), *P(w + 2, h + 2)], radius=18 * k, fill=255)), INK)
    A.lay(A.m(lambda d, P, k: E(d, P, 46, h / 2 + 2, 13, 13)), RED)
    im = Image.fromarray((A.rgb * 255).astype(np.uint8)); dr = ImageDraw.Draw(im)
    x = 78 * SPR; y = (h / 2 + 2) * SPR
    dr.text((x, y), t1, font=fa, fill=(250, 250, 250), anchor='lm'); x += fa.getlength(t1)
    dr.text((x, y), t2, font=fb, fill=(250, 250, 250), anchor='lm')
    A.rgb = np.asarray(im, np.float32) / 255
    return die_cut(A, 22)

_spr = {}
def sprite(name):
    if name not in _spr:
        _spr[name] = {'jar': make_jar, 'mouse': make_mouse, 'cat': make_cat, 'tag': make_tag}[name]()
        if name == 'mouse': _spr['mouseL'] = _spr['mouse'].transpose(Image.FLIP_LEFT_RIGHT)
    return _spr[name]

# ———————————————— 画布与合成 ————————————————
class Canvas:
    def __init__(s, cam):
        s.cx, s.cy, s.z = cam; s.im = Image.new('RGBA', (W * SS, H * SS), BG + (255,)); s.d = ImageDraw.Draw(s.im)
    def P(s, x, y): return ((x - s.cx) * s.z * SS + W * SS / 2, (y - s.cy) * s.z * SS + H * SS / 2)
    def k(s): return s.z * SS
    def paste(s, src, x0, y0):
        x0, y0 = int(round(x0)), int(round(y0)); W2, H2 = s.im.size
        cx0, cy0 = max(0, -x0), max(0, -y0); cx1, cy1 = min(src.width, W2 - x0), min(src.height, H2 - y0)
        if cx1 <= cx0 or cy1 <= cy0: return
        s.im.alpha_composite(src.crop((cx0, cy0, cx1, cy1)), dest=(x0 + cx0, y0 + cy0))
    def rect(s, x0, y0, x1, y1, col): s.d.rectangle([*s.P(x0, y0), *s.P(x1, y1)], fill=col)
    def line(s, pts, w, col): s.d.line([s.P(*p) for p in pts], fill=col, width=max(1, int(round(w * s.k()))))
    def dot(s, x, y, r, col): X, Y = s.P(x, y); R = r * s.k(); s.d.ellipse([X - R, Y - R, X + R, Y + R], fill=col)
    def text(s, x, y, txt, size, col, key, anchor='ls', reveal=1.0):
        if reveal <= 0: return 0.0
        f = font(key, size * s.k()); X, Y = s.P(x, y)
        if reveal >= 1:
            s.d.text((X, Y), txt, font=f, fill=col, anchor=anchor); return f.getlength(txt) / s.k()
        b = f.getbbox(txt, anchor=anchor); pad = 4
        im = Image.new('RGBA', (b[2] - b[0] + 2 * pad, b[3] - b[1] + 2 * pad), col + (0,))
        ImageDraw.Draw(im).text((pad - b[0], pad - b[1]), txt, font=f, fill=col + (255,), anchor=anchor)
        a = np.asarray(im, np.float32).copy(); w = a.shape[1]; soft = 40 * s.k()
        ramp = np.clip((reveal * (w + soft) - np.arange(w)) / soft, 0, 1)
        a[..., 3] *= ramp[None, :]
        s.paste(Image.fromarray(a.astype(np.uint8), 'RGBA'), X + b[0] - pad, Y + b[1] - pad)
        return f.getlength(txt) / s.k()
    def sticker(s, name, wx, wy, sc=1.0, rot=0.0, lift=0.0, alpha=1.0, flip=False):
        """贴纸合成：lift 0 = 贴实（投影近而实），1 = 刚拍下前悬在半空（投影远而虚、淡）。"""
        spr = sprite('mouseL' if (name == 'mouse' and flip) else name)
        k = s.z * SS * sc / SPR
        im = spr.resize((max(1, int(spr.width * k)), max(1, int(spr.height * k))), Image.BICUBIC)
        if rot: im = im.rotate(rot, Image.BICUBIC, expand=True)
        if alpha < 1:                                                 # 拍下的头 3 帧淡入，避免整张贴纸一帧蹦出
            ar = np.asarray(im).copy(); ar[..., 3] = (ar[..., 3] * alpha).astype(np.uint8); im = Image.fromarray(ar, 'RGBA')
        X, Y = s.P(wx, wy); x0, y0 = X - im.width / 2, Y - im.height / 2
        blur = lerp(5, 26, lift) * s.z * SS; off = (lerp(4, 30, lift) * s.z * SS, lerp(7, 46, lift) * s.z * SS); op = lerp(0.32, 0.14, lift)
        pad = int(3 * blur) + 2
        a = np.pad(np.asarray(im.getchannel('A'), np.float32) / 255, pad)
        sa = cv2.GaussianBlur(a, (0, 0), blur) * op
        sh = np.dstack([np.full(sa.shape + (3,), (24, 34, 52), np.float32), sa[..., None] * 255]).astype(np.uint8)
        s.paste(Image.fromarray(sh, 'RGBA'), x0 - pad + off[0], y0 - pad + off[1])
        s.paste(im, x0, y0)

def slap(t, t0, dur=0.42, s0=1.35, r0=-10.0, r1=0.0):
    """贴纸拍下：从放大、倾斜、悬空落到原位，back.out 收尾。返回 (scale, rot, lift)；t0 之前返回 None。"""
    if t < t0: return None
    u = seg(t, t0, t0 + dur); e = back_out(u, 1.6)
    return lerp(s0, 1.0, e), lerp(r0, r1, p4o(u)), 1 - p3o(u), cl((t - t0) / 0.1)

# ———————————————— 画面内容 ————————————————
def grid(C):
    step = 40; k = C.z * SS
    x0 = math.floor((C.cx - W / 2 / C.z) / step) * step; y0 = math.floor((C.cy - H / 2 / C.z) / step) * step
    r = 2.0 * k
    for x in np.arange(x0, x0 + W / C.z + 2 * step, step):
        for y in np.arange(y0, y0 + H / C.z + 2 * step, step):
            X, Y = C.P(x, y); C.d.ellipse([X - r, Y - r, X + r, Y + r], fill=DOT)

def section(C, x, y, num, label, sub, t0, t):
    rv = p3o(seg(t, t0, t0 + 0.5))
    if rv <= 0: return
    C.rect(x, y - 13, x + 26, y + 13, RED)
    w = C.text(x + 44, y, num, 32, INK, F_BOLD, 'lm', rv)
    w2 = C.text(x + 44 + w + 22, y, label, 32, INK, F_BOLD, 'lm', rv)
    C.text(x + 44 + w + 22 + w2 + 26, y, sub, 26, GREY, F_MED, 'lm', rv)

def title(C, x, y, parts, size, t0, dur, t):
    rv = seg(t, t0, t0 + dur); rv = p3o(rv)
    if rv <= 0: return
    f = font(F_TITLE, size * 10); widths = [f.getlength(p) / 10 for p, _ in parts]; tot = sum(widths); acc = 0.0
    for (p, col), w in zip(parts, widths):
        loc = cl((rv * tot - acc) / w); C.text(x + acc, y, p, size, col, F_TITLE, 'ls', loc); acc += w

VALS = [2, 5, 11, 23, 48]; PX = 7.4                     # 每只老鼠 7.4 px，柱高严格成比例
CH_X0, CH_X1, CH_Y0 = 980, 1750, 860                   # 图表区：x 范围、零线 y
def chart(C, t):
    C.text(900, 400, 'MICE AT THE GRAIN STORE', 34, INK, F_BOLD, 'ls', p3o(seg(t, 0.8, 1.3)))
    C.text(900, 438, 'Illustrative counts, by month', 26, GREY, F_MED, 'ls', p3o(seg(t, 0.9, 1.4)))
    for j, v in enumerate(range(0, 60, 10)):                                   # 网格线自左向右画出
        u = p3o(seg(t, 1.0 + j * 0.05, 1.5 + j * 0.05))
        if u <= 0: continue
        y = CH_Y0 - v * PX
        C.line([(CH_X0, y), (lerp(CH_X0, CH_X1, u), y)], 3 if v == 0 else 1.5, INK if v == 0 else (198, 207, 217))
        C.text(CH_X0 - 18, y, str(v), 24, GREY, F_NUM, 'rm', u)
    shown = 0
    for i, v in enumerate(VALS):
        t0 = 1.2 + i * 0.32; u = p3o(seg(t, t0, t0 + 0.62))
        bx = CH_X0 + 40 + i * 152; bw = 104
        C.text(bx + bw / 2, CH_Y0 + 42, f'MONTH {i + 1}', 22, GREY, F_BOLD, 'ms', p3o(seg(t, 1.1 + i * 0.05, 1.5 + i * 0.05)))
        if u <= 0.01: continue
        hgt = max(2.0, v * PX * u); col = RED if i == len(VALS) - 1 else INK
        C.rect(bx, CH_Y0 - hgt, bx + bw, CH_Y0 - 1.5, col)
        n = int(round(v * u)); shown = max(shown, n)
        C.text(bx + bw / 2, CH_Y0 - hgt - 14, str(n), 40, col, F_NUM, 'ms')
    # 大计数器：跟着柱子滚动
    if t >= 1.3:
        w = C.text(1750, 404, str(shown), 150, RED, F_NUM, 'rs')
        C.text(1750 - w - 18, 404, 'MICE', 40, INK, F_BOLD, 'rs', p3o(seg(t, 1.3, 1.7)))

MICE_A = [(205, 905, 0.0, False), (640, 912, 3.0, True), (624, 560, -6.0, True), (215, 568, 5.0, False), (700, 760, -3.0, True)]
def region_a(C, t):
    section(C, 110, 112, '03', 'THE GRAIN STORE', 'Neolithic field notes', -0.25, t)
    title(C, 108, 262, [('MICE', RED), (' FOUND THE GRAIN', INK)], 112, -0.15, 0.6, t)
    chart(C, t)
    s = slap(t, -0.12, 0.45, 1.25, -8, -2)
    C.sticker('jar', 430, 720, s[0], s[1], s[2], s[3])
    for k, (x, y, r, fl) in enumerate(MICE_A):
        s = slap(t, 0.4 + k * 0.22, 0.36, 1.4, r - 12, r)
        if s: C.sticker('mouse', x, y, s[0] * 0.95, s[1], s[2], s[3], flip=fl)

MICE_B = [(2700, 985, 4.0), (2880, 1000, -3.0)]
CAT = (2250, 705)
def region_b(C, t):
    section(C, 1935, 222, '04', 'ENTER THE PREDATOR', 'Near East, ~10,000 years ago', 3.85, t)
    title(C, 1932, 366, [('THEN THE ', INK), ('WILDCAT', RED), (' ARRIVED', INK)], 104, 4.0, 0.8, t)
    for k, (x, y, r) in enumerate(MICE_B):                                   # 两只老鼠：先拍上，猫一落地就往右逃
        s = slap(t, 5.0 + k * 0.16, 0.34, 1.4, r - 12, r)
        if not s: continue
        u = back_in(seg(t, 6.06 + k * 0.08, 6.6 + k * 0.08), 1.3)
        C.sticker('mouse', x + 1100 * u, y - 30 * math.sin(math.pi * cl(u * 1.4)), s[0] * 0.9, s[1] - 8 * u, s[2], s[3])
    s = slap(t, 5.78, 0.5, 1.3, -14, -3)
    if s:
        C.sticker('cat', CAT[0], CAT[1], s[0], s[1], s[2], s[3])
    # 标签：引线先画，再拍上标签贴纸，最后补一行说明
    u = p3o(seg(t, 6.38, 6.7))
    if u > 0:
        ax, ay = 2330, 712; bx, by = 2575, 590
        C.line([(ax, ay), (lerp(ax, bx, u), lerp(ay, by, u))], 3, INK); C.dot(ax, ay, 9, RED)
    s = slap(t, 6.52, 0.42, 1.3, -7, -1.5)
    if s: C.sticker('tag', 2990, 590, s[0], s[1], s[2], s[3])
    C.text(2600, 712, "Ancestor of today's house cats", 40, INK, F_BOLD, 'ls', p3o(seg(t, 6.95, 7.45)))
    C.text(2600, 764, 'Small, sandy, faint tabby stripes, ringed tail', 28, GREY, F_MED, 'ls', p3o(seg(t, 7.1, 7.6)))

def frame(i):
    t = i / FPS
    C = Canvas(camera(t))
    grid(C)
    region_a(C, t)
    region_b(C, t)
    img = cv2.resize(np.asarray(C.im.convert('RGB')), (W, H), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(OUT, f'{i + 1:04d}.png'), img[..., ::-1])

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
