#!/usr/bin/env python3
"""S19 水彩手绘 B（英文讲解版，节拍 2）：STORED GRAIN DREW MICE → THEN CAME THE WILDCAT
用法: JOBS=8 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
原 B 是第三方日文讲解片；这里只讲第 2 拍（存粮招来老鼠，野猫从芦苇里走出来），构图和角色全部自绘。
做法（对齐上游参考包 S19 配方：透明笔触叠色、飞白、纸白当高光、逐笔上色）：
- 一切都是笔触：沿路径做变宽色带（每段一块凸四边形），再叠一组毛刷轨迹（每根刷毛有自己的墨量、断续和枯竭点），
  干笔时色带提前收掉，只剩刷毛，得到飞白。天空、地面、陶罐、猫身都是宽笔触，没有平涂色块。
- 颜料按透射叠加：画面 = 纸色 × exp(−Σ 浓度 × 吸收)，越叠越深，颜色透明。
- 每笔上纸后做水彩处理：边缘积色（fringe）、低频积水不匀、纸纹颗粒沉淀（granulation）、湿笔外晕（wet-in-wet）、
  大面积 wash 里的回流花（bloom）在晾干时长出来；刚画的笔触偏深，0.8 s 内晾干变浅。
- 纸白当高光：云、陶罐高光、猫胸口都是从浓度里提白，不是画白色。
- 主体（老鼠、猫）先在背景里留白（knock-out），再上色，模拟水彩画家给主体留纸。
节拍：0–1.9 s 逐笔画出天空、山、土地、泥砖房、陶罐和芦苇，字幕 STORED GRAIN DREW MICE 手写写出 →
1.6–3.9 s 四只老鼠一走一停溜向谷堆 → 4.0 s 字幕薄雾擦除换成 THEN CAME THE WILDCAT，芦苇抖动 →
4.3–6.6 s 虎斑野猫从右边芦苇里走出来，老鼠停住竖耳 → 6.2 s 手写批注 wildcat · Felis lybica 带引线 → 停到 8 s（尾巴、芦苇、镜头还在动）。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, FPS, N, TS, SS = 1920, 1080, 30, 240, 512, 2
SUP = '/System/Library/Fonts/Supplemental/'
HAND = SUP + 'Bradley Hand Bold.ttf'

# —— 噪声场 ——
def fnoise(sigma, seed, h=H, w=W):
    """全画面低频/中频噪声，均值 0 方差 1。大 sigma 先在小图上做再放大。"""
    rs = np.random.default_rng(seed); f = max(1, int(sigma // 6))
    n = rs.standard_normal((h // f + 2, w // f + 2)).astype(np.float32)
    n = cv2.GaussianBlur(n, (0, 0), sigma / f)
    if f > 1: n = cv2.resize(n, (w + 2 * f, h + 2 * f), interpolation=cv2.INTER_CUBIC)[:h, :w]
    else: n = n[:h, :w]
    return (n - n.mean()) / n.std()
def pnoise(sigma, seed):
    """512 平铺噪声，给会移动的角色用（纹理跟着角色走）。"""
    w = np.random.default_rng(seed).standard_normal((TS, TS)); f = np.fft.fftfreq(TS)
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * g)); return ((n - n.mean()) / n.std()).astype(np.float32)

LO, MID = fnoise(60, 1), fnoise(12, 2)
TOOTH = 0.55 * fnoise(1.4, 3) + 0.7 * fnoise(3.2, 4); TOOTH = (TOOTH - TOOTH.mean()) / TOOTH.std()
T_LO, T_MID, T_GR = pnoise(26, 11), pnoise(6, 12), 0.75 * pnoise(1.1, 13) + 0.45 * pnoise(2.8, 14)
T_GR = (T_GR - T_GR.mean()) / T_GR.std()

# —— 暖色棉纸 ——
PAPER_BASE = np.array([245, 239, 225], np.float32) / 255
def make_paper():
    p = np.ones((H, W, 3), np.float32) * PAPER_BASE
    p *= (1 + 0.016 * LO + 0.010 * MID)[..., None]
    p *= (1 - 0.022 * np.clip(TOOTH, 0, 3) + 0.008 * np.clip(-TOOTH, 0, 3))[..., None]   # 冷压纸的纸纹
    fib = np.zeros((H, W), np.float32); rs = np.random.default_rng(7)
    for _ in range(900):                                                                      # 棉纤维
        x, y, a, l = rs.uniform(0, W), rs.uniform(0, H), rs.uniform(0, math.pi), rs.uniform(8, 30)
        pts = np.array([[x + math.cos(a) * l * u + 3 * math.sin(u * 5), y + math.sin(a) * l * u] for u in np.linspace(-0.5, 0.5, 6)], np.int32)
        cv2.polylines(fib, [pts], False, float(rs.choice([-1, 1]) * rs.uniform(0.3, 1)), 1, cv2.LINE_AA)
    p *= (1 + 0.018 * cv2.GaussianBlur(fib, (0, 0), 0.6))[..., None]
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
    p *= (1.0 - 0.05 * (((gx / W - 0.5) * 1.3) ** 2 + ((gy / H - 0.5) * 1.5) ** 2))[..., None]
    return p
PAPER = make_paper()

# —— 颜料：给出“满浓度时在纸上的颜色”，换算成吸收 ——
def pig(r, g, b): return -np.log(np.array([r, g, b], np.float32) / 255 / PAPER_BASE)
PIG = {
    'sky': pig(178, 198, 210), 'sky2': pig(204, 212, 216), 'sun': pig(242, 194, 136), 'hill': pig(186, 176, 186), 'hill2': pig(170, 182, 160),
    'sand': pig(234, 214, 172), 'ochre': pig(220, 182, 128), 'ochre2': pig(196, 146, 92), 'brick': pig(206, 150, 104), 'shade': pig(170, 150, 160),
    'sienna': pig(190, 112, 76), 'umber': pig(112, 80, 58), 'sepia': pig(70, 52, 42), 'grain': pig(232, 190, 92),
    'reed': pig(168, 170, 112), 'reed2': pig(132, 140, 92), 'seed': pig(132, 92, 62),
    'mouse': pig(146, 144, 146), 'pink': pig(226, 156, 150), 'cat': pig(216, 172, 112), 'catd': pig(168, 112, 66),
    'stripe': pig(92, 66, 48), 'tip': pig(44, 36, 32), 'eye': pig(150, 176, 82), 'swatch': pig(232, 214, 176),
}

def clip01(u): return min(max(u, 0.0), 1.0)
def sm(u): u = clip01(u); return u * u * (3 - 2 * u)
def rv(t, t0, dur): return sm((t - t0) / dur)
def ease(u): u = clip01(u); return 1 - (1 - u) ** 3

# —— 笔触引擎 ——
def catmull(pts, step=3.0):
    p = np.asarray(pts, np.float32)
    if len(p) == 2: p = np.array([p[0], (p[0] + p[1]) / 2, p[1]], np.float32)
    P = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]]); out = []
    for i in range(len(p) - 1):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        k = max(2, int(np.linalg.norm(p2 - p1) / step)); t = np.linspace(0, 1, k, endpoint=False)[:, None]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(p[-1:]); return np.vstack(out)

def taper(a=0.15, b=0.3, lo=0.08, pa=0.5, pb=0.7):
    return lambda u: lo + (1 - lo) * np.minimum(1, u / a) ** pa * np.minimum(1, np.maximum(1 - u, 0) / b) ** pb

DEFAULT = taper()
def brush(pts, wmax, reveal=1.0, seed=0, dry=0.0, prof=None, streak=0.2, K=None):
    """变宽笔触 + 毛刷轨迹。返回 (遮罩 h×w, X0, Y0)。reveal 0–1 为已画出的比例。"""
    if reveal <= 0: return None
    P = catmull(pts, float(np.clip(wmax / 12, 1.2, 4.0))); d = np.diff(P, axis=0); seg = np.hypot(d[:, 0], d[:, 1])
    s = np.concatenate([[0], np.cumsum(seg)]); L = s[-1]
    if L < 1: return None
    u = s / L; keep = u <= reveal + 1e-6
    if keep.sum() < 2: return None
    tg = np.gradient(P, axis=0); tg /= np.maximum(np.hypot(tg[:, 0], tg[:, 1]), 1e-6)[:, None]; nr = np.stack([-tg[:, 1], tg[:, 0]], 1)
    w = wmax * (prof or DEFAULT)(u)
    if reveal < 1:                                                       # 画到一半时笔头是圆的
        srev = reveal * L; w = w * np.sqrt(np.clip((srev - s) / max(wmax * 0.5, 1) + 0.15, 0, 1))
    P, u, w, nr, s = P[keep], u[keep], w[keep], nr[keep], s[keep]
    X0, Y0 = int(P[:, 0].min() - wmax - 6), int(P[:, 1].min() - wmax - 6)
    pw, ph = int(P[:, 0].max() - X0 + wmax + 7), int(P[:, 1].max() - Y0 + wmax + 7)
    img = np.zeros((ph * SS, pw * SS), np.uint8); Q = (P - [X0, Y0]) * SS; hw = (w * SS / 2)[:, None]
    Lp, Rp = Q + nr * hw, Q - nr * hw
    core = np.ones(len(u), np.float32) if dry <= 0 else 1 - np.clip((u - (1 - dry)) / max(0.6 * dry, 1e-3), 0, 1)
    sh = 4; Qi = (Q * (1 << sh)).astype(np.int32); Ri = np.maximum(hw[:, 0] * (1 << sh), 1 << sh).astype(np.int32)
    if L < 1.2 * wmax:                                                   # 点子：沿路径扫圆盘，形状是圆的
        for i in range(len(Q)):
            c = int(255 * core[i])
            if c >= 4: cv2.circle(img, (int(Qi[i, 0]), int(Qi[i, 1])), int(Ri[i]), c, -1, cv2.LINE_AA, sh)
    else:                                                                # 长笔：逐段凸四边形，笔头平、靠毛边和毛刷收
        for i in range(len(Q) - 1):
            c = int(255 * core[i])
            if c < 4: continue
            quad = np.array([Lp[i], Lp[i + 1], Rp[i + 1], Rp[i]]) * (1 << sh)
            cv2.fillConvexPoly(img, quad.astype(np.int32), c, cv2.LINE_AA, sh)
    rs = np.random.default_rng(seed)
    K = K or int(np.clip(wmax / 2.2, 5, 44))
    v = np.sort(rs.uniform(-1, 1, K)) * 0.95; inten = rs.uniform(1 - streak, 1, K)
    th = max(1, int(round(wmax * SS / K * 1.25)))
    ends = 1 - dry * rs.uniform(0.0, 0.9, K) ** 0.8; f1 = rs.uniform(1 / 70, 1 / 18, K); phs = rs.uniform(0, 6.3, K)
    for k in range(K):                                                   # 毛刷轨迹：各自断续、各自枯竭
        g = np.sin(s * 2 * math.pi * f1[k] + phs[k]) + 0.6 * np.sin(s * 2 * math.pi * f1[k] * 2.7 + 2 * phs[k])
        thr = -2 + dry * (0.6 + 2.6 * u ** 1.4)
        on = (u <= ends[k]) & (g > thr)
        if not on.any(): continue
        pts_k = (Q + nr * (v[k] * hw)) * (1 << sh)
        idx = np.flatnonzero(np.diff(np.concatenate([[0], on.astype(np.int8), [0]])))
        runs = [pts_k[a:b].astype(np.int32) for a, b in zip(idx[::2], idx[1::2]) if b - a >= 2]
        if runs: cv2.polylines(img, runs, False, int(255 * inten[k] * (0.85 if dry > 0 else 1)), th, cv2.LINE_AA, sh)
    m = cv2.resize(img, (pw, ph), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    return m, X0, Y0

def noise_patch(field, tilefield, x0, y0, w, h, ofs):
    if ofs is None: return field[y0:y0 + h, x0:x0 + w]
    return tilefield[np.ix_((np.arange(h) + y0 - int(ofs[1])) % TS, (np.arange(w) + x0 - int(ofs[0])) % TS)]

def paint(D, r, color, k=1.0, fringe=0.5, gran=0.3, halo=0.0, pool=0.25, ofs=None, rough=0.25, lift=None):
    """把一笔的遮罩变成水彩浓度叠到 D：边缘积色、积水不匀、颗粒沉淀、湿晕。"""
    if r is None: return
    m, X0, Y0 = r; h, w = m.shape
    if halo > 0:
        m = np.maximum(m, cv2.GaussianBlur(m, (0, 0), halo) * 0.5)
    x0, y0, x1, y1 = max(X0, 0), max(Y0, 0), min(X0 + w, W), min(Y0 + h, H)
    if x1 <= x0 or y1 <= y0: return
    lo = noise_patch(LO, T_LO, X0, Y0, w, h, ofs) if (ofs is not None or (X0 >= 0 and Y0 >= 0 and X0 + w <= W and Y0 + h <= H)) else None
    if lo is None:                                                       # 越界的大笔触：在画面内取噪声
        m = m[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0]; X0, Y0 = x0, y0; h, w = m.shape
        lo = noise_patch(LO, T_LO, X0, Y0, w, h, None)
    md = noise_patch(MID, T_MID, X0, Y0, w, h, ofs); gr = noise_patch(TOOTH, T_GR, X0, Y0, w, h, ofs)
    if rough: m = np.clip(m * (1 + rough * 0.6 * md) - rough * 0.12, 0, 1)
    edge = np.clip(m - cv2.GaussianBlur(m, (0, 0), 3.5), 0, 1)
    dens = k * (m * (1 - pool + pool * (0.55 + 0.45 * np.tanh(lo))) + fringe * 2.2 * edge)
    dens = dens * np.clip(1 + 0.38 * gran * gr, 0.5, 2)
    if lift is not None: dens = dens * (1 - lift[:h, :w] if lift.shape == m.shape else 1)
    D[y0:y1, x0:x1] += dens[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0, None] * PIG[color]

def stroke(D, pts, wmax, color, t=None, t0=0, dur=0.4, seed=0, dry=0.0, prof=None, k=1.0, streak=0.2, wetfade=0.8, **kw):
    """按时间画出一笔：t0 起笔，dur 内画完；刚画完时偏深，wetfade 秒内晾干。"""
    rev = 1.0 if t is None else rv(t, t0, dur)
    if rev <= 0: return
    wet = 0.0 if t is None else clip01(1 - (t - t0 - dur) / wetfade)
    paint(D, brush(pts, wmax, rev, seed, dry, prof, streak), color, k * (1 + 0.22 * wet), **kw)

def bloom(D, cx, cy, r, amt, seed):
    """回流花：晾干时水回流，中间推开颜料、边上积一圈深色。amt 0–1 随时间长出来。"""
    if amt <= 0: return
    R = int(r * 1.6) + 8; x0, y0 = int(cx - R), int(cy - R)
    yy, xx = np.mgrid[0:2 * R, 0:2 * R].astype(np.float32)
    ang = np.arctan2(yy - R, xx - R); rs = np.random.default_rng(seed)
    wob = sum(rs.uniform(0.04, 0.12) * np.sin(f * ang + rs.uniform(0, 6.3)) for f in (3, 5, 8, 13))
    rr = np.hypot(xx - R, yy - R) / (r * (0.45 + 0.55 * amt) * (1 + wob))
    disk = np.clip((1 - rr) * 6, 0, 1); rim = np.clip(disk - cv2.GaussianBlur(disk, (0, 0), 3), 0, 1) * 2.5
    sl = D[max(y0, 0):min(y0 + 2 * R, H), max(x0, 0):min(x0 + 2 * R, W)]
    a, b = max(y0, 0) - y0, max(x0, 0) - x0; dk, rm = disk[a:a + sl.shape[0], b:b + sl.shape[1]], rim[a:a + sl.shape[0], b:b + sl.shape[1]]
    sl *= (1 - 0.45 * amt * dk + 0.9 * amt * rm)[..., None]

def lift(D, shapes, amt, blur=8, seed=0):
    """提白：把区域里的颜料洗掉，露出纸白。"""
    m = np.zeros((H, W), np.float32)
    for s in shapes:
        if s[0] == 'ell': cv2.ellipse(m, (int(s[1]), int(s[2])), (int(s[3]), int(s[4])), s[5] if len(s) > 5 else 0, 0, 360, 1.0, -1, cv2.LINE_AA)
        elif s[0] == 'poly': cv2.fillPoly(m, [np.array(s[1], np.int32)], 1.0, cv2.LINE_AA)
    b = cv2.GaussianBlur(m, (0, 0), blur); m = np.clip((b - 0.5 + 0.22 * MID) * 3 + 0.5, 0, 1) * np.clip(b / 0.25, 0, 1)
    D *= (1 - amt * m)[..., None]

# —— 背景：逐笔画出，0–2.7 s 之后不再变化（缓存） ——
def band(y, x0, x1, amp, seed, n=9):
    rs = np.random.default_rng(seed)
    return [(x, y + amp * math.sin(x / 210 + seed) + rs.uniform(-amp, amp) * 0.3) for x in np.linspace(x0, x1, n)]

JARS = [(930, 772, 205, 74), (1065, 792, 262, 92), (1185, 782, 168, 62)]       # 中心 x、底 y、高、最大半宽
def jar_r(v):                                                                     # v: 0 底 → 1 口，返回半宽比例
    return np.interp(v, [0, 0.08, 0.35, 0.55, 0.78, 0.88, 0.93, 1.0], [0.55, 0.72, 0.98, 1.0, 0.7, 0.42, 0.46, 0.5])

HOUSES = [(170, 462, 470, 706), (540, 742, 516, 690), (40, 168, 548, 650)]       # x0, x1, top, base

def background(t):
    D = np.zeros((H, W, 3), np.float32)
    # 天空：三道湿笔从左往右扫，上深下浅，湿中湿晕开
    for k, (y, wd, col, kk) in enumerate([(160, 230, 'sky', 0.85), (310, 220, 'sky', 0.5), (420, 150, 'sky2', 0.5)]):
        stroke(D, band(y, 50, 1880, 14, 30 + k), wd, col, t, 0.0 + 0.16 * k, 0.55, seed=30 + k, k=kk, halo=26, fringe=0.3, gran=0.18,
               prof=taper(0.05, 0.08, 0.2), streak=0.15, rough=0.35)
    if t > 0.5:                                                          # 云：纸白提出来
        a = rv(t, 0.5, 0.5)
        lift(D, [('ell', 760, 190, 210, 38), ('ell', 900, 168, 120, 30), ('ell', 1300, 300, 170, 28), ('ell', 330, 330, 150, 24)], 0.85 * a, 10)
    if t > 0.42: lift(D, [('ell', 330, 174, 62, 60)], 0.9 * rv(t, 0.42, 0.1), 3)
    stroke(D, [(326, 172), (334, 176)], 118, 'sun', t, 0.45, 0.25, seed=40, k=0.9, halo=10, fringe=0.9, prof=taper(0.3, 0.3, 0.6, 0.5, 0.5))
    bloom(D, 1450, 160, 70, rv(t, 0.8, 0.8), 41); bloom(D, 560, 250, 55, rv(t, 0.9, 0.8), 42)
    # 远山：变宽笔触的上沿就是山脊
    ridge = lambda x0, x1, base, hs, seed: ([(x, base - hs * (0.5 + 0.5 * math.sin(x / 170 + seed)) * (0.6 + 0.4 * math.sin(x / 61 + 2 * seed)) / 2) for x in np.linspace(x0, x1, 40)],
                                            lambda u, x0=x0, x1=x1: (0.25 + 0.75 * (0.5 + 0.5 * np.sin((x0 + u * (x1 - x0)) / 170 + seed)) * (0.6 + 0.4 * np.sin((x0 + u * (x1 - x0)) / 61 + 2 * seed))))
    pts, pf = ridge(50, 1880, 540, 150, 3); stroke(D, pts, 150, 'hill', t, 0.35, 0.6, seed=50, k=0.55, halo=6, prof=pf, rough=0.4)
    pts, pf = ridge(50, 1880, 556, 80, 5); stroke(D, pts, 80, 'hill2', t, 0.5, 0.6, seed=51, k=0.6, halo=5, prof=pf, rough=0.4)
    # 土地：沙色、赭石一道道往下叠，越往前越深，下沿参差留纸白
    for k, (y, wd, col, kk) in enumerate([(590, 130, 'sand', 0.8), (690, 150, 'sand', 0.85), (780, 150, 'ochre', 0.5), (860, 120, 'ochre', 0.62)]):
        stroke(D, band(y, 40 + 20 * k, 1890 - 15 * k, 10, 60 + k), wd, col, t, 0.3 + 0.14 * k, 0.55, seed=60 + k, k=kk, halo=8, fringe=0.55,
               gran=0.4, prof=taper(0.04, 0.06, 0.25), streak=0.2, rough=0.4)
    bloom(D, 300, 820, 60, rv(t, 1.1, 0.7), 43); bloom(D, 1620, 650, 50, rv(t, 1.2, 0.7), 44)
    for k in range(9):                                                   # 地面干笔
        x = 120 + k * 205 + 40 * math.sin(k * 3.1); y = 640 + 90 * ((k * 37) % 3)
        stroke(D, [(x, y), (x + 120, y - 4), (x + 210, y + 3)], 16, 'ochre2', t, 1.0 + 0.05 * k, 0.3, seed=70 + k, dry=0.85, k=0.55, gran=0.5)
    # 泥砖房：竖向宽笔铺墙，右侧阴影面，门洞，梁头，碎线（不闭合）
    for h_, (x0, x1, top, base) in enumerate(HOUSES):
        t0 = 0.7 + 0.18 * h_; fade = 0.55 if h_ == 2 else 1.0; n = max(2, int((x1 - x0) / 85))
        for j in range(n):
            x = x0 + (j + 0.5) * (x1 - x0) / n
            stroke(D, [(x, base + 4), (x + 3, (top + base) / 2), (x - 2, top - 2)], (x1 - x0) / n * 1.35, 'brick', t, t0 + 0.06 * j, 0.32,
                   seed=100 + 10 * h_ + j, k=0.62 * fade, prof=taper(0.03, 0.03, 0.85), fringe=0.6, halo=3, gran=0.45, streak=0.3)
        sw = (x1 - x0) * 0.13                                            # 侧面阴影
        stroke(D, [(x1 + sw / 2, base - 6), (x1 + sw / 2, top + 14)], sw, 'shade', t, t0 + 0.3, 0.25, seed=120 + h_, k=0.8 * fade,
               prof=taper(0.04, 0.04, 0.8), halo=3)
        stroke(D, [(x0 - 10, top + 2), ((x0 + x1) / 2, top - 4), (x1 + sw + 8, top + 6)], 22, 'ochre2', t, t0 + 0.32, 0.25, seed=125 + h_, k=0.8 * fade, dry=0.3)
        dx = (x0 + x1) / 2 - (x1 - x0) * 0.08; dh = (base - top) * 0.45; dw = (x1 - x0) * 0.13
        stroke(D, [(dx, base), (dx, base - dh * 0.7), (dx + 2, base - dh)], dw * 2, 'umber', t, t0 + 0.42, 0.2, seed=130 + h_, k=0.95 * fade,
               prof=taper(0.02, 0.35, 0.55, 0.5, 0.6), halo=2)
        wx = x0 + (x1 - x0) * 0.22; wy = top + (base - top) * 0.3
        stroke(D, [(wx, wy), (wx + (x1 - x0) * 0.1, wy + 2)], 20, 'umber', t, t0 + 0.48, 0.12, seed=135 + h_, k=0.8 * fade, prof=taper(0.1, 0.1, 0.6))
        for j in range(4 if h_ < 2 else 2):                              # 屋顶梁头
            bx = x0 + 20 + j * (x1 - x0 - 40) / 3
            stroke(D, [(bx, top + 10), (bx + 2, top - 18)], 8, 'sepia', t, t0 + 0.5 + 0.03 * j, 0.1, seed=140 + 5 * h_ + j, k=0.7 * fade, dry=0.3)
        stroke(D, [(x0 + 6, top + 18), (x0 + 3, (top + base) / 2), (x0 + 6, base - 30)], 5, 'sepia', t, t0 + 0.55, 0.25, seed=150 + h_, k=0.5 * fade, dry=0.7)
        for j in range(5 if h_ < 2 else 0):                              # 砖缝几笔
            bx = x0 + 30 + (j * 53) % (x1 - x0 - 70); by = top + 40 + (j * 41) % int(base - top - 70)
            stroke(D, [(bx, by), (bx + 34, by + 1)], 5, 'umber', t, t0 + 0.6 + 0.03 * j, 0.1, seed=160 + 7 * h_ + j, k=0.4, dry=0.5)
        stroke(D, [(x0 - 20, base + 6), (x1 + 60, base + 10)], 18, 'shade', t, t0 + 0.45, 0.25, seed=170 + h_, k=0.6 * fade, halo=4, dry=0.2)
    # 陶罐：一笔从底往上，笔宽就是罐身；右侧再压一笔深色，左侧提白，口沿和锯齿纹干笔
    for j, (cx, by, hh, rr) in enumerate(JARS):
        t0 = 0.95 + 0.15 * j
        stroke(D, [(cx, by), (cx, by - hh * 0.5), (cx, by - hh)], 2 * rr, 'sienna', t, t0, 0.42, seed=200 + j, k=0.62,
               prof=lambda u: jar_r(u), fringe=0.7, halo=3, gran=0.5, streak=0.3, rough=0.3)
        stroke(D, [(cx + rr * 0.45, by - 6), (cx + rr * 0.55, by - hh * 0.5), (cx + rr * 0.3, by - hh * 0.82)], rr * 0.85, 'sienna', t, t0 + 0.3, 0.3,
               seed=210 + j, k=0.55, prof=lambda u: 0.3 + 0.7 * np.sin(np.pi * np.clip(u, 0, 1)) ** 0.6, halo=6, fringe=0.5)
        if t > t0 + 0.35:
            a = rv(t, t0 + 0.35, 0.3)
            lift(D, [('ell', cx - rr * 0.42, by - hh * 0.5, rr * 0.11, hh * 0.24, -4)], 0.8 * a, 3)
        stroke(D, [(cx - rr * 0.52, by - hh + 2), (cx, by - hh - 4), (cx + rr * 0.52, by - hh + 2)], 13, 'umber', t, t0 + 0.42, 0.15, seed=220 + j, k=0.9, dry=0.2)
        zz = [(cx - rr * 0.9 + i * rr * 0.18, by - hh * 0.66 + (8 if i % 2 else -8)) for i in range(11)]
        stroke(D, zz, 5, 'umber', t, t0 + 0.5, 0.3, seed=230 + j, k=0.65, dry=0.45)
        stroke(D, [(cx - rr * 0.95, by - hh * 0.55), (cx - rr * 0.9, by - hh * 0.25), (cx - rr * 0.6, by - 4)], 4.5, 'sepia', t, t0 + 0.55, 0.25, seed=240 + j, k=0.5, dry=0.6)
        stroke(D, [(cx - rr * 1.1, by + 6), (cx + rr * 1.5, by + 10)], 20, 'shade', t, t0 + 0.4, 0.2, seed=245 + j, k=0.7, halo=5)
    # 谷堆：低矮一笔 + 一把点子
    for g, (gx, gy, gw) in enumerate([(1000, 800, 160), (1140, 806, 120)]):
        stroke(D, [(gx - gw, gy + 8), (gx, gy - 6), (gx + gw, gy + 8)], 30, 'grain', t, 1.4 + 0.1 * g, 0.3, seed=250 + g, k=1.0,
               prof=lambda u: 0.15 + 0.85 * np.sin(np.pi * np.clip(u, 0, 1)) ** 0.7, fringe=0.8, gran=0.6)
    rs = np.random.default_rng(260)
    for k in range(46):
        gx, gy = rs.uniform(820, 1250), rs.uniform(796, 846); a = rs.uniform(0, 3.14)
        stroke(D, [(gx, gy), (gx + 7 * math.cos(a), gy + 4 * math.sin(a))], rs.uniform(5, 8), 'grain' if k % 3 else 'ochre2', t, 1.55 + 0.006 * k, 0.08,
               seed=270 + k, k=1.1, fringe=0.9, gran=0.2, rough=0.1)
    # 村边几株灌木点
    for k, (x, y) in enumerate([(760, 560), (800, 548), (1300, 540), (1620, 545), (95, 540)]):
        stroke(D, [(x - 34, y + 6), (x, y - 2), (x + 38, y + 5)], 24, 'reed2', t, 1.0 + 0.04 * k, 0.2, seed=280 + k, k=0.4, halo=6, dry=0.3,
               prof=lambda u: 0.2 + 0.8 * np.sin(np.pi * np.clip(u, 0, 1)) ** 0.6)
    # 字幕底色：一笔浅赭
    stroke(D, band(978, 470, 1450, 6, 90, 5), 116, 'swatch', t, 0.45, 0.45, seed=90, k=0.85, halo=6, fringe=0.6, gran=0.35,
           prof=taper(0.04, 0.05, 0.3, 0.4, 0.5), streak=0.3, rough=0.6)
    return D

_bg = {}
T_BG = 2.7
def background_cached(t):
    if t < T_BG: return background(t)
    if 'D' not in _bg: _bg['D'] = background(T_BG)
    return _bg['D'].copy()

# —— 芦苇（每帧摆动） ——
rs_ = np.random.default_rng(300)
REEDS = []
for k in range(19):
    x = 1470 + k * 22 + rs_.uniform(-14, 14); base = rs_.uniform(842, 905); hgt = rs_.uniform(320, 540)
    REEDS.append(dict(x=x, base=base, h=hgt, lean=rs_.uniform(-40, 30), w=rs_.uniform(5, 8), ph=rs_.uniform(0, 6.3), front=(k % 2 == 1) and x > 1700,
                      head=k % 3 == 0, leaf=rs_.uniform(-1, 1), t0=0.75 + 0.035 * k, col='reed2' if k % 2 else 'reed', seed=310 + 9 * k))
def reed(D, r, t, catx):
    sway = 10 * math.sin(t * 2 * math.pi * 0.35 + r['ph']) + 4 * math.sin(t * 2 * math.pi * 0.9 + 2 * r['ph'])
    if 4.0 < t < 7.0:                                                    # 猫穿过时芦苇被拨开
        near = math.exp(-((r['x'] - catx) / 140) ** 2); sway += near * 45 * math.sin((t - 4.0) * 7) * math.exp(-(t - 4.0) * 0.8)
    def p(v): return (r['x'] + r['lean'] * v + (sway * v * v), r['base'] - r['h'] * v)
    pts = [p(v) for v in (0, 0.35, 0.7, 1.0)]
    stroke(D, pts, r['w'], r['col'], t, r['t0'], 0.45, seed=r['seed'], dry=0.35, k=0.95, prof=taper(0.02, 0.5, 0.05, 0.4, 0.8), gran=0.3, halo=1.5)
    lf = [p(0.25), (p(0.45)[0] + 60 * r['leaf'] + sway * 0.4, p(0.45)[1]), (p(0.6)[0] + 110 * r['leaf'] + sway * 0.7, p(0.6)[1] + 30)]
    stroke(D, lf, r['w'] * 1.6, r['col'], t, r['t0'] + 0.15, 0.4, seed=r['seed'] + 1, dry=0.3, k=0.8, prof=taper(0.15, 0.6, 0.0, 0.6, 1.0), halo=1.5)
    if r['head']:
        stroke(D, [p(0.8), p(0.9)], r['w'] * 2.0, 'seed', t, r['t0'] + 0.35, 0.2, seed=r['seed'] + 2, k=0.95, prof=taper(0.3, 0.3, 0.3), fringe=0.8, halo=2)

# —— 角色：先在背景里留白，再上色 ——
class Fig:
    """一个角色的所有笔触。group 相同的笔触先并成一块再一次上色（同一笔湿颜料，内部没有接缝，只有外沿积色）。"""
    def __init__(self, ofs): self.items = []; self.ofs = ofs; self.groups = {}
    def add(self, pts, wmax, color, seed, sil=True, dry=0.0, prof=None, k=1.0, streak=0.15, group=None, **kw):
        r = brush(pts, wmax, 1.0, seed, dry, prof, streak)
        if r is None: return
        if group is None: self.items.append((r, color, k, sil, kw)); return
        if group not in self.groups: self.groups[group] = []; self.items.append((('G', group), color, k, sil, kw))
        self.groups[group].append(r)
    def merged(self, name):
        rs = self.groups[name]; X0 = min(r[1] for r in rs); Y0 = min(r[2] for r in rs)
        X1 = max(r[1] + r[0].shape[1] for r in rs); Y1 = max(r[2] + r[0].shape[0] for r in rs)
        m = np.zeros((Y1 - Y0, X1 - X0), np.float32)
        for mm, x, y in rs: sl = m[y - Y0:y - Y0 + mm.shape[0], x - X0:x - X0 + mm.shape[1]]; np.maximum(sl, mm, out=sl)
        return m, X0, Y0
    def draw(self, D, knock=0.9):
        self.items = [(self.merged(r[1]) if isinstance(r[0], str) else r, c, k, sil, kw) for r, c, k, sil, kw in self.items]
        S = None
        for (m, X0, Y0), _, _, sil, _ in self.items:
            if not sil: continue
            if S is None: S = np.zeros((H, W), np.float32)
            x0, y0, x1, y1 = max(X0, 0), max(Y0, 0), min(X0 + m.shape[1], W), min(Y0 + m.shape[0], H)
            if x1 > x0 and y1 > y0: S[y0:y1, x0:x1] = np.maximum(S[y0:y1, x0:x1], m[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0])
        if S is not None: D *= (1 - knock * np.clip(cv2.GaussianBlur(S, (0, 0), 1.5) * 1.3, 0, 1))[..., None]
        for r, color, k, sil, kw in self.items:
            kw.setdefault('ofs', self.ofs); paint(D, r, color, k, **kw)

def mouse(D, x, gy, dirn, t, seed, run, alert=0.0, look=0.0):
    K = 2.0; bob = -4 * abs(math.sin(t * 2 * math.pi * 6 + seed)) if run else 0
    q = lambda lx, ly: (x + lx * K * dirn, gy + ly * K + (bob if ly < -6 else 0))
    f = Fig((x, gy)); hy = -12 - 4 * alert
    f.add([q(-32, -6), q(-60, -2 - 6 * math.sin(t * 5 + seed)), q(-86, -14 + 4 * math.sin(t * 4 + seed))], 4.5, 'pink', seed, sil=False,
          prof=taper(0.05, 0.9, 0.1), k=0.9, dry=0.3)
    f.add([q(-30, -15), q(0, -17 - 2 * alert), q(36 - 2 * look, hy)], 34 * K, 'mouse', seed + 1, group='b', prof=lambda u: np.clip(np.sqrt(np.clip(1.02 - u, 0, 1)) * np.minimum(1, u / 0.22) ** 0.45, 0.06, 1),
          fringe=0.8, gran=0.5, halo=1.5, rough=0.3)
    f.add([q(8, -31 - 5 * alert), q(10, -33 - 6 * alert)], 18 * K, 'mouse', seed + 2, group='b', prof=taper(0.4, 0.4, 0.4), k=1.15, fringe=1.0)
    f.add([q(9, -31 - 5 * alert), q(10, -32 - 6 * alert)], 9 * K, 'pink', seed + 3, sil=False, prof=taper(0.4, 0.4, 0.4), k=1.0)
    f.add([q(23, hy - 6), q(24, hy - 6.5)], 5.5, 'tip', seed + 4, sil=False, prof=taper(0.5, 0.5, 0.6), k=1.2, fringe=0, rough=0)
    f.add([q(37 - 2 * look, hy + 1), q(38 - 2 * look, hy + 1)], 5, 'pink', seed + 5, sil=False, prof=taper(0.5, 0.5, 0.6), k=1.2, rough=0)
    sw = math.sin(t * 2 * math.pi * 6 + seed) if run else 0
    for j, lx in enumerate((-14, 16)):                                    # 小脚
        a = (sw if j else -sw) * 6
        f.add([q(lx, -6), q(lx + a, 0)], 5, 'sepia', seed + 6 + j, sil=False, k=0.7, dry=0.2, rough=0)
    for j in range(2):                                                    # 胡须
        f.add([q(36, hy - 1 + 3 * j), q(52, hy - 5 + 8 * j)], 1.6, 'sepia', seed + 8 + j, sil=False, k=0.6, rough=0, fringe=0)
    f.add([q(-26, -26 - alert), q(4, -32 - 2 * alert), q(24, hy - 13)], 3.5, 'sepia', seed + 10, sil=False, k=0.5, dry=0.7, rough=0)  # 背上一道碎线
    f.draw(D)

def cat(D, cx, gy, t, walk, stop_t, look):
    """侧身虎斑野猫，脸朝左。walk 0–1 为走路幅度。"""
    K = 1.18; p = t * 2 * math.pi * 1.25
    bob = -4 * abs(math.sin(p)) * walk
    def q(lx, ly): return (cx + lx * K, gy + ly * K + (bob if ly < -90 else 0))
    f = Fig((cx, gy))
    hl = 10 * look                                                        # 停下后低头盯老鼠
    def leg(hx, hy, ph, col, seed, k=1.0, front=True):
        a = 0.42 * math.sin(p + ph) * walk; lift_ = max(0, math.sin(p + ph + 1.4)) * 18 * walk
        hip = q(hx, hy); L1 = 70 * K; L2 = 66 * K
        knee = (hip[0] + L1 * math.sin(a) + (0 if front else 14 * K), hip[1] + L1 * math.cos(a))
        foot = (knee[0] + L2 * math.sin(a * 0.5) - (0 if front else 10 * K), gy - lift_ * 0.6)
        g = 'b' if col == 'cat' else 'far' + str(seed)
        if not front:                                                    # 后腿：大腿一团
            f.add([(hip[0] - 4, hip[1] + 6), (hip[0] + 6, hip[1] + 14)], 62 * K, col, seed + 5, prof=taper(0.4, 0.4, 0.6), k=k, fringe=0.7, group=g, halo=1.5, gran=0.5)
        f.add([hip, knee, foot], 27 * K, col, seed, prof=lambda u: 1 - 0.35 * u, k=k, fringe=0.7, halo=1.5, gran=0.5, group=g)
        f.add([(foot[0] - 9, foot[1] - 7), (foot[0] + 3, foot[1] - 6)], 18 * K, col, seed + 1, prof=taper(0.3, 0.3, 0.6), k=k, group=g)
        for j, v in enumerate((0.35, 0.62)):                              # 腿上横纹
            px, py = hip[0] + (knee[0] - hip[0]) * v * 1.6 if v < 0.5 else knee[0] + (foot[0] - knee[0]) * (v - 0.5) * 2, hip[1] + (foot[1] - hip[1]) * v
            f.add([(px - 16 * K, py), (px + 15 * K, py + 3)], 9, 'stripe', seed + 2 + j, sil=False, dry=0.5, k=0.8, prof=taper(0.2, 0.5, 0.1))
    leg(-92, -128, math.pi, 'catd', 401, 0.75); leg(98, -132, 0, 'catd', 405, 0.75, front=False)     # 远侧两条腿
    flick = math.sin(t * 2 * math.pi * 0.8) * (16 if walk < 0.5 else 8)
    tail = [q(130, -170), q(190, -182), q(232, -214 + flick * 0.2), q(250 + flick * 0.5, -258), q(240 + flick, -294)]
    f.add(tail, 32 * K, 'cat', 410, group='b', prof=taper(0.05, 0.08, 0.75), fringe=0.7, halo=2, gran=0.5)
    P = catmull(tail, 2); Ls = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))]); Ls /= Ls[-1]
    pt = lambda v: tuple(P[np.searchsorted(Ls, v)])
    for j, v in enumerate((0.3, 0.48, 0.64)):                             # 尾环
        a_, b_ = pt(v), pt(v + 0.05); dx, dy = b_[0] - a_[0], b_[1] - a_[1]; n = math.hypot(dx, dy) + 1e-6; nx, ny = -dy / n * 22 * K, dx / n * 22 * K
        f.add([(a_[0] + nx, a_[1] + ny), (a_[0] - nx, a_[1] - ny)], 13, 'stripe', 411 + j, sil=False, dry=0.35, k=0.95, prof=taper(0.15, 0.3, 0.2))
    f.add([pt(0.86), pt(0.93), pt(0.999)], 24 * K, 'tip', 415, sil=False, prof=taper(0.05, 0.05, 0.75), k=1.0, fringe=0.5, halo=1)  # 黑尾尖
    body = [q(-110, -150), q(-40, -158), q(50, -158), q(118, -152)]
    f.add(body, 96 * K, 'cat', 420, group='b', prof=lambda u: 0.82 + 0.18 * np.cos(2 * np.pi * u), fringe=0.75, halo=2, gran=0.55, streak=0.25, rough=0.3)
    f.add([q(-112, -150), q(-104, -146)], 100 * K, 'cat', 418, group='b', prof=taper(0.4, 0.4, 0.7), fringe=0.7, halo=2)   # 胸
    f.add([q(112, -156), q(120, -150)], 96 * K, 'cat', 419, group='b', prof=taper(0.4, 0.4, 0.7), fringe=0.7, halo=2)    # 臀
    f.add([q(-120, -192), q(-20, -206), q(80, -204), q(140, -192)], 30 * K, 'catd', 421, sil=False, k=0.9, halo=6, prof=taper(0.1, 0.2, 0.2), fringe=0.3)  # 背脊深色湿中湿
    hy = -222 + hl
    f.add([q(-120, -165), q(-158, hy + 30), q(-180, hy + 8)], 74 * K, 'cat', 422, group='b', prof=taper(0.1, 0.3, 0.7), fringe=0.6, halo=1.5, gran=0.5)  # 脖子
    f.add([q(-176, hy), q(-212, hy + 4)], 98 * K, 'cat', 423, group='b', prof=taper(0.35, 0.35, 0.55, 0.5, 0.5), fringe=0.8, halo=1.5, gran=0.5)  # 头
    f.add([q(-226, hy + 18), q(-246, hy + 22)], 44 * K, 'cat', 424, prof=taper(0.3, 0.4, 0.6), group='b')              # 吻部
    for j, (bx, tx) in enumerate(((-210, -222), (-166, -160))):            # 耳朵：一笔从耳根撇到耳尖
        f.add([q(bx, hy - 30), q((bx + tx) / 2 - 2, hy - 56), q(tx, hy - 84 + (4 if look else 0))], 40 * K, 'cat' if j == 0 else 'catd', 425 + j, group='b' if j == 0 else None,
              prof=lambda u: np.clip(1 - u, 0.04, 1) ** 0.9, k=1.0, fringe=0.9, halo=1)
        f.add([q(bx + 4, hy - 38), q(tx + 2, hy - 72)], 12, 'pink', 427 + j, sil=False, prof=lambda u: np.clip(1 - u, 0.05, 1), k=0.7)
    stripes = [(-80, 0.0), (-46, 0.1), (-12, 0.15), (22, 0.1), (56, 0.12), (90, 0.05), (118, -0.05)]
    for j, (sx, lean) in enumerate(stripes):                              # 身上虎斑：干笔从背往肚子收
        top = q(sx, -205); bot = q(sx - 18 + 40 * lean, -132)
        f.add([top, ((top[0] + bot[0]) / 2 - 6, (top[1] + bot[1]) / 2), bot], 12, 'stripe', 430 + j, sil=False, dry=0.55, k=1.05,
              prof=taper(0.08, 0.7, 0.05, 0.4, 1.0), gran=0.4)
    for j, dx in enumerate((-8, 6, 20)):                                 # 额头竖纹
        f.add([q(-196 + dx * 0.6, hy - 40), q(-200 + dx * 0.7, hy - 16)], 6, 'stripe', 440 + j, sil=False, dry=0.4, k=0.95, prof=taper(0.1, 0.6, 0.1))
    f.add([q(-182, hy + 14), q(-160, hy + 22), q(-140, hy + 18)], 7, 'stripe', 444, sil=False, dry=0.4, k=0.9, prof=taper(0.1, 0.6, 0.1))
    ex, ey = q(-214, hy - 6)                                             # 眼睛
    f.add([(ex - 7, ey + 1), (ex + 7, ey - 1)], 19, 'eye', 445, sil=False, prof=taper(0.4, 0.4, 0.3), k=1.4, fringe=0.6, rough=0)
    f.add([(ex - 2 - 2 * look, ey - 7), (ex - 2 - 2 * look, ey + 7)], 5.5, 'tip', 446, sil=False, prof=taper(0.4, 0.4, 0.4), k=1.3, rough=0)
    f.add([q(-252, hy + 12), q(-246, hy + 14)], 12, 'pink', 447, sil=False, prof=taper(0.4, 0.4, 0.5), k=1.2, rough=0)
    for j in range(3):                                                   # 胡须
        a0 = q(-238, hy + 22 + 3 * j); f.add([a0, (a0[0] - 70, a0[1] - 10 + 12 * j)], 1.8, 'sepia', 448 + j, sil=False, k=0.55, rough=0, fringe=0)
    # 褐色碎线：背、胸、下巴，不闭合
    f.add([q(-110, -212), q(-30, -220), q(60, -216)], 4.5, 'sepia', 452, sil=False, dry=0.6, k=0.7, rough=0, fringe=0.2)
    f.add([q(-150, -150), q(-140, -112)], 4, 'sepia', 453, sil=False, dry=0.6, k=0.6, rough=0)
    f.add([q(-246, hy + 36), q(-220, hy + 46), q(-196, hy + 44)], 4, 'sepia', 454, sil=False, dry=0.5, k=0.6, rough=0)
    leg(-70, -126, 0, 'cat', 460); leg(118, -130, math.pi, 'cat', 465, front=False)                   # 近侧两条腿
    f.draw(D)
    # 胸口和肚子提白
    lift(D, [('ell', *q(-140, -150), 26 * K, 40 * K, 20), ('ell', *q(-20, -112), 90 * K, 14 * K), ('ell', *q(-232, hy + 30), 18 * K, 10 * K)], 0.45, 6)

# —— 手写字（字幕、批注） ——
_txt = {}
def text_mask(s, size, font=HAND):
    k = (s, size, font)
    if k not in _txt:
        f = ImageFont.truetype(font, size * SS); b = ImageDraw.Draw(Image.new('L', (1, 1))).textbbox((0, 0), s, font=f, anchor='ls')
        im = Image.new('L', (b[2] - b[0] + 8 * SS, b[3] - b[1] + 8 * SS), 0)
        ImageDraw.Draw(im).text((4 * SS - b[0], 4 * SS - b[1]), s, font=f, fill=255, anchor='ls')
        m = cv2.resize(np.asarray(im, np.float32) / 255, (im.width // SS, im.height // SS), interpolation=cv2.INTER_AREA)
        _txt[k] = (m, (b[0] - 4 * SS) // SS, (b[1] - 4 * SS) // SS)
    return _txt[k]

def write(D, s, x, y, size, t, t0, dur, out0=None, out_dur=0.4, k=1.25, anchor='m'):
    """手写出现：从左往右写出（带湿边），可选薄雾擦除。"""
    if t < t0: return
    m, ox, oy = text_mask(s, size); h, w = m.shape
    X0 = int(x - w / 2) if anchor == 'm' else int(x); Y0 = int(y + oy)
    xs = np.arange(w, dtype=np.float32)[None, :] / w; nz = noise_patch(MID, None, X0, Y0, w, h, None) if X0 >= 0 else 0
    a = np.clip((rv(t, t0, dur) * 1.15 - xs) / 0.08 + 0.3 * nz, 0, 1)
    if out0 is not None and t > out0:                                  # 薄雾擦除
        a = a * np.clip((xs - rv(t, out0, out_dur) * 1.3 + 0.15) / 0.15 + 0.4 * nz, 0, 1)
    paint(D, (m * a, X0, Y0), 'sepia', k, fringe=0.25, gran=0.15, halo=1.2, rough=0, pool=0.15)

def leader(D, t):
    """批注引线：一笔细线从字指向猫耳。"""
    stroke(D, [(1400, 352), (1370, 410), (1330, 460), (1300, 492)], 4.5, 'sepia', t, 6.05, 0.35, seed=500, dry=0.5, k=0.8, rough=0, fringe=0.2,
           prof=taper(0.05, 0.3, 0.3))
    stroke(D, [(1306, 470), (1300, 492), (1322, 480)], 4, 'sepia', t, 6.35, 0.12, seed=501, k=0.8, rough=0, fringe=0.2)

# —— 动作 ——
MICE = [dict(t0=1.6, dur=1.7, tx=830, gy=828, seed=600), dict(t0=2.05, dur=1.6, tx=975, gy=850, seed=620),
        dict(t0=2.45, dur=1.5, tx=1115, gy=830, seed=640), dict(t0=2.9, dur=1.3, tx=700, gy=852, seed=660)]
def scurry(u, k=3):                                                       # 一走一停：速度 1−cos，停顿处为 0
    u = clip01(u); return u - math.sin(2 * math.pi * k * u) / (2 * math.pi * k)
CAT_T0, CAT_T1, CAT_X0, CAT_X1 = 4.3, 6.6, 2120, 1540

def frame(i):
    t = i / FPS
    D = background_cached(t)
    u = clip01((t - CAT_T0) / (CAT_T1 - CAT_T0)); catx = CAT_X0 + (CAT_X1 - CAT_X0) * (1 - (1 - u) ** 2)   # 匀减速走到位
    for r in REEDS:
        if not r['front']: reed(D, r, t, catx)
    for k, m in enumerate(MICE):                                          # 老鼠一走一停溜向谷堆
        if t < m['t0']: continue
        v = (t - m['t0']) / m['dur']; x = -90 + (m['tx'] + 90) * scurry(v)
        run = v < 1 and abs(math.cos(2 * math.pi * 3 * clip01(v))) < 0.92
        alert = rv(t, 5.0 + 0.1 * k, 0.3); look = alert if k == 2 else 0
        nib = 0 if v < 1 or alert > 0 else 3 * max(0, math.sin(t * 14 + k))   # 到了就啃两口
        mouse(D, x + nib, m['gy'], 1, t, m['seed'], run, alert, look)
    if t >= CAT_T0 - 0.05:
        walk = 1 - rv(t, CAT_T1 - 0.35, 0.4)
        cat(D, catx, 868, t, walk, CAT_T1, rv(t, 6.5, 0.4))
    for r in REEDS:
        if r['front']: reed(D, r, t, catx)
    write(D, 'STORED GRAIN DREW MICE', 960, 998, 74, t, 0.65, 0.9, out0=3.95, out_dur=0.45)
    write(D, 'THEN CAME THE WILDCAT', 960, 998, 74, t, 4.3, 0.8)
    if t >= 6.05:
        leader(D, t); write(D, 'wildcat · Felis lybica', 1240, 336, 60, t, 6.3, 0.7, anchor='l', k=1.1)
    img = PAPER * np.exp(-D)
    s = 1 + 0.035 * sm(t / 8); M = cv2.getRotationMatrix2D((1180, 660), 0, s); M[0, 2] += -6 * sm(t / 8)
    img = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    cv2.imwrite(os.path.join(OUT, f'{i + 1:04d}.png'), np.clip(img[..., ::-1] * 255, 0, 255).astype(np.uint8))

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
