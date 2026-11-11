#!/usr/bin/env python3
"""S05 复古纸张拼贴 B（英文讲解版）：Why did cats move in with us?
用法: JOBS=8 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
原 B 是第三方日文讲解片；用户要求开场组的 B 换成英文讲解，这里用同一题材（猫怎么住进人类村子）重新做一支，构图和素材全部自绘。
做法（对齐上游参考包 S05 的拼贴配方）：
- 每个元素是一张剪纸：形状遮罩先模糊再加噪声阈值，得到撕纸毛边；需要的元素外面再撕一圈白纸边；底下一层软投影。
- 纸材是 512 平铺的周期纹理：牛皮纸、旧报纸小字、蓝天半调网点、稻草斜纹、陶土、灰鼠纸、虎斑纸……
- 标题和字幕是勒索信字：每个字母单独一块纸片，字体、底色、角度各不相同，逐字按拍拍上去。
- 元素动作按 12 fps 走（每拍停两帧半），毛边每拍换一张（3 张循环，定格动画的 boil），镜头整体做手持微抖。
节拍：0–2.4 s 标题 → 2.4–2.75 s 标题纸整张被抽走 → 村子：老鼠奔向存粮（STORED GRAIN DREW MICE）→
4.6 s 野猫从右侧走进，老鼠四散（…AND MICE DREW WILDCATS）→ 6.4 s 贴上 WILDCAT 标签，停到 8 s。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, SS, FPS, N, TS = 1920, 1080, 2, 30, 240, 512
SUP = '/System/Library/Fonts/Supplemental/'
FONTS = [(SUP + 'Impact.ttf', 0), (SUP + 'Arial Black.ttf', 0), (SUP + 'Georgia Bold.ttf', 0), (SUP + 'Rockwell.ttc', 2),
         (SUP + 'Futura.ttc', 4), (SUP + 'Didot.ttc', 2), (SUP + 'AmericanTypewriter.ttc', 2), (SUP + 'Courier New Bold.ttf', 0),
         (SUP + 'Bodoni 72.ttc', 2), (SUP + 'Copperplate.ttc', 2)]
TYPE = (SUP + 'AmericanTypewriter.ttc', 0)
_fc = {}
def font(key, size):
    k = (key, int(size))
    if k not in _fc: _fc[k] = ImageFont.truetype(key[0], int(size), index=key[1])
    return _fc[k]

# —— 周期噪声与纸材纹理（512 平铺） ——
def pnoise(sigma, seed):
    w = np.random.default_rng(seed).standard_normal((TS, TS)); f = np.fft.fftfreq(TS)
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * g)); return ((n - n.mean()) / n.std()).astype(np.float32)
TEAR = [0.7 * pnoise(2.0, 10 + b) + 0.5 * pnoise(6.0, 20 + b) for b in range(3)]       # 撕边噪声，3 张循环
yy, xx = np.mgrid[0:TS, 0:TS].astype(np.float32)
def dots(cell, ang=15):
    r = math.radians(ang); u = (xx * math.cos(r) + yy * math.sin(r)) * 2 * math.pi / cell; v = (-xx * math.sin(r) + yy * math.cos(r)) * 2 * math.pi / cell
    return (np.cos(u) * np.cos(v) + 1) / 2
def paper(rgb, n1=0.05, n2=0.03, seed=0):
    t = np.ones((TS, TS, 3), np.float32) * np.array(rgb, np.float32) / 255
    return t * (1 + n1 * pnoise(10, seed)[..., None] + n2 * pnoise(1.0, seed + 1)[..., None])
def halftone(rgb, ink, cell, cover, seed):
    t = paper(rgb, seed=seed); m = np.clip((cover - dots(cell)) * 8, 0, 1)[..., None]
    return t * (1 - m) + np.array(ink, np.float32) / 255 * m
def newsprint():
    im = Image.new('RGB', (TS, TS), (232, 226, 210)); d = ImageDraw.Draw(im); f = font((SUP + 'Times New Roman.ttf', 0), 11)
    rs = np.random.default_rng(5); al = 'abcdefghijklmnopqrstuvwxyz'
    for col in range(4):
        for row in range(40):
            s = ' '.join(''.join(al[i] for i in rs.integers(0, 26, rs.integers(2, 9))) for _ in range(7))
            d.text((col * 128 + 4, row * 12.8 + 2), s[:22], font=f, fill=(70, 66, 60))
    for col in range(1, 4): d.line([(col * 128 - 2, 0), (col * 128 - 2, TS)], fill=(150, 145, 135))
    return np.asarray(im, np.float32) / 255 * (1 + 0.04 * pnoise(12, 6)[..., None])
def stripes(a, b, period, ang, seed):
    r = math.radians(ang); m = ((xx * math.cos(r) + yy * math.sin(r)) % period < period / 2)[..., None]
    return np.where(m, paper(a, seed=seed), paper(b, seed=seed + 3))
def straw():
    t = paper((214, 170, 78), seed=40)
    for k, s in enumerate((3.0, 1.2)):
        n = pnoise(s, 41 + k); line = np.sin((xx * 0.7 + yy * 0.7) / 3.2 + 2.5 * n) > 0.55
        t = np.where(line[..., None], t * np.array([0.78, 0.72, 0.6], np.float32), t)
    return t
def grid():
    t = paper((240, 238, 228), seed=50); m = ((xx % 24) < 1.5) | ((yy % 24) < 1.5)
    return np.where(m[..., None], np.array([0.62, 0.74, 0.86], np.float32), t)
TEX = {
    'kraft': paper((176, 138, 96), 0.07, 0.05, 1), 'ground': paper((205, 170, 118), 0.06, 0.04, 2),
    'white': paper((246, 243, 233), 0.02, 0.02, 3), 'news': newsprint(), 'grid': grid(),
    'sky': halftone((150, 200, 228), (232, 244, 250), 11, 0.32, 4), 'sun': halftone((247, 140, 40), (226, 84, 30), 9, 0.4, 5),
    'yellowdot': halftone((250, 214, 60), (236, 170, 30), 10, 0.45, 6),
    'grass': paper((96, 160, 74), 0.08, 0.05, 7), 'grass2': paper((66, 126, 64), 0.08, 0.05, 8),
    'straw': straw(), 'mud': paper((186, 132, 82), 0.09, 0.05, 9), 'dark': paper((66, 44, 34), 0.05, 0.04, 10),
    'terra': halftone((186, 92, 52), (214, 128, 82), 8, 0.22, 11), 'grain': paper((240, 200, 80), 0.08, 0.08, 12),
    'mouse': paper((150, 150, 156), 0.06, 0.05, 13), 'pink': paper((244, 168, 180), 0.04, 0.03, 14),
    'tabby': paper((206, 150, 90), 0.08, 0.05, 15), 'tabbyd': paper((92, 62, 40), 0.06, 0.05, 16), 'cream': paper((244, 226, 192), 0.04, 0.03, 17),
    'eye': paper((150, 196, 70), 0.03, 0.02, 18), 'black': paper((28, 26, 26), 0.04, 0.03, 19), 'red': halftone((210, 40, 36), (176, 24, 24), 8, 0.3, 20),
    'yellow': paper((250, 212, 52), 0.04, 0.03, 21), 'blue': halftone((44, 92, 176), (30, 64, 140), 8, 0.3, 22),
    'tape': paper((236, 224, 186), 0.03, 0.02, 23), 'bluetape': stripes((40, 80, 170), (240, 236, 224), 22, 45, 24),
    'band': stripes((120, 52, 30), (232, 210, 160), 14, 90, 25),
}

def crop(tile, ox, oy, w, h):
    return tile[np.ix_((np.arange(h) + oy) % TS, (np.arange(w) + ox) % TS)]

def blend(cv, X0, Y0, a, col):
    """把 alpha a（h×w）和颜色 col（h×w×3 或 3）合到画布，自动裁到画面内。"""
    h, w = a.shape; x0, y0 = max(X0, 0), max(Y0, 0); x1, y1 = min(X0 + w, W), min(Y0 + h, H)
    if x1 <= x0 or y1 <= y0: return
    aa = a[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0, None]
    c = col[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0] if np.ndim(col) == 3 else np.array(col, np.float32)
    cv[y0:y1, x0:x1] = cv[y0:y1, x0:x1] * (1 - aa) + c * aa

def bbox(shapes):
    xs, ys = [], []
    for s in shapes:
        k = s[0]
        if k in ('poly', 'line'):
            pad = s[2] / 2 if k == 'line' else 0
            xs += [p[0] - pad for p in s[1]] + [p[0] + pad for p in s[1]]; ys += [p[1] - pad for p in s[1]] + [p[1] + pad for p in s[1]]
        elif k == 'ell': xs += [s[1] - s[3], s[1] + s[3]]; ys += [s[2] - s[4], s[2] + s[4]]
        elif k == 'rect': xs += [s[1], s[3]]; ys += [s[2], s[4]]
        elif k == 'text':
            b = ImageDraw.Draw(Image.new('L', (1, 1))).textbbox((s[1], s[2]), s[3], font=font(s[4], s[5]), anchor=s[6]); xs += [b[0], b[2]]; ys += [b[1], b[3]]
    return min(xs), min(ys), max(xs), max(ys)

def piece(cv, shapes, tex, seed, b, torn=True, rim=0, shadow=0.3, angle=0.0, alpha=1.0, rough=1.0):
    """一张剪纸。shapes 用画面坐标；tex 为纹理名或 RGB(0–1)；b 为 boil 序号（每拍换一张撕边）。"""
    x0, y0, x1, y1 = bbox(shapes); r = max(x1 - x0, y1 - y0) / 2
    pad = int(24 + rim + abs(math.sin(math.radians(angle))) * r)
    X0, Y0 = int(x0) - pad, int(y0) - pad; w, h = int(x1 - x0) + 2 * pad, int(y1 - y0) + 2 * pad
    im = Image.new('L', (w * SS, h * SS), 0); d = ImageDraw.Draw(im); T = lambda x, y: ((x - X0) * SS, (y - Y0) * SS)
    for s in shapes:
        k = s[0]
        if k == 'poly': d.polygon([T(*p) for p in s[1]], fill=255)
        elif k == 'line': d.line([T(*p) for p in s[1]], fill=255, width=int(s[2] * SS), joint='curve')
        elif k == 'ell': d.ellipse([*T(s[1] - s[3], s[2] - s[4]), *T(s[1] + s[3], s[2] + s[4])], fill=255)
        elif k == 'rect': d.rectangle([*T(s[1], s[2]), *T(s[3], s[4])], fill=255)
        elif k == 'text': d.text(T(s[1], s[2]), s[3], font=font(s[4], s[5] * SS), anchor=s[6], fill=255)
    if angle: im = im.rotate(angle, resample=Image.BICUBIC, center=T((x0 + x1) / 2, (y0 + y1) / 2))
    m = cv2.resize(np.asarray(im, np.float32) / 255, (w, h), interpolation=cv2.INTER_AREA)
    ox, oy = (seed * 131) % TS, (seed * 71) % TS
    if torn:
        n = crop(TEAR[b % 3], ox, oy, w, h)
        core = np.clip((cv2.GaussianBlur(m, (0, 0), 2.2 * rough) - 0.5 + 0.13 * rough * n) * 9 + 0.5, 0, 1)
    else: core = m
    full = core
    if rim:
        n2 = crop(TEAR[(b + 1) % 3], oy, ox, w, h)
        mr = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * rim + 1, 2 * rim + 1)))
        full = np.maximum(core, np.clip((cv2.GaussianBlur(mr, (0, 0), 3) - 0.5 + 0.22 * n2) * 9 + 0.5, 0, 1))
    if shadow: blend(cv, X0 + 7, Y0 + 10, cv2.GaussianBlur(full, (0, 0), 6) * shadow * alpha, (0.12, 0.08, 0.05))
    if rim: blend(cv, X0, Y0, full * alpha, crop(TEX['white'], oy, ox, w, h))
    col = crop(TEX[tex], ox, oy, w, h) if isinstance(tex, str) else np.array(tex, np.float32)
    blend(cv, X0, Y0, core * alpha, col)

# —— 勒索信字 ——
STYLES = [('white', (0.08, 0.08, 0.08)), ('black', (0.97, 0.95, 0.9)), ('red', (0.98, 0.96, 0.9)), ('yellow', (0.08, 0.08, 0.08)),
          ('news', (0.08, 0.08, 0.08)), ('blue', (0.98, 0.96, 0.9)), ('pink', (0.1, 0.08, 0.08)), ('white', (0.78, 0.12, 0.1)), ('grid', (0.08, 0.08, 0.08))]
def ransom(cv, text, cx, y, size, t_in, step, te, b, seed, show=True, left=False):
    rs = np.random.default_rng(seed); items = []
    for ch in text:
        if ch == ' ': items.append(None); continue
        st = STYLES[rs.integers(len(STYLES))]; fk = FONTS[rs.integers(len(FONTS))]; sc = rs.uniform(0.86, 1.12)
        items.append((ch, st, fk, size * sc, rs.uniform(-7, 7), rs.uniform(-6, 6)))
    adv = [0.42 * size if it is None else font(it[2], it[3]).getlength(it[0]) + 30 for it in items]
    x = cx if left else cx - sum(adv) / 2
    for i, (it, a) in enumerate(zip(items, adv)):
        ti = t_in + i * step
        if it is not None and show and te >= ti:
            ch, (bg, fg), fk, sz, ang, dy = it; pop = 1.14 if te < ti + 1 / 12 + 1e-6 else 1.0; sz *= pop
            fx, fy = x + a / 2, y + dy; fw = font(fk, sz).getlength(ch)
            piece(cv, [('rect', fx - fw / 2 - 12, fy - sz * 0.58, fx + fw / 2 + 12, fy + sz * 0.58)], bg, seed + i, b, rough=0.7, shadow=0.35, angle=ang)
            piece(cv, [('text', fx, fy, ch, fk, sz, 'mm')], fg, seed + i + 50, b, torn=False, shadow=0, angle=ang)
        x += a

ease = lambda u: 1 - (1 - min(max(u, 0), 1)) ** 3

def mouse(cv, x, gy, dirn, te, b, seed, run=True):
    K = 1.9; q = lambda lx, ly: (x + lx * K * dirn, gy + ly * K)
    bob = (-5 if int(te * 12) % 2 else 0) if run else (-3 if int(te * 12) % 3 == 0 else 0)
    Q = lambda lx, ly: (q(lx, ly)[0], q(lx, ly)[1] + bob)
    piece(cv, [('line', [Q(-32, -14), Q(-62, -24), Q(-90, -10)], 4)], 'pink', seed, b, torn=False, shadow=0.2)
    piece(cv, [('ell', *Q(0, -20), 36 * K, 19 * K), ('poly', [Q(24, -34), Q(24, -6), Q(64, -16)])], 'mouse', seed + 1, b, rim=3)
    piece(cv, [('ell', *Q(20, -40), 13 * K, 13 * K)], 'mouse', seed + 2, b, shadow=0.15)
    piece(cv, [('ell', *Q(20, -40), 7 * K, 7 * K)], 'pink', seed + 3, b, shadow=0)
    piece(cv, [('ell', *Q(46, -22), 3.5, 3.5), ('ell', *Q(64, -16), 4, 4)], (0.1, 0.08, 0.08), seed + 4, b, torn=False, shadow=0)

def cat(cv, cx, gy, te, b, walking, look):
    """侧身野猫，脸朝左。局部 x 往右是尾巴方向。"""
    K = 1.25; p = te * 2 * math.pi * 1.7; bob = -5 * abs(math.sin(p)) if walking else 0
    q = lambda lx, ly: (cx + lx * K, gy + ly * K + (bob if ly < -60 else 0))
    sw = (lambda ph: 0.38 * math.sin(p + ph)) if walking else (lambda ph: 0.0)
    def leg(hx, hy, ph, tex, sd):
        a = sw(ph); hip = q(hx, hy); foot = (hip[0] + 118 * K * math.sin(a), hip[1] + 118 * K * math.cos(a))
        piece(cv, [('line', [hip, foot], 30 * K), ('ell', foot[0] - 8, foot[1] - 2, 24 * K, 12 * K)], tex, sd, b, rough=0.8)
    leg(-95, -128, math.pi, 'tabbyd', 301); leg(105, -132, 0, 'tabbyd', 302)                       # 远侧两条腿
    flick = math.sin(te * 2 * math.pi * 0.9) * (14 if not walking else 8)
    tail = [q(140, -168), q(192, -200 + flick * 0.2), q(226, -252), q(236 + flick, -302), q(214 + flick * 1.4, -338)]
    piece(cv, [('line', tail, 26 * K)], 'tabby', 303, b, rim=3)
    piece(cv, [('line', tail[-2:], 26 * K)], 'tabbyd', 304, b, shadow=0)
    piece(cv, [('ell', *q(0, -150), 152 * K, 62 * K)], 'tabby', 305, b, rim=4)
    for i, sx in enumerate((-55, -15, 25, 65, 102)):
        top = -150 - 62 * math.sqrt(max(0, 1 - (sx / 152) ** 2)) + 8
        piece(cv, [('poly', [q(sx - 12, top), q(sx + 12, top), q(sx + 6, top + 50), q(sx - 4, top + 52)])], 'tabbyd', 310 + i, b, shadow=0, rough=0.7)
    piece(cv, [('ell', *q(-12, -116), 112 * K, 26 * K)], 'cream', 306, b, shadow=0.1)
    leg(-80, -126, 0, 'tabby', 307); leg(120, -130, math.pi, 'tabby', 308)                        # 近侧两条腿
    hy = -215 + (-10 if look else 0)
    piece(cv, [('poly', [q(-210, hy - 38), q(-222, hy - 102), q(-168, hy - 58)]), ('poly', [q(-152, hy - 52), q(-122, hy - 104), q(-112, hy - 44)])], 'tabby', 320, b, rim=3)
    piece(cv, [('poly', [q(-206, hy - 46), q(-214, hy - 88), q(-180, hy - 58)]), ('poly', [q(-142, hy - 56), q(-124, hy - 92), q(-120, hy - 52)])], 'pink', 321, b, shadow=0)
    piece(cv, [('ell', *q(-166, hy), 64 * K, 60 * K)], 'tabby', 322, b, rim=4)
    for i, mx in enumerate((-182, -166, -150)):
        piece(cv, [('line', [q(mx, hy - 54), q(mx + 3, hy - 30)], 8)], 'tabbyd', 323 + i, b, shadow=0, torn=False)
    piece(cv, [('ell', *q(-206, hy + 22), 32 * K, 24 * K)], 'cream', 326, b, shadow=0.1)
    piece(cv, [('ell', *q(-182, hy - 12), 15 * K, 10 * K)], 'eye', 327, b, shadow=0, rough=0.5)
    piece(cv, [('ell', *q(-182 - (3 if look else 0), hy - 12), 3.5 * K, 9 * K)], (0.06, 0.06, 0.05), 328, b, torn=False, shadow=0)
    piece(cv, [('poly', [q(-236, hy + 10), q(-218, hy + 10), q(-228, hy + 22)])], 'pink', 329, b, torn=False, shadow=0)
    for dy in (14, 26): piece(cv, [('line', [q(-214, hy + dy), q(-290, hy + dy - 12 + dy * 0.4)], 2.5)], (0.2, 0.15, 0.12), 330 + dy, b, torn=False, shadow=0)

CLOUDS = [(260, 150, 1.0), (980, 95, 0.8), (1380, 230, 0.65)]
GRAIN = [(1000 + 85 * math.cos(a) * (1 + 0.18 * math.sin(5 * a)), 812 + 26 * math.sin(a) * (1 + 0.25 * math.cos(3 * a))) for a in np.linspace(0, 2 * math.pi, 28)[:-1]]
SPECK = [(np.random.default_rng(9).uniform(920, 1080), np.random.default_rng(10 + k).uniform(796, 830)) for k in range(18)]

def village(cv, te, b):
    blend(cv, 0, 0, np.ones((H, W), np.float32), crop(TEX['ground'], 0, 0, W, H))
    piece(cv, [('rect', -60, -60, W + 60, 640)], 'sky', 1, b, shadow=0.25, rough=2.0)
    piece(cv, [('ell', 1660, 170, 112, 112)], 'sun', 2, b, rim=6)
    for k, (x, y, s) in enumerate(CLOUDS):
        x += te * 22 * s
        piece(cv, [('ell', x, y, 110 * s, 38 * s), ('ell', x - 60 * s, y + 8, 60 * s, 28 * s), ('ell', x + 40 * s, y - 22 * s, 64 * s, 40 * s)], 'white', 3 + k, b, shadow=0.2)
    hill = lambda y0, amp, ph: [(-60, H)] + [(x, y0 + amp * math.sin(x / 260 + ph)) for x in range(-60, W + 120, 60)] + [(W + 60, H)]
    piece(cv, [('poly', hill(560, 22, 0.8))], 'grass2', 7, b, rough=1.6, shadow=0.3)
    piece(cv, [('poly', hill(604, 14, 2.4))], 'grass', 8, b, rough=1.6, shadow=0.3)
    piece(cv, [('poly', [(-60, H + 60)] + [(x, 650 + 8 * math.sin(x / 90)) for x in range(-60, W + 120, 60)] + [(W + 60, H + 60)])], 'ground', 9, b, rough=2.2, shadow=0.35)
    for k, (x, y, s) in enumerate([(120, 900, 1.0), (640, 790, 0.8), (1760, 820, 1.1), (1300, 930, 0.9), (520, 960, 0.7)]):   # 草丛
        piece(cv, [('poly', [(x - 40 * s, y), (x - 26 * s, y - 52 * s), (x - 10 * s, y - 12 * s), (x, y - 70 * s), (x + 12 * s, y - 14 * s), (x + 30 * s, y - 56 * s), (x + 42 * s, y)])], 'grass2' if k % 2 else 'grass', 50 + k, b, shadow=0.25)
    # 两间茅屋
    for k, (x0, x1, top, base, rh) in enumerate([(190, 450, 560, 722, 128), (1440, 1630, 590, 706, 104)]):
        piece(cv, [('rect', x0, top, x1, base)], 'mud', 20 + k, b, rim=3)
        piece(cv, [('rect', (x0 + x1) / 2 - 30 * (x1 - x0) / 260, base - 100 * (x1 - x0) / 260, (x0 + x1) / 2 + 30 * (x1 - x0) / 260, base)], 'dark', 24 + k, b, shadow=0.1)
        piece(cv, [('poly', [(x0 - 34, top + 16), ((x0 + x1) / 2, top - rh), (x1 + 34, top + 16)])], 'straw', 22 + k, b, rim=4, rough=1.4)
    # 陶罐存粮
    for k, (x, y, rx, ry) in enumerate([(860, 668, 62, 72), (990, 646, 78, 94), (1108, 690, 48, 54)]):
        piece(cv, [('rect', x - rx * 0.42, y - ry - 26, x + rx * 0.42, y - ry + 12), ('ell', x, y - ry - 26, rx * 0.56, 11)], 'terra', 30 + k, b, shadow=0.2)
        piece(cv, [('ell', x, y, rx, ry)], 'terra', 33 + k, b, rim=3)
        piece(cv, [('rect', x - rx * 0.96, y - ry * 0.32, x + rx * 0.96, y - ry * 0.12)], 'band', 36 + k, b, shadow=0.1, rough=0.6)
    piece(cv, [('poly', GRAIN)], 'grain', 40, b, shadow=0.25)
    for k, (sx, sy) in enumerate(SPECK): piece(cv, [('ell', sx, sy, 5, 3)], (0.72, 0.5, 0.16), 41 + k, b, torn=False, shadow=0)
    # 左上角年代条
    piece(cv, [('rect', 40, 34, 860, 142)], 'news', 60, b, rim=5, angle=-2)
    ransom(cv, '10,000 YEARS AGO', 62, 88, 44, 2.55, 0.03, te, b, 700, left=True)

def title(cv, te, b):
    blend(cv, 0, 0, np.ones((H, W), np.float32), crop(TEX['kraft'], 0, 0, W, H))
    piece(cv, [('ell', 1600, 300, 240, 240)], 'yellowdot', 80, b, rim=7)
    piece(cv, [('rect', 170, 150, 1330, 720)], 'news', 81, b, rim=6, angle=-3, rough=1.6)
    piece(cv, [('rect', 1250, 640, 1720, 930)], 'grid', 82, b, rim=4, angle=4)
    piece(cv, [('rect', -100, 880, 820, 950)], 'bluetape', 83, b, angle=-8, rough=0.6, shadow=0.25)
    for k, (x, y, a) in enumerate([(190, 160, -38), (1310, 170, 32), (1270, 650, -10)]):
        piece(cv, [('rect', x - 70, y - 22, x + 70, y + 22)], 'tape', 84 + k, b, angle=a, alpha=0.82, shadow=0.12, rough=0.6)
    piece(cv, [('rect', 70, 990, 640, 1046)], 'white', 90, b, shadow=0.25, rough=0.6)
    piece(cv, [('text', 90, 1018, 'N°05 — PAPER COLLAGE EXPLAINER', TYPE, 26, 'lm')], (0.15, 0.13, 0.12), 91, b, torn=False, shadow=0)
    ransom(cv, 'WHY DID CATS', 820, 330, 124, 0.15, 0.06, te, b, 100)
    ransom(cv, 'MOVE IN WITH US?', 860, 540, 108, 0.95, 0.05, te, b, 200)
    if te >= 1.45:                                                     # 一只老鼠先从底部窜过去
        mouse(cv, -120 + (te - 1.45) * 1500, 850, 1, te, b, 400)

def frame(i):
    t = i / FPS; te = math.floor(t * 12) / 12; b = int(te * 12) % 3
    cv = np.zeros((H, W, 3), np.float32)
    if te < 2.4: title(cv, te, b)
    else:
        village(cv, te, b)
        # 老鼠：2.9 s 起依次跑向谷堆，啃几拍，6.0 s 猫一停就四散
        for k in range(4):
            t0 = 2.9 + 0.18 * k; tx = 900 + k * 78; gy = 846 + (k % 2) * 30
            if te < t0: continue
            if te < 6.0:
                x = -140 + (tx + 140) * ease((te - t0) / 1.2); mouse(cv, x, gy, 1, te, b, 500 + 10 * k, run=te < t0 + 1.2)
            else:
                x = tx - (te - 6.0) * (1500 + 200 * k)
                if x > -200: mouse(cv, x, gy + 8 * math.sin(k), -1, te, b, 500 + 10 * k)
        if te >= 4.6:
            u = ease((te - 4.6) / 1.5); cat(cv, 2240 - (2240 - 1480) * u, 868, te, b, walking=u < 0.98, look=te >= 6.2)
        if te >= 6.4:
            pop = 1.12 if te < 6.4 + 1 / 12 + 1e-6 else 1.0
            piece(cv, [('poly', [(1200, 480), (1240, 480), (1240, 520), (1262, 520), (1220, 560), (1178, 520), (1200, 520)])], 'red', 600, b, rim=3, angle=-12)
            piece(cv, [('rect', 1110, 360, 1110 + 330 * pop, 360 + 92 * pop)], 'black', 601, b, rim=6, angle=-4)
            piece(cv, [('text', 1110 + 165 * pop, 406, 'WILDCAT', (SUP + 'Impact.ttf', 0), 72 * pop, 'mm')], (0.97, 0.95, 0.9), 602, b, torn=False, shadow=0, angle=-4)
            if te >= 6.75:
                piece(cv, [('rect', 1150, 452, 1400, 496)], 'white', 603, b, rough=0.6, angle=3)
                piece(cv, [('text', 1275, 474, 'Felis lybica', TYPE, 28, 'mm')], (0.15, 0.13, 0.12), 604, b, torn=False, shadow=0, angle=3)
        if te < 5.1: ransom(cv, 'STORED GRAIN DREW MICE', W / 2, 985, 66, 3.0, 0.045, te, b, 800)
        else: ransom(cv, '...AND MICE DREW WILDCATS', W / 2, 985, 66, 5.2, 0.04, te, b, 900)
        if te < 2.76:                                                  # 标题纸整张往左抽走
            sheet = np.zeros_like(cv); title(sheet, 2.4, b); u = ease((te - 2.4) / 0.36)
            M = cv2.getRotationMatrix2D((W / 2, H / 2), 7 * u, 1.0); M[0, 2] -= 2300 * u; M[1, 2] -= 60 * u
            sh = cv2.warpAffine(sheet, M, (W, H)); ma = np.ones((H, W), np.float32)
            n = crop(TEAR[b], 0, 0, 80, H); ma[:, W - 80:] = np.clip((np.linspace(1, -1, 80)[None] * 2.5 + 0.6 * n), 0, 1)
            ma = cv2.warpAffine(ma, M, (W, H))
            cv *= 1 - 0.4 * cv2.GaussianBlur(np.roll(ma, (14, 18), (0, 1)), (0, 0), 14)[..., None]
            cv[:] = cv * (1 - ma[..., None]) + sh * ma[..., None]
    # 灯光：左上偏亮的翻拍光 + 每拍纸面噪点 + 手持微抖
    gy_, gx_ = np.mgrid[0:H, 0:W].astype(np.float32)
    light = 1.05 - 0.12 * np.hypot((gx_ / W - 0.35) * 1.2, gy_ / H - 0.3)
    rs = np.random.default_rng(int(te * 12))
    cv = cv * light[..., None] * (1 + 0.012 * rs.standard_normal((H, W, 1)).astype(np.float32))
    k12 = int(te * 12); s = 1.012 + 0.012 * ease(t / 8)
    M = cv2.getRotationMatrix2D((W / 2 + 2.2 * math.sin(k12 * 1.7), H / 2 + 2.0 * math.cos(k12 * 2.3)), 0.12 * math.sin(k12 * 0.9), s)
    cv = cv2.warpAffine(cv, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    cv2.imwrite(os.path.join(OUT, f'{i + 1:04d}.png'), np.clip(cv[..., ::-1] * 255, 0, 255).astype(np.uint8))

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
