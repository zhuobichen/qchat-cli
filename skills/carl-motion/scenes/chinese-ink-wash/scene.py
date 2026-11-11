#!/usr/bin/env python3
"""S03 中国水墨 B（英文讲解版，节拍 4）：PEOPLE DID NOT CHASE IT AWAY → THE CAT STAYED
用法: JOBS=8 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
原 B 是第三方日文讲解片；这里只讲第 4 拍（村民没有赶走野猫，猫留在了灶火边），构图和角色全部自绘。
做法（对齐上游参考包 S03 配方：五档墨色、留白过半、带墨量的毛笔笔触、逐笔画出、只盖一枚朱红印章）：
- 笔触引擎：沿路径做变宽墨带，再叠一组刷毛轨迹；每根刷毛有自己的墨量和枯竭点，笔尾刷毛先后断掉，出飞白。
  没有闭合轮廓：门柱、陶罐、人、猫都是几笔侧锋/中锋拼出来的，笔与笔之间留缝。
- 墨分五色：焦 1.8、浓 1.0、重 0.62、淡 0.32、清 0.13（浓度倍数），按透射叠加，墨叠墨会更深。
- 宣纸：暖白底、长纤维、低频云斑；湿笔会顺着纤维洇开（模糊外晕 × 纤维噪声），淡墨边缘积墨。
- 主体（猫、陶罐）同色的几笔先并成一块再上墨，只在外沿积墨，内部不起接缝。
节拍：0–1.7 s 逐笔画出远山、门、灶、陶罐、拿扫帚的村民和坐着的猫，右上角竖排字 PEOPLE / DID NOT / CHASE IT / AWAY →
1.9–2.9 s 村民放下扫帚、伸手 → 2.7–3.7 s 猫蜷成一团 → 3.9 s 字幕墨晕化开，换成 THE CAT / STAYED →
4.4–5.6 s 村民像墨被水洗淡一样隐去，4.7 s 起淡墨烘出一轮月亮（烘云托月）→ 6.2 s 盖朱红印章 → 停到 8 s（灶烟、火苗、猫呼吸、镜头推近还在动）。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, FPS, N, TS, SS = 1920, 1080, 30, 240, 512, 2
SERIF = ('/System/Library/Fonts/Supplemental/Baskerville.ttc', 4)       # Baskerville SemiBold
JIAO, NONG, ZHONG, DAN, QING = 1.8, 1.0, 0.62, 0.32, 0.13              # 墨分五色

def fnoise(sigma, seed, h=H, w=W):
    rs = np.random.default_rng(seed); f = max(1, int(sigma // 6))
    n = rs.standard_normal((h // f + 2, w // f + 2)).astype(np.float32)
    n = cv2.GaussianBlur(n, (0, 0), sigma / f)
    n = cv2.resize(n, (w + 2 * f, h + 2 * f), interpolation=cv2.INTER_CUBIC)[:h, :w] if f > 1 else n[:h, :w]
    return (n - n.mean()) / n.std()
def pnoise(sigma, seed):
    w = np.random.default_rng(seed).standard_normal((TS, TS)); f = np.fft.fftfreq(TS)
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    n = np.real(np.fft.ifft2(np.fft.fft2(w) * g)); return ((n - n.mean()) / n.std()).astype(np.float32)

LO, MID, FINE = fnoise(70, 1), fnoise(10, 2), fnoise(1.3, 3)
T_LO, T_MID, T_FINE = pnoise(26, 11), pnoise(6, 12), pnoise(1.3, 13)

# —— 宣纸：暖白、长纤维、云斑 ——
PAPER_BASE = np.array([238, 231, 214], np.float32) / 255
def make_paper():
    fib = np.zeros((H, W), np.float32); rs = np.random.default_rng(7)
    for _ in range(2600):
        x, y, a, l = rs.uniform(0, W), rs.uniform(0, H), rs.uniform(0, math.pi), rs.uniform(14, 60)
        bend = rs.uniform(-6, 6)
        pts = np.array([[x + math.cos(a) * l * u - math.sin(a) * bend * (u * u - 0.25), y + math.sin(a) * l * u + math.cos(a) * bend * (u * u - 0.25)]
                        for u in np.linspace(-0.5, 0.5, 8)], np.int32)
        cv2.polylines(fib, [pts], False, float(rs.uniform(0.4, 1)), 1, cv2.LINE_AA)
    fib = cv2.GaussianBlur(fib, (0, 0), 0.7)
    p = np.ones((H, W, 3), np.float32) * PAPER_BASE
    p *= (1 + 0.015 * LO + 0.006 * MID - 0.010 * np.clip(FINE, 0, 3))[..., None]
    p *= (1 + 0.035 * fib)[..., None]
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
    p *= (1.0 - 0.06 * (((gx / W - 0.5) * 1.3) ** 2 + ((gy / H - 0.5) * 1.5) ** 2))[..., None]
    return p, fib
PAPER, FIB = make_paper()
FIBN = cv2.GaussianBlur(FIB, (0, 0), 2.5); FIBN = (FIBN - FIBN.mean()) / FIBN.std()      # 洇墨顺着纤维走
INK = -np.log(np.array([62, 58, 54], np.float32) / 255 / PAPER_BASE)     # 浓墨（浓度 1）在纸上的颜色
RED = np.array([196, 46, 36], np.float32) / 255

def clip01(u): return min(max(u, 0.0), 1.0)
def sm(u): u = clip01(u); return u * u * (3 - 2 * u)
def rv(t, t0, dur): return sm((t - t0) / dur)
def lerp(a, b, u): return a + (b - a) * u
def lp(P, Q, u): return [(lerp(a[0], b[0], u), lerp(a[1], b[1], u)) for a, b in zip(P, Q)]

# —— 笔触引擎（同 S19：变宽墨带 + 刷毛轨迹 + 飞白） ——
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
    if reveal <= 0 or wmax <= 0.3: return None
    P = catmull(pts, float(np.clip(wmax / 12, 1.2, 4.0))); d = np.diff(P, axis=0); seg = np.hypot(d[:, 0], d[:, 1])
    s = np.concatenate([[0], np.cumsum(seg)]); L = s[-1]
    if L < 0.5: return None
    u = s / L; keep = u <= reveal + 1e-6
    if keep.sum() < 2: return None
    tg = np.gradient(P, axis=0); tg /= np.maximum(np.hypot(tg[:, 0], tg[:, 1]), 1e-6)[:, None]; nr = np.stack([-tg[:, 1], tg[:, 0]], 1)
    w = wmax * (prof or DEFAULT)(u)
    if reveal < 1: srev = reveal * L; w = w * np.sqrt(np.clip((srev - s) / max(wmax * 0.5, 1) + 0.15, 0, 1))
    P, u, w, nr, s = P[keep], u[keep], w[keep], nr[keep], s[keep]
    X0, Y0 = int(P[:, 0].min() - wmax - 6), int(P[:, 1].min() - wmax - 6)
    pw, ph = int(P[:, 0].max() - X0 + wmax + 7), int(P[:, 1].max() - Y0 + wmax + 7)
    img = np.zeros((ph * SS, pw * SS), np.uint8); Q = (P - [X0, Y0]) * SS; hw = (w * SS / 2)[:, None]
    Lp, Rp = Q + nr * hw, Q - nr * hw
    core = np.ones(len(u), np.float32) if dry <= 0 else 1 - np.clip((u - (1 - dry)) / max(0.6 * dry, 1e-3), 0, 1)
    sh = 4; Qi = (Q * (1 << sh)).astype(np.int32); Ri = np.maximum(hw[:, 0] * (1 << sh), 1 << sh).astype(np.int32)
    if L < 1.2 * wmax:                                                   # 点子：圆
        for i in range(len(Q)):
            c = int(255 * core[i])
            if c >= 4: cv2.circle(img, (int(Qi[i, 0]), int(Qi[i, 1])), int(Ri[i]), c, -1, cv2.LINE_AA, sh)
    else:
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
    for k in range(K):
        g = np.sin(s * 2 * math.pi * f1[k] + phs[k]) + 0.6 * np.sin(s * 2 * math.pi * f1[k] * 2.7 + 2 * phs[k])
        on = (u <= ends[k]) & (g > -2 + dry * (0.6 + 2.6 * u ** 1.4))
        if not on.any(): continue
        pts_k = (Q + nr * (v[k] * hw)) * (1 << sh)
        idx = np.flatnonzero(np.diff(np.concatenate([[0], on.astype(np.int8), [0]])))
        runs = [pts_k[a:b].astype(np.int32) for a, b in zip(idx[::2], idx[1::2]) if b - a >= 2]
        if runs: cv2.polylines(img, runs, False, int(255 * inten[k] * (0.85 if dry > 0 else 1)), th, cv2.LINE_AA, sh)
    m = cv2.resize(img, (pw, ph), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    return m, X0, Y0

def npatch(field, tilef, X0, Y0, w, h, ofs):
    if ofs is None: return field[Y0:Y0 + h, X0:X0 + w]
    return tilef[np.ix_((np.arange(h) + Y0 - int(ofs[1])) % TS, (np.arange(w) + X0 - int(ofs[0])) % TS)]

def ink(D, r, k=1.0, bleed=0.0, edge=0.3, gran=0.25, ofs=None, rough=0.2, alpha=None):
    """把一笔的遮罩变成墨的浓度：顺纤维洇开、淡墨边缘积墨、纸纹吃墨。"""
    if r is None: return
    m, X0, Y0 = r; h, w = m.shape
    x0, y0, x1, y1 = max(X0, 0), max(Y0, 0), min(X0 + w, W), min(Y0 + h, H)
    if x1 <= x0 or y1 <= y0: return
    m = m[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0]; X0, Y0 = x0, y0; h, w = m.shape
    lo, md, fn = npatch(LO, T_LO, X0, Y0, w, h, ofs), npatch(MID, T_MID, X0, Y0, w, h, ofs), npatch(FINE, T_FINE, X0, Y0, w, h, ofs)
    if rough: m = np.clip(m * (1 + rough * 0.5 * md) - rough * 0.08, 0, 1)
    if bleed > 0:
        fb = FIBN[Y0:Y0 + h, X0:X0 + w]
        halo = cv2.GaussianBlur(m, (0, 0), bleed) * np.clip(0.75 + 0.35 * fb + 0.2 * md, 0, 1.5)
        m = np.maximum(m, np.clip(halo * 1.4 - 0.12, 0, 1) * 0.55)
    e = np.clip(m - cv2.GaussianBlur(m, (0, 0), 3), 0, 1)
    dens = k * (m * (0.88 + 0.12 * np.tanh(lo)) + edge * 2.0 * e) * np.clip(1 + 0.22 * gran * fn, 0.5, 2)
    if alpha is not None: dens = dens * alpha[y0:y0 + h, x0:x0 + w]
    D[y0:y1, x0:x1] += dens

def stroke(D, pts, wmax, t, t0, dur, k=NONG, seed=0, dry=0.0, prof=None, streak=0.2, **kw):
    rev = rv(t, t0, dur)
    if rev <= 0: return
    ink(D, brush(pts, wmax, rev, seed, dry, prof, streak), k, **kw)

class Fig:
    """角色：group 相同的笔触先并成一块再上墨（同一笔湿墨，没有内部接缝）。rev 让整组按顺序逐笔画出。"""
    def __init__(self, ofs, t=None, t0=0.0, step=0.04, dur=0.22):
        self.items = []; self.groups = {}; self.ofs = ofs; self.t, self.t0, self.step, self.dur = t, t0, step, dur; self.n = 0
    def add(self, pts, wmax, k, seed, dry=0.0, prof=None, streak=0.2, group=None, sil=True, **kw):
        rev = 1.0 if self.t is None else rv(self.t, self.t0 + self.step * self.n, self.dur); self.n += 1
        r = brush(pts, wmax, rev, seed, dry, prof, streak)
        if r is None: return
        if group is None: self.items.append((r, k, sil, kw)); return
        if group not in self.groups: self.groups[group] = []; self.items.append((group, k, sil, kw))
        self.groups[group].append(r)
    def merged(self, g):
        rs = self.groups[g]; X0 = min(r[1] for r in rs); Y0 = min(r[2] for r in rs)
        X1 = max(r[1] + r[0].shape[1] for r in rs); Y1 = max(r[2] + r[0].shape[0] for r in rs)
        m = np.zeros((Y1 - Y0, X1 - X0), np.float32)
        for mm, x, y in rs: sl = m[y - Y0:y - Y0 + mm.shape[0], x - X0:x - X0 + mm.shape[1]]; np.maximum(sl, mm, out=sl)
        return m, X0, Y0
    def draw(self, D, knock=0.85, alpha=None):
        items = [(self.merged(r) if isinstance(r, str) else r, k, sil, kw) for r, k, sil, kw in self.items]
        if knock:
            S = np.zeros((H, W), np.float32)
            for (m, X0, Y0), k, sil, kw in items:
                if not sil: continue
                x0, y0, x1, y1 = max(X0, 0), max(Y0, 0), min(X0 + m.shape[1], W), min(Y0 + m.shape[0], H)
                if x1 > x0 and y1 > y0: S[y0:y1, x0:x1] = np.maximum(S[y0:y1, x0:x1], m[y0 - Y0:y1 - Y0, x0 - X0:x1 - X0])
            D *= 1 - knock * np.clip(cv2.GaussianBlur(S, (0, 0), 2) * 1.4, 0, 1)
        for r, k, sil, kw in items:
            kw.setdefault('ofs', self.ofs); ink(D, r, k, alpha=alpha, **kw)

# —— 场景元素 ——
GY = 842                                                              # 地面线
DOOR = (300, 500, 470)                                                # 左柱 x、右柱 x、门楣 y
JARS = [(1000, GY - 4, 196, 70), (1128, GY + 4, 238, 84)]             # 中心 x、底 y、高、最大半宽
def jar_r(v): return np.interp(v, [0, 0.08, 0.35, 0.55, 0.78, 0.88, 0.93, 1.0], [0.55, 0.72, 0.98, 1.0, 0.7, 0.42, 0.46, 0.5])
CAT = (835, GY + 6)                                                    # 猫的位置（灶和陶罐之间）
VIL = (1330, GY)

def scenery(t):
    """静物：0–1.7 s 逐笔画出，之后不变（缓存）。"""
    D = np.zeros((H, W), np.float32)
    # 远山：清墨侧锋，山脊有起伏，山脚化进雾里（留白）
    for j, (x0, x1, base, peaks, sd) in enumerate([(-40, 720, 610, [(120, 170), (330, 120), (560, 150)], 1),
                                                  (1360, 1960, 600, [(1520, 130), (1760, 165)], 2), (500, 1000, 615, [(760, 80)], 3)]):
        xs = np.linspace(x0, x1, 48)
        hf = lambda x, peaks=peaks, sd=sd: max(14, max(ph * math.exp(-((x - px) / (0.9 * ph + 40)) ** 2) for px, ph in peaks)) * (0.9 + 0.1 * math.sin(x / 23 + sd))
        Dm = np.zeros((H, W), np.float32); hmax = max(ph for _, ph in peaks)
        for kk in range(2):                                             # 两笔横刷叠出山体
            frac = 1 - kk * 0.4
            stroke(Dm, [(x, base - hf(x) * frac / 2) for x in xs], hmax, t, 0.0 + 0.1 * j + 0.08 * kk, 0.55, QING * (1.25 if j < 2 else 0.9),
                   seed=10 + 3 * j + kk, prof=lambda u, xs=xs, frac=frac, hf=hf, hmax=hmax: np.interp(u, np.linspace(0, 1, len(xs)), [hf(x) * frac / hmax for x in xs]),
                   bleed=14, edge=0.15, streak=0.12, rough=0.45)
        stroke(Dm, [(x, base - hf(x) + 4) for x in xs[3:-3]], 6, t, 0.25 + 0.1 * j, 0.6, DAN, seed=20 + j, dry=0.7, bleed=1.5, rough=0)
        yy = np.arange(H, dtype=np.float32)[:, None]
        Dm *= np.clip((base - yy) / (0.55 * hmax), 0, 1) ** 0.8 * np.clip(1 + 0.3 * MID, 0, 1.3)
        D += Dm
    # 门：两根门柱中锋竖下，门楣横拖，屋檐侧锋一刷，门洞里一层清墨
    l, r, ty = DOOR
    stroke(D, [(l - 120, ty - 24), (l + 40, ty - 70), ((l + r) / 2 + 40, ty - 96), (r + 150, ty - 40)], 74, t, 0.2, 0.45, ZHONG, seed=30, dry=0.65,
           prof=taper(0.05, 0.4, 0.15), bleed=4, streak=0.35)
    stroke(D, [(l - 90, ty + 4), (r + 120, ty - 8)], 22, t, 0.35, 0.3, JIAO, seed=31, dry=0.55, prof=taper(0.05, 0.3, 0.3), bleed=1.5)
    for j, x in enumerate((l, r)):
        stroke(D, [(x + 3, ty + 2), (x - 2, (ty + GY) / 2), (x + 4, GY + 4)], 20 if j == 0 else 16, t, 0.42 + 0.1 * j, 0.32, NONG, seed=32 + j,
               dry=0.5, prof=taper(0.04, 0.3, 0.5), bleed=1.5)
    stroke(D, [((l + r) / 2 - 10, GY - 4), ((l + r) / 2, (ty + GY) / 2), ((l + r) / 2 + 6, ty + 40)], (r - l) * 0.62, t, 0.62, 0.35, QING * 1.6, seed=34,
           prof=taper(0.05, 0.35, 0.4), bleed=12, edge=0.2, streak=0.45, dry=0.45)
    for j in range(5):                                                # 屋檐草茎几笔
        x = l - 60 + j * 70
        stroke(D, [(x, ty - 30 - 8 * math.sin(j)), (x + 40, ty + 8)], 6, t, 0.7 + 0.04 * j, 0.15, NONG, seed=40 + j, dry=0.6)
    # 地面：断断续续的淡墨横拖
    for j, (x0, x1, y) in enumerate([(160, 620, GY + 8), (680, 1000, GY + 14), (1060, 1480, GY + 10), (1540, 1700, GY + 16)]):
        stroke(D, [(x0, y), ((x0 + x1) / 2, y - 4), (x1, y + 2)], 10, t, 0.3 + 0.12 * j, 0.4, DAN, seed=50 + j, dry=0.8, bleed=2)
    # 灶：三块石头、几根柴
    for j, (x, y, rr) in enumerate([(570, GY - 6, 26), (625, GY - 2, 30), (680, GY - 6, 24)]):
        stroke(D, [(x - rr * 0.4, y), (x + rr * 0.4, y - 2)], rr * 1.5, t, 0.85 + 0.06 * j, 0.15, ZHONG, seed=60 + j, prof=taper(0.3, 0.3, 0.6), bleed=3, edge=0.5)
    for j, (a, b) in enumerate([((585, GY - 24), (662, GY - 54)), ((590, GY - 50), (672, GY - 22))]):
        stroke(D, [a, b], 9, t, 1.0 + 0.05 * j, 0.12, JIAO, seed=65 + j, dry=0.4)
    # 陶罐：没骨，一笔侧锋从底往上，再在背光侧压一笔重墨；口沿焦墨一点
    for j, (cx, by, hh, rr) in enumerate(JARS):
        t0 = 0.75 + 0.18 * j
        stroke(D, [(cx, by), (cx - 2, by - hh * 0.5), (cx, by - hh)], 2 * rr, t, t0, 0.4, DAN, seed=70 + j, prof=lambda u: jar_r(u), bleed=5,
               edge=0.45, streak=0.45, dry=0.25)
        stroke(D, [(cx + rr * 0.5, by - 4), (cx + rr * 0.62, by - hh * 0.5), (cx + rr * 0.35, by - hh * 0.8)], rr * 0.7, t, t0 + 0.3, 0.3, ZHONG,
               seed=75 + j, prof=lambda u: 0.25 + 0.75 * np.sin(np.pi * np.clip(u, 0, 1)) ** 0.6, dry=0.45, bleed=3)
        stroke(D, [(cx - rr * 0.55, by - hh + 2), (cx + rr * 0.55, by - hh - 2)], 15, t, t0 + 0.42, 0.12, JIAO, seed=78 + j, dry=0.3, prof=taper(0.1, 0.3, 0.4))
        stroke(D, [(cx - rr * 0.98, by - hh * 0.6), (cx - rr * 0.92, by - hh * 0.3), (cx - rr * 0.62, by - 4)], 7, t, t0 + 0.5, 0.25, NONG, seed=80 + j, dry=0.7)
    # 罐边几片草叶（兰叶描法：起笔轻、行笔重、收笔出锋）
    for j, (x, ang, ln) in enumerate([(1210, -1.25, 170), (1222, -1.0, 140), (1196, -1.45, 200), (1236, -0.7, 110), (920, -1.9, 120)]):
        ex, ey = x + ln * math.cos(ang), GY + ln * math.sin(ang)
        stroke(D, [(x, GY), (x + (ex - x) * 0.5 + 18 * math.sin(ang * 3), GY + (ey - GY) * 0.55), (ex, ey)], 9, t, 1.25 + 0.05 * j, 0.25, NONG,
               seed=90 + j, dry=0.5, prof=lambda u: 0.15 + 0.85 * np.sin(np.pi * np.clip(u, 0, 1) ** 0.8) ** 0.7)
    return D

_cache = {}
def scenery_cached(t):
    if t < 1.8: return scenery(t)
    if 'D' not in _cache: _cache['D'] = scenery(1.8)
    return _cache['D'].copy()

def hearth_fx(D, t):
    """灶火和烟：每帧在动。火苗是重墨出锋短笔，烟是清墨长笔往上飘。"""
    if t < 1.0: return
    a = rv(t, 1.0, 0.4)
    for j in range(3):
        x = 606 + j * 22; hgt = (46 + 14 * math.sin(t * 9 + j * 2.1) + 8 * math.sin(t * 15.3 + j)) * a
        sway = 8 * math.sin(t * 7 + j * 1.7)
        r = brush([(x, GY - 34), (x + sway * 0.4, GY - 34 - hgt * 0.5), (x + sway, GY - 34 - hgt)], 16, 1.0, 100 + j, 0.3, taper(0.2, 0.7, 0.05, 0.5, 1.0))
        ink(D, r, ZHONG, bleed=2)
    for j in range(3):
        ph = t * 0.55 + j / 3.0; fr = ph % 1.0                          # 每缕烟循环上升
        base = 624 + 10 * j; y0 = GY - 90 - fr * 160
        pts = [(base + 26 * math.sin(v * 3.2 + t * 1.3 + j * 2) + v * 30, y0 - v * 260) for v in np.linspace(0, 1, 6)]
        fade = math.sin(math.pi * fr) * a
        if fade > 0.02: ink(D, brush(pts, 14, 1.0, 110 + j, 0.4, taper(0.3, 0.6, 0.1)), QING * 1.6 * fade, bleed=6, edge=0.1, rough=0.3)

def villager(D, t, g, alpha=None):
    """村民，面朝左（朝猫）。g 0→1：扫帚从扬起放到地上，左手向猫伸出。"""
    x, gy = VIL; VS = 1.3; q = lambda lx, ly: (x + lx * VS, gy + ly * VS)
    f = Fig((x, gy), t, 0.55, 0.05, 0.22)
    f.add([q(-12, -282), q(-8, -276)], 50, NONG * 0.9, 200, prof=taper(0.4, 0.4, 0.7), bleed=2, edge=0.4)              # 头
    f.add([q(4, -305), q(10, -300)], 24, JIAO, 201, prof=taper(0.4, 0.4, 0.6))                                            # 发髻
    f.add([q(-14, -246), q(-26, -150), q(-44, -20)], 120, DAN, 202, dry=0.35, prof=lambda u: 0.55 + 0.45 * np.clip(u, 0, 1), bleed=5, edge=0.5, streak=0.5)  # 袍：侧锋一刷
    f.add([q(10, -240), q(22, -140), q(30, -24)], 40, ZHONG, 203, dry=0.55, prof=taper(0.05, 0.4, 0.4), bleed=2)          # 背侧重墨
    f.add([q(-52, -168), q(4, -172)], 12, JIAO, 204, dry=0.3)                                                              # 腰带
    for j, lx in enumerate((-46, -6)):
        f.add([q(lx, -26), q(lx - 2, -2)], 13, JIAO, 205 + j, dry=0.2)                                                     # 腿
        f.add([q(lx - 12, -2), q(lx + 6, 0)], 11, JIAO, 207 + j)
    # 扫帚：扬起 → 放下
    hand = (lerp(20, 24, g), lerp(-200, -150, g)); grip = (lerp(-6, 40, g), lerp(-130, -232, g)); head = (lerp(96, 2, g), lerp(-392, -12, g))
    hx, hy = hand; tx, ty = grip; bx, by = head
    f.add([q(4, -236), q(lerp(28, 22, g), lerp(-214, -190, g)), q(hx, hy)], 20, ZHONG, 209, dry=0.3)                    # 右臂
    f.add([q(tx, ty), q(hx, hy), q(bx, by)], 8, NONG, 210, dry=0.35)                                                       # 扫帚杆
    ang = math.atan2(by - hy, bx - hx)
    f.add([q(bx - 22 * math.cos(ang), by - 22 * math.sin(ang)), q(bx + 40 * math.cos(ang), by + 40 * math.sin(ang))], 46, ZHONG, 211, dry=0.9,
          prof=lambda u: 0.4 + 0.6 * np.clip(u, 0, 1), streak=0.5)                                                         # 扫帚头：枯笔
    # 左手：垂着 → 向猫伸出、手心朝上
    el = (lerp(-34, -76, g), lerp(-170, -186, g)); hd = (lerp(-30, -128, g), lerp(-108, -170, g))
    f.add([q(-30, -238), q(*el), q(*hd)], 19, ZHONG, 212, dry=0.3)
    f.add([q(hd[0] - 4, hd[1]), q(hd[0] - 18 * g - 4, hd[1] + 3)], 14, NONG, 213, prof=taper(0.3, 0.5, 0.5))
    f.draw(D, knock=0, alpha=alpha)

def cat(D, t, p, look, breath):
    """虎斑猫，面朝右（朝村民）。p 0 坐着 → 1 蜷成一团。"""
    x, gy = CAT; K = 1.25; q = lambda pt: (x + pt[0] * K, gy + pt[1] * K)
    Q = lambda A, B: [q(v) for v in lp(A, B, sm(p))]
    f = Fig((x, gy), t, 1.0, 0.035, 0.2)
    by = 1 + 0.025 * breath
    body = Q([(-58, -28), (-46, -70), (-14, -112), (12, -134)], [(-92, -26), (-60, -62 * by), (10, -64 * by), (64, -36)])
    f.add(body, 92 * K, DAN * 1.1, 300, prof=lambda u: lerp(1.0, 0.9, p) - lerp(0.35, 0.15, p) * np.clip(u, 0, 1), group='b', bleed=4, edge=0.55, streak=0.45, dry=0.15)
    hc = lp([(20, -168)], [(70, -48 + 2 * breath)], sm(p))[0]; tilt = lerp(-0.18 * look, 0.55, sm(p))
    hx, hy = q(hc)
    f.add([(hx - 10, hy), (hx + 10, hy + 2)], 62 * K, DAN * 1.1, 301, prof=taper(0.4, 0.4, 0.7), group='b', bleed=4, edge=0.55)
    ca, sa = math.cos(tilt), math.sin(tilt)
    R = lambda dx, dy: (hx + (dx * ca - dy * sa) * K, hy + (dx * sa + dy * ca) * K)
    for j, ex in enumerate((-16, 14)):                                   # 耳朵：一笔撇出耳尖
        f.add([R(ex, -22), R(ex + 2 * (1 if ex > 0 else -1), -40), R(ex * 0.8 + (4 if ex > 0 else -4), -54)], 22 * K, ZHONG, 302 + j,
              prof=lambda u: np.clip(1 - u, 0.05, 1) ** 0.8, bleed=1.5)
    if p < 0.6:                                                          # 前腿（坐姿时看得见，蜷起来就收进去）
        wl = (1 - p / 0.6)
        for j, lx in enumerate((4, 22)):
            f.add([q((lx, -104)), q((lx + 2, -50)), q((lx + 4, -4))], 16 * K * wl, ZHONG * 0.8 if j == 0 else DAN * 1.3, 304 + j, dry=0.3, prof=taper(0.05, 0.2, 0.7))
    tail = Q([(-62, -8), (-30, 6), (20, 8), (56, -4)], [(-96, -18), (-70, 6), (0, 12), (70, 2)])
    f.add(tail, 18 * K, DAN * 1.2, 306, prof=taper(0.05, 0.12, 0.6), group='b', bleed=3)
    # 虎斑：浓墨干笔横扫，枯笔收尾
    P = catmull(body, 2); Ls = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))]); Ls /= Ls[-1]
    for j, v in enumerate((0.18, 0.36, 0.54, 0.72)):
        i = np.searchsorted(Ls, v); c = P[i]; tg = P[min(i + 2, len(P) - 1)] - P[max(i - 2, 0)]; tg /= np.hypot(*tg) + 1e-6
        n = np.array([-tg[1], tg[0]]); n = n if n[1] < 0 else -n                # 朝背的一侧
        a = c + n * 42 * K; b = c - n * 14 * K + tg * 6
        f.add([tuple(a), tuple((a + b) / 2 + tg * 4), tuple(b)], 13, NONG, 310 + j, dry=0.65, prof=taper(0.08, 0.7, 0.05, 0.4, 1.0), sil=False)
    PT = catmull(tail, 2); Lt = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(PT, axis=0).T))]); Lt /= Lt[-1]
    for j, v in enumerate((0.35, 0.58)):                                 # 尾环
        i = np.searchsorted(Lt, v); c = PT[i]; tg = PT[min(i + 2, len(PT) - 1)] - PT[max(i - 2, 0)]; tg /= np.hypot(*tg) + 1e-6; n = np.array([-tg[1], tg[0]])
        f.add([tuple(c + n * 13 * K), tuple(c - n * 13 * K)], 9, NONG, 316 + j, dry=0.4, sil=False)
    f.add([tuple(PT[int(len(PT) * 0.84)]), tuple(PT[-1])], 15 * K, JIAO, 318, prof=taper(0.1, 0.25, 0.4), sil=False)   # 尾尖焦墨
    # 脸：眼睛（坐着睁、蜷着闭）、鼻、额纹、胡须
    for j, ex in enumerate((-6, 14)):
        if p < 0.5: f.add([R(ex - 3, -4), R(ex + 3, -4)], 7, JIAO, 320 + j, prof=taper(0.4, 0.4, 0.6), sil=False, rough=0)
        else: f.add([R(ex - 6, -2), R(ex, 1), R(ex + 6, -2)], 3.5, JIAO, 322 + j, sil=False, rough=0)
    f.add([R(26, 8), R(30, 9)], 6, NONG, 324, prof=taper(0.4, 0.4, 0.6), sil=False, rough=0)
    for j, dx in enumerate((-6, 2, 10)):
        f.add([R(dx, -24), R(dx + 1, -12)], 4, NONG, 325 + j, dry=0.4, sil=False, rough=0)
    for j in range(2):
        a0 = R(30, 12 + 4 * j); f.add([a0, (a0[0] + 50, a0[1] - 6 + 12 * j)], 1.6, ZHONG, 328 + j, sil=False, rough=0, edge=0)
    f.draw(D, knock=0.85)

# —— 字幕、印章（屏幕坐标，不跟镜头推） ——
_fc = {}
def font(size):
    if size not in _fc: _fc[size] = ImageFont.truetype(SERIF[0], size * SS, index=SERIF[1])
    return _fc[size]
_tm = {}
def line_mask(s, size, track=6):
    k = (s, size)
    if k not in _tm:
        f = font(size); asc, desc = f.getmetrics(); wd = int(sum(f.getlength(c) + track * SS for c in s)) + 16 * SS
        im = Image.new('L', (wd, asc + desc + 16 * SS), 0); d = ImageDraw.Draw(im); x = 8 * SS
        for c in s: d.text((x, 8 * SS + asc), c, font=f, fill=255, anchor='ls'); x += f.getlength(c) + track * SS
        m = cv2.resize(np.asarray(im, np.float32) / 255, (im.width // SS, im.height // SS), interpolation=cv2.INTER_AREA)
        cols = np.flatnonzero(m.max(0) > 0.05); m = m[:, max(cols[0] - 4, 0):cols[-1] + 5]
        _tm[k] = (m, 8 + asc // SS)
    return _tm[k]

def caption(T, lines, right, top, size, lead, t, t0, per, out0=None):
    """竖排短行，右对齐。逐行写出（左→右带湿边）；out0 起墨晕化开再淡去。"""
    for j, s in enumerate(lines):
        ts = t0 + j * per
        if t < ts: continue
        m, base = line_mask(s, size); h, w = m.shape
        X0, Y0 = int(right - w), int(top + j * lead - base)
        xs = np.arange(w, dtype=np.float32)[None, :] / w; nz = MID[Y0:Y0 + h, X0:X0 + w]
        a = np.clip((rv(t, ts, per * 1.1) * 1.2 - xs) / 0.1 + 0.25 * nz, 0, 1)
        mm = m * a
        if out0 is not None and t > out0:
            u = rv(t, out0 + 0.04 * j, 0.45)
            mm = cv2.GaussianBlur(mm, (0, 0), 0.5 + 9 * u) * (1 - u) * (1 + 0.4 * u * FIBN[Y0:Y0 + h, X0:X0 + w])
        ink(T, (mm, X0, Y0), JIAO * 1.05, bleed=1.0, edge=0.1, gran=0.3, rough=0)

def seal(img, t, cx, cy, sz=78):
    """朱红印章：一按下去（先略大再落定），白文猫爪印，边缘和印泥不匀。"""
    if t < 6.2: return img
    u = clip01((t - 6.2) / 0.12); sc = 1.08 - 0.08 * u; op = 0.35 + 0.65 * u
    S = int(sz * 1.6); m = np.zeros((S * SS, S * SS), np.uint8); c = S * SS // 2; hs = int(sz * sc / 2 * SS)
    cv2.rectangle(m, (c - hs, c - hs), (c + hs, c + hs), 255, -1, cv2.LINE_AA)
    paw = np.zeros_like(m); s_ = sz * sc * SS / 78
    cv2.ellipse(paw, (c, int(c + 10 * s_)), (int(14 * s_), int(11 * s_)), 0, 0, 360, 255, -1, cv2.LINE_AA)
    for dx, dy, a in ((-20, -6, -20), (-8, -18, -5), (8, -18, 5), (20, -6, 20)):
        cv2.ellipse(paw, (int(c + dx * s_), int(c + dy * s_)), (int(6 * s_), int(8 * s_)), a, 0, 360, 255, -1, cv2.LINE_AA)
    cv2.rectangle(paw, (c - hs + int(9 * s_), c - hs + int(9 * s_)), (c + hs - int(9 * s_), c + hs - int(9 * s_)), 255, int(2.5 * s_), cv2.LINE_AA)
    M = cv2.getRotationMatrix2D((c, c), 3, 1.0); m = cv2.warpAffine(m, M, m.shape[::-1]); paw = cv2.warpAffine(paw, M, m.shape[::-1])
    a = cv2.resize(m.astype(np.float32) / 255 * (1 - paw.astype(np.float32) / 255), (S, S), interpolation=cv2.INTER_AREA)
    x0, y0 = int(cx - S / 2), int(cy - S / 2)
    tex = np.clip(0.82 + 0.25 * T_MID[:S, :S] + 0.25 * T_FINE[:S, :S], 0, 1)
    edge = np.clip((cv2.GaussianBlur(a, (0, 0), 1.2) - 0.5 + 0.18 * T_MID[100:100 + S, :S]) * 4 + 0.5, 0, 1)
    A = (a * edge * tex * op)[..., None]
    img[y0:y0 + S, x0:x0 + S] = img[y0:y0 + S, x0:x0 + S] * (1 - A) + (img[y0:y0 + S, x0:x0 + S] * RED / PAPER_BASE) * A
    return img

def moon(D, t):
    """烘云托月：月亮留纸白，外圈一层清墨从外往里烘进来，再用淡墨一笔不闭合的圆。"""
    if t < 4.7: return
    cx, cy, r = 560, 250, 74
    u = rv(t, 4.7, 1.0)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.hypot(xx - cx, yy - cy)
    wash = np.clip((d - r) / 14, 0, 1) * np.exp(-((d - r) / 300) ** 2) * (0.75 + 0.25 * np.tanh(LO + 0.6 * MID))
    reach = r + 30 + 420 * (1 - u)                                       # 从外往里烘
    wash *= np.clip((d - reach) / 60 + 1, 0, 1)
    wash *= np.clip(1 - (d - (r + 380)) / 120, 0, 1)
    D += QING * 1.15 * wash * u
    arc = [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in np.linspace(-2.4, 3.4, 14)]
    stroke(D, arc, 6, t, 5.2, 0.5, DAN, seed=500, dry=0.6, prof=taper(0.05, 0.4, 0.2), bleed=1.5)

def frame(i):
    t = i / FPS
    D = scenery_cached(t)
    hearth_fx(D, t)
    g = rv(t, 1.9, 1.0)
    if t < 5.7:
        Dv = np.zeros((H, W), np.float32); villager(Dv, t, g)
        if t > 4.4:                                                      # 像墨被水洗淡：从下往上、带纤维噪声地淡去
            u = rv(t, 4.4, 1.2); yy = (np.arange(H, dtype=np.float32)[:, None] - (GY - 320)) / 340
            Dv *= np.clip(1 - u * 1.6 + 0.35 * (1 - yy) * u + 0.25 * MID * u, 0, 1) * (1 - u ** 2)
        D += Dv
    moon(D, t)
    look = rv(t, 2.0, 0.4) * (1 - rv(t, 2.7, 0.3))
    cat(D, t, rv(t, 2.7, 1.0), look, math.sin(t * 2 * math.pi * 0.45) * rv(t, 3.5, 0.5))
    img = PAPER * np.exp(-D[..., None] * INK)
    s = 1 + 0.06 * sm(t / 8); M = cv2.getRotationMatrix2D((860, 760), 0, s)
    img = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    T = np.zeros((H, W), np.float32)
    caption(T, ['PEOPLE', 'DID NOT', 'CHASE IT', 'AWAY'], 1830, 150, 64, 86, t, 0.4, 0.3, out0=3.9)
    caption(T, ['THE CAT', 'STAYED'], 1830, 150, 64, 86, t, 4.35, 0.35)
    img = img * np.exp(-T[..., None] * INK)
    img = seal(img, t, 1786, 330)
    cv2.imwrite(os.path.join(OUT, f'{i + 1:04d}.png'), np.clip(img[..., ::-1] * 255, 0, 255).astype(np.uint8))

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
