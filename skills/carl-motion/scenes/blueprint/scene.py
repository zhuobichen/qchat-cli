#!/usr/bin/env python3
"""S04 蓝图工程制图 B（英文讲解版）：猫、老鼠与谷仓，画成一张工程图纸。
用法: JOBS=8 python3 scene.py <帧目录>   →  0001.png … 0240.png（1920×1080），再跑 <skill>/scripts/deliver.py --frames <帧目录> --out clip.mp4
做法（对齐上游参考包 S04 配方：cyanotype 蓝晒纸 + 白色细线按绘图顺序画）：
- 图纸坐标系 1920×1080，外面再铺一圈纸；纸是普鲁士蓝底加低频曝光不匀、细颗粒和两道折痕，网格每帧按矢量重画，推近也不糊。
- 所有图形都是折线：每条线有起止时间，按弧长逐段画出，笔尖处有一个白点；虚线、点划线在弧长上切段。
- 猫和老鼠先用椭圆、多边形、粗线拼出实心遮罩，再取外轮廓作为一笔画的轮廓线；虎斑条纹、尾环用遮罩裁剪，只留在身体里面。
- 只用蓝白两色、只做 2D：没有发光、没有 3D、没有渐变色，墨线只有 1px 级的晕开。
- 镜头只做平移和缩放：FIG.1 谷仓 → FIG.2 老鼠 → FIG.3 野猫 → 拉远看全图和右下角图框。
节拍：0–2.85 s FIG.1 地面线、圆屋、三个陶罐（中间一个剖开见谷粒）、尺寸线、编号气泡 →
2.85–4.65 s FIG.2 四只老鼠逐只画出，引线汇到 QTY 计数，再画罐顶老鼠的 DETAIL B 放大圆 → 4.65–7.4 s FIG.3 野猫侧视轮廓、条纹，虚线箭头指向谷仓，
6.6 s 起画图框 WHY CATS MOVED IN · SHEET 1 OF 1，7.5 s 后只剩镜头缓慢拉远。
"""
import math, os, sys
from multiprocessing import Pool
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
W, H, SS, FPS, N = 1920, 1080, 2, 30, 240
SUP = '/System/Library/Fonts/Supplemental/'
F_CAP = SUP + 'DIN Alternate Bold.ttf'          # 62 号字大写高 44 px
F_LAB = SUP + 'DIN Condensed Bold.ttf'
_fc = {}
def font(path, size):
    k = (path, int(round(size)))
    if k not in _fc: _fc[k] = ImageFont.truetype(path, max(4, k[1]))
    return _fc[k]

ease = lambda x: 1 - (1 - min(max(x, 0.0), 1.0)) ** 3
def smooth(x):
    x = min(max(x, 0.0), 1.0); return x * x * x * (x * (6 * x - 15) + 10)

# —— 折线工具 ——
def arclen(p):
    return np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
def resample(p, step, closed=False):
    p = np.asarray(p, np.float32)
    if closed: p = np.vstack([p, p[:1]])
    d = arclen(p); n = max(2, int(d[-1] / step) + 1); s = np.linspace(0, d[-1], n)
    return np.stack([np.interp(s, d, p[:, 0]), np.interp(s, d, p[:, 1])], 1)
def catmull(pts, n=16):
    """经过所有控制点的平滑曲线。"""
    p = np.asarray(pts, np.float32); p = np.vstack([p[:1], p, p[-1:]]); out = []
    for i in range(1, len(p) - 2):
        for u in np.linspace(0, 1, n, endpoint=False):
            a, b, c, d = p[i - 1], p[i], p[i + 1], p[i + 2]
            out.append(0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3))
    out.append(p[-2]); return np.array(out, np.float32)
def circle(cx, cy, r, a0=0, a1=360, n=None):
    n = n or max(8, int(abs(a1 - a0) / 6))
    a = np.radians(np.linspace(a0, a1, n)); return np.stack([cx + r * np.cos(a), cy + r * np.sin(a)], 1)
def rect(x0, y0, x1, y1):
    return np.array([(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)], np.float32)
def place(p, X, Y, s, flip=1):
    p = np.asarray(p, np.float32); return np.stack([p[:, 0] * s * flip + X, p[:, 1] * s + Y], 1)

# —— 实心遮罩 → 外轮廓（猫、老鼠用） ——
SC = 4
def raster(prims, box):
    x0, y0, x1, y1 = box; m = np.zeros((int((y1 - y0) * SC), int((x1 - x0) * SC)), np.uint8)
    P = lambda pts: np.round((np.asarray(pts, np.float32) - [x0, y0]) * SC * 16).astype(np.int32)
    for pr in prims:
        if pr[0] == 'ell':
            _, cx, cy, ax, ay, ang = pr
            cv2.ellipse(m, (int((cx - x0) * SC * 16), int((cy - y0) * SC * 16)), (int(ax * SC * 16), int(ay * SC * 16)), ang, 0, 360, 255, -1, cv2.LINE_8, 4)
        elif pr[0] == 'poly':
            cv2.fillPoly(m, [P(pr[1])], 255, cv2.LINE_8, 4)
        elif pr[0] == 'tline':                                   # 变粗细的粗线（腿、尾巴）
            c = catmull(pr[1], 10); th = np.interp(np.linspace(0, 1, len(c)), np.linspace(0, 1, len(pr[2])), pr[2])
            for k in range(len(c)):
                cv2.circle(m, (int((c[k, 0] - x0) * SC * 16), int((c[k, 1] - y0) * SC * 16)), int(th[k] / 2 * SC * 16), 255, -1, cv2.LINE_8, 4)
    return m
class Shape:
    def __init__(self, prims, box, start):
        self.box = box; self.m = raster(prims, box)
        cs, _ = cv2.findContours(self.m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cs, key=cv2.contourArea)[:, 0, :].astype(np.float32) / SC + [box[0], box[1]]
        k = 7; ext = np.vstack([c[-k:], c, c[:k]]); ker = np.ones(k) / k
        c = np.stack([np.convolve(ext[:, j], ker, 'same') for j in range(2)], 1)[k:-k]
        c = resample(c, 1.5, closed=True)
        i0 = int(np.argmin(np.hypot(*(c - start).T))); self.outline = np.vstack([c[i0:], c[1:i0 + 1]])
        self.inner = cv2.erode(self.m, np.ones((4 * SC, 4 * SC), np.uint8))
    def inside(self, p):
        x0, y0 = self.box[:2]; ix = np.clip(((p[:, 0] - x0) * SC).astype(int), 0, self.m.shape[1] - 1)
        iy = np.clip(((p[:, 1] - y0) * SC).astype(int), 0, self.m.shape[0] - 1); return self.inner[iy, ix] > 0
    def clip(self, poly):
        p = resample(poly, 1.0); ins = self.inside(p); out, cur = [], []
        for q, ok in zip(p, ins):
            if ok: cur.append(q)
            elif cur:
                if len(cur) > 5: out.append(np.array(cur))
                cur = []
        if len(cur) > 5: out.append(np.array(cur))
        return out

# —— 绘图时间表 ——
STROKES, TEXTS = [], []
def sched(polys, t0, t1, w=1.6, dash=None, fill=False, gap=0.0):
    """一组线按弧长顺序画完：总时长 t1-t0 按长度分配，gap 为笔抬起的空档。"""
    polys = [np.asarray(p, np.float32) for p in polys if len(p) >= 2]
    L = [max(arclen(p)[-1], 1.0) for p in polys]; tot = sum(L) + 1e-6
    avail = (t1 - t0) - gap * (len(polys) - 1); t = t0
    for p, l in zip(polys, L):
        d = max(avail * l / tot, 1 / FPS); STROKES.append(dict(p=p, cum=arclen(p), ts=t, te=t + d, w=w, dash=dash, fill=fill)); t += d + gap
def text(s, x, y, size, t0, dur=None, anchor='lm', path=F_LAB):
    TEXTS.append(dict(s=s, x=x, y=y, size=size, ts=t0, te=t0 + (dur if dur else 0.025 * len(s) + 0.1), anchor=anchor, path=path))

def sub(p, cum, a, b):
    """弧长 a..b 之间的一段折线。"""
    if b <= a: return None
    i0 = int(np.searchsorted(cum, a, 'right')); i1 = int(np.searchsorted(cum, b, 'left'))
    def at(s):
        j = min(max(int(np.searchsorted(cum, s)) , 1), len(cum) - 1); u = (s - cum[j - 1]) / max(cum[j] - cum[j - 1], 1e-6)
        return p[j - 1] + (p[j] - p[j - 1]) * u
    return np.vstack([at(a)[None], p[i0:i1], at(b)[None]])

def arrowhead(tip, frm, size=16, half=0.32):
    d = np.asarray(tip, np.float32) - np.asarray(frm, np.float32); d /= np.linalg.norm(d) + 1e-6; n = np.array([-d[1], d[0]])
    b = np.asarray(tip) - d * size; return np.array([tip, b + n * size * half, b - n * size * half, tip], np.float32)
def dim_h(x0, x1, y, yref0, yref1, label, t0, t1):
    """水平尺寸线：两条尺寸界线 + 双箭头 + 文字。"""
    sched([[(x0, yref0 - 6), (x0, y - 10)], [(x1, yref1 - 6), (x1, y - 10)]], t0, t0 + 0.25 * (t1 - t0), w=1.1)
    sched([[(x0, y), (x1, y)]], t0 + 0.25 * (t1 - t0), t0 + 0.7 * (t1 - t0), w=1.1)
    sched([arrowhead((x0, y), (x1, y)), arrowhead((x1, y), (x0, y))], t0 + 0.6 * (t1 - t0), t1, w=1.1, fill=True)
    text(label, (x0 + x1) / 2, y - 22, 32, t0 + 0.6 * (t1 - t0), anchor='mm')
def dim_v(x, y0, y1, xref, label, t0, t1, side=1):
    g = 1 if x > xref else -1
    sched([[(xref + 6 * g, y0), (x + 10 * g, y0)], [(xref + 6 * g, y1), (x + 10 * g, y1)]], t0, t0 + 0.25 * (t1 - t0), w=1.1)
    sched([[(x, y0), (x, y1)]], t0 + 0.25 * (t1 - t0), t0 + 0.7 * (t1 - t0), w=1.1)
    sched([arrowhead((x, y0), (x, y1)), arrowhead((x, y1), (x, y0))], t0 + 0.6 * (t1 - t0), t1, w=1.1, fill=True)
    text(label, x + 16 * side, (y0 + y1) / 2, 32, t0 + 0.6 * (t1 - t0), anchor='lm' if side > 0 else 'rm')
def balloon(n, bx, by, tx, ty, t0, label=None, lx=None, anchor='lm'):
    """编号气泡：圆圈 + 数字 + 引线（引线端点打一个小点）+ 可选名称。"""
    d = np.array([tx - bx, ty - by], np.float32); d /= np.linalg.norm(d)
    sched([circle(bx, by, 21, -90, 270)], t0, t0 + 0.22, w=1.4)
    sched([[(bx + d[0] * 21, by + d[1] * 21), (tx, ty)]], t0 + 0.2, t0 + 0.42, w=1.1)
    sched([circle(tx, ty, 3.2, 0, 360, 10)], t0 + 0.4, t0 + 0.45, w=1.1, fill=True)
    text(str(n), bx, by + 1, 30, t0 + 0.15, 0.05, anchor='mm')
    if label: text(label, lx if lx is not None else bx + 32, by, 32, t0 + 0.3, anchor=anchor)

# ================= 图纸内容 =================
GY = 800                                                            # 地面线
# 图框（双线框 + 分区刻度）
sched([rect(40, 40, 1880, 1040)], 0.0, 0.5, w=1.2)
sched([rect(54, 54, 1866, 1026)], 0.05, 0.55, w=2.2)
ticks = [[(x, 40), (x, 54)] for x in range(294, 1880, 240)] + [[(x, 1026), (x, 1040)] for x in range(294, 1880, 240)] + \
        [[(40, y), (54, y)] for y in range(290, 1040, 250)] + [[(1866, y), (1880, y)] for y in range(290, 1040, 250)]
sched(ticks, 0.3, 0.7, w=1.2)
# 地面线 + 土层斜线
sched([[(96, GY), (1830, GY)]], 0.2, 0.75, w=2.4)
sched([[(x, GY + 2), (x - 16, GY + 18)] for x in range(110, 1830, 22)], 0.55, 1.15, w=1.0)
# 比例尺
sb = [[(120, 958), (420, 958)]] + [[(x, 950), (x, 966)] for x in (120, 220, 320, 420)]
sched(sb, 0.6, 1.0, w=1.4)
for k, x in enumerate((120, 220, 320, 420)): text(f'{k} m', x, 986, 28, 0.85, anchor='mm')
text('SCALE BAR', 120, 922, 28, 0.7)

# —— FIG.1 圆屋 ——
HX0, HX1, HT = 125, 395, 610                                         # 墙左右、墙顶
sched([[(HX0, GY), (HX0 + 6, HT), (HX1 - 6, HT), (HX1, GY)]], 0.32, 0.8, w=2.6)
roof = [(95, 618), (260, 420), (425, 618)]
sched([roof, [(95, 618), (425, 618)]], 0.7, 1.15, w=2.6)
door = np.vstack([[(232, GY)], circle(260, 718, 28, 180, 360, 16), [(288, GY)]])
sched([door], 1.1, 1.3, w=2.0)
bricks = []
for r, y in enumerate(range(650, GY, 38)):
    if y > 688: bricks += [[(HX0 + 3, y), (228, y)], [(292, y), (HX1 - 3, y)]]
    else: bricks.append([(HX0 + 3, y), (HX1 - 3, y)])
    for x in range(HX0 + 30 + (r % 2) * 22, HX1 - 10, 44):
        if not (220 < x < 300 and y + 38 > 690): bricks.append([(x, y), (x, min(y + 38, GY))])
sched(bricks, 1.2, 1.75, w=1.0)
thatch = [[(260, 420), (95 + 330 * u, 618)] for u in np.linspace(0.06, 0.94, 14)]
sched(thatch, 1.3, 1.9, w=1.0)
sched([[(105, 600), (415, 600)], [(140, 560), (380, 560)], [(178, 515), (342, 515)]], 1.7, 1.95, w=1.0, dash=(10, 8))

# —— FIG.1 三个陶罐（中间一个剖开） ——
def jar_profile(cx, R, Hh):
    v = np.array([0, 0.08, 0.3, 0.55, 0.75, 0.88, 0.94, 1.0]); r = np.array([0.55, 0.74, 0.95, 1.0, 0.86, 0.56, 0.52, 0.62])
    c = catmull(np.stack([r * R, GY - v * Hh], 1), 10); return c
JARS = [(640, 58, 230), (800, 68, 252), (960, 58, 230)]
for k, (cx, R, Hh) in enumerate(JARS):
    c = jar_profile(cx, R, Hh); left = np.stack([cx - c[:, 0], c[:, 1]], 1); right = np.stack([cx + c[:, 0], c[:, 1]], 1)
    top = GY - Hh; t0 = 0.9 + k * 0.28
    sched([np.vstack([left[::-1], right]), [(cx - c[-1, 0], top), (cx + c[-1, 0], top)], [(cx - c[-1, 0] - 4, top + 10), (cx + c[-1, 0] + 4, top + 10)]], t0, t0 + 0.42, w=2.4)
    if k == 1:                                                       # 剖面 A-A：右半边内壁 + 剖面线，内部画谷粒
        inner = np.stack([cx + np.maximum(c[:, 0] - 9, 2), np.minimum(c[:, 1], GY - 9)], 1)
        sched([inner[:-6]], 1.65, 1.85, w=1.3)
        hatch = []
        for s in range(-300, 300, 9):                                # 薄壁剖面 45° 斜线
            seg = []
            for y in np.arange(top + 8, GY, 1.0):
                x = cx + (y - (GY - Hh)) + s
                ro = np.interp(-y, -c[:, 1], c[:, 0]); ri = ro - 9
                if cx + ri <= x <= cx + ro: seg.append((x, y))
            if len(seg) > 2: hatch.append(seg)
        sched(hatch, 1.75, 2.1, w=0.9)
        sched([[(cx, top - 30), (cx, GY + 24)]], 1.6, 1.8, w=1.0, dash=(26, 6, 4, 6))   # 点划中心线
        rs = np.random.default_rng(3); grains = []
        lvl = GY - Hh * 0.62
        sched([[(cx - np.interp(-lvl, -c[:, 1], c[:, 0]) + 6, lvl), (cx + np.interp(-lvl, -c[:, 1], c[:, 0]) - 12, lvl)]], 1.8, 1.9, w=1.2)
        for _ in range(140):
            y = rs.uniform(lvl + 8, GY - 12); ro = np.interp(-y, -c[:, 1], c[:, 0]) - 15
            x = rs.uniform(cx - ro, cx + ro)
            a = rs.uniform(0, 180); grains.append(np.array([(x + 4.5 * math.cos(math.radians(a + d)) * (1 if d % 180 == 0 else 0.55),
                                                              y + 4.5 * math.sin(math.radians(a + d)) * (1 if d % 180 == 0 else 0.55)) for d in range(0, 361, 45)]))
        sched(grains, 1.85, 2.5, w=1.0)
# 尺寸与气泡
dim_h(800 - 68, 800 + 68, 512, 640, 640, 'Ø 0.5 m', 1.95, 2.45)
dim_v(552, GY - 230, GY, 600, '1.1 m', 2.0, 2.5, side=-1)
balloon(1, 190, 455, 215, 505, 2.15, 'HUT', lx=150, anchor='rm')
balloon(2, 560, 470, 612, 625, 2.3, 'STORAGE JAR', lx=532, anchor='rm')
balloon(3, 905, 455, 815, 700, 2.45, 'GRAIN · SECTION A–A', lx=873, anchor='rm')
text('FIG. 1', 260, 850, 34, 2.55, anchor='mm')

# —— FIG.2 老鼠（侧视，朝左；flip=-1 朝右） ——
MOUSE = [('ell', 0, -17, 28, 16, -5), ('ell', -28, -19, 17, 12, 20), ('poly', [(-38, -27), (-55, -15), (-36, -10)]),
         ('ell', -21, -33, 10, 11, 0), ('ell', -14, -2, 6, 3, 0), ('ell', 16, -2, 7, 3, 0)]
MSH = Shape(MOUSE, (-70, -60, 40, 10), np.array([-55, -15]))
def clip_circle(poly, cx, cy, r):
    p = resample(poly, 1.0); ins = np.hypot(p[:, 0] - cx, p[:, 1] - cy) < r - 3; out, cur = [], []
    for q, ok in zip(p, ins):
        if ok: cur.append(q)
        elif cur:
            if len(cur) > 3: out.append(np.array(cur))
            cur = []
    if len(cur) > 3: out.append(np.array(cur))
    return out
def mouse(X, Y, flip, t0, s=1.05, w=1.0, dur=1.0, clip=None):
    P = lambda p: place(p, X, Y, s, flip)
    C = (lambda ps: [q for p in ps for q in clip_circle(p, *clip)]) if clip else (lambda ps: ps)
    D = lambda a: t0 + a * dur
    sched(C([P(MSH.outline)]), D(0), D(0.32), w=1.9 * w)
    sched(C([P(catmull([(26, -12), (40, -8), (55, -6), (68, -13), (80, -19), (91, -16)]))]), D(0.3), D(0.42), w=1.5 * w)
    sched([P(circle(-34, -22, 2.4, 0, 360, 10))], D(0.38), D(0.42), w=1.4 * w, fill=True)
    sched(C([P(circle(-21, -33, 6, 120, 330)), P([(-52, -16), (-66, -23)]), P([(-52, -15), (-68, -15)]), P([(-52, -14), (-65, -8)])]), D(0.4), D(0.55), w=0.9 * w)
    return P(np.array([[2, -33]]))[0]
MICE = [(505, GY, -1), (965, GY - 230 - 1, 1), (1070, GY, 1), (1232, GY, 1)]
LAB = np.array([740, 935])
for k, (X, Y, f) in enumerate(MICE):
    t0 = 3.0 + 0.26 * k; top = mouse(X, Y, f, t0)
    sched([[tuple(top), tuple(LAB + [(k - 1.5) * 40, -30])]], t0 + 0.5, t0 + 0.7, w=1.0)
    sched([circle(*top, 3.2, 0, 360, 10)], t0 + 0.5, t0 + 0.55, w=1.0, fill=True)
sched([[(LAB[0] - 110, LAB[1] - 30), (LAB[0] + 110, LAB[1] - 30)]], 3.6, 3.85, w=1.4)
balloon(4, LAB[0] - 150, LAB[1] + 12, LAB[0] - 120, LAB[1] - 28, 3.55)
QTY = (3.0 + 0.55, 0.26, 4)                                             # 第 k 只画完时 QTY 跳到 k+1
text('HOUSE MOUSE · Mus musculus', LAB[0] - 118, LAB[1] + 12, 34, 3.7)
text('FIG. 2', LAB[0] - 30, LAB[1] + 52, 34, 4.3, anchor='lm')
# 局部放大 DETAIL B：罐顶那只老鼠放大 2.4 倍，圆内裁切
DB = (1160, 335, 100)
sched([circle(965, 548, 52, -90, 270)], 3.95, 4.1, w=1.2, dash=(10, 6))
text('B', 1018, 500, 30, 4.05, 0.05, anchor='mm')
sched([[(1003, 511), (DB[0] - 71, DB[1] + 71)]], 4.05, 4.2, w=1.0)
sched([circle(DB[0], DB[1], DB[2], 150, 510)], 4.1, 4.35, w=2.0)
mouse(DB[0] + 22, DB[1] + 48, 1, 4.25, s=2.2, w=1.25, dur=1.0, clip=DB)
text('DETAIL B · 2 : 1', DB[0] + DB[2] + 22, DB[1], 32, 4.6)

# —— FIG.3 野猫（侧视，朝左走向谷仓） ——
CAT = [('ell', 10, -125, 140, 55, -3), ('ell', -105, -128, 56, 56, 0), ('ell', 105, -118, 62, 62, 0),
       ('poly', [(-150, -150), (-188, -212), (-150, -236), (-92, -172)]), ('ell', -185, -205, 50, 44, 0), ('ell', -224, -189, 27, 22, 0),
       ('poly', [(-214, -230), (-210, -284), (-176, -242)]), ('poly', [(-180, -240), (-160, -281), (-144, -236)]),
       ('tline', [(-122, -110), (-136, -60), (-150, -10)], [34, 26, 22]), ('ell', -156, -7, 20, 8, 0),
       ('tline', [(-78, -110), (-82, -60), (-98, -10)], [30, 24, 20]), ('ell', -103, -7, 19, 8, 0),
       ('tline', [(122, -110), (152, -55), (138, -10)], [44, 24, 20]), ('ell', 131, -7, 20, 8, 0),
       ('tline', [(82, -100), (92, -50), (70, -10)], [38, 22, 18]), ('ell', 63, -7, 19, 8, 0),
       ('tline', [(158, -146), (205, -152), (245, -176), (268, -216), (270, -256), (258, -282)], [26, 24, 22, 20, 19, 18])]
CSH = Shape(CAT, (-300, -320, 320, 20), np.array([-252, -190]))
CX, CY, CS = 1530, GY, 0.82
CP = lambda p: place(p, CX, CY, CS)
sched([CP(CSH.outline)], 4.8, 5.75, w=2.6)
det = [catmull([(-214, -212), (-202, -220), (-188, -212)]), catmull([(-214, -212), (-202, -205), (-188, -212)]), [(-202, -218), (-202, -206)],
       [(-252, -196), (-244, -196), (-248, -189), (-252, -196)], catmull([(-248, -189), (-246, -180), (-236, -177)]),
       catmull([(-206, -244), (-206, -270), (-186, -247)])]
sched([CP(d) for d in det], 5.6, 5.9, w=1.5)
sched([CP([(-238, -186), (-298, -202)]), CP([(-238, -183), (-300, -184)]), CP([(-238, -180), (-294, -166)])], 5.85, 6.05, w=0.9)
stripes = []
for x in range(-70, 160, 22): stripes += CSH.clip(catmull([(x, -186), (x + 9, -150), (x + 2, -112), (x + 10, -92)]))
for x0, y0 in ((-191, -248), (-178, -246), (-165, -242)): stripes += CSH.clip([(x0, y0), (x0 + 3, y0 + 18)])
stripes += CSH.clip(catmull([(-180, -196), (-160, -188), (-140, -186)])) + CSH.clip(catmull([(-182, -184), (-162, -174), (-142, -172)]))
for (lx, ly) in ((-136, -66), (-141, -45), (-146, -26), (-82, -64), (-86, -42), (148, -48), (145, -28), (92, -46)):
    stripes += CSH.clip([(lx - 22, ly), (lx + 22, ly - 4)])
tail = catmull([(158, -146), (205, -152), (245, -176), (268, -216), (270, -256), (258, -282)], 20)
tc = arclen(tail)
for s in np.linspace(0.22, 0.8, 6) * tc[-1]:
    j = int(np.searchsorted(tc, s)); d = tail[min(j + 1, len(tail) - 1)] - tail[j - 1]; d /= np.linalg.norm(d); n = np.array([-d[1], d[0]])
    stripes += CSH.clip([tail[j] - n * 24, tail[j] + n * 24])
for s in np.linspace(0.86, 0.99, 5) * tc[-1]:                         # 尾尖深色：密排线
    j = int(np.searchsorted(tc, s)); d = tail[min(j + 1, len(tail) - 1)] - tail[j - 1]; d /= np.linalg.norm(d); n = np.array([-d[1], d[0]])
    stripes += CSH.clip([tail[j] - n * 24, tail[j] + n * 24])
stripes += CSH.clip(circle(105, -118, 48, 195, 330)) + CSH.clip(circle(-105, -128, 44, 120, 230))
sched([CP(p) for p in stripes], 5.75, 6.4, w=1.3)
# 箭头：从猫鼻子划向谷仓
arc = catmull([(1312, 640), (1240, 540), (1140, 520), (1060, 585)], 20)
sched([arc], 6.25, 6.75, w=1.6, dash=(16, 9))
sched([arrowhead((1052, 595), (1072, 572), 24, 0.36)], 6.72, 6.8, w=1.4, fill=True)
text('REACHES THE GRANARY', 1185, 482, 32, 6.6, anchor='mm')
balloon(5, 1730, 520, 1640, 655, 6.05, 'WILDCAT · Felis lybica', lx=1696, anchor='rm')
text('FIG. 3', 1530, 848, 34, 6.45, anchor='mm')

# —— 图框 title block ——
TB = (1170, 868, 1860, 1030)
sched([rect(*TB)], 6.6, 6.95, w=2.2)
sched([[(TB[0], 942), (TB[2], 942)], [(TB[0], 986), (TB[2], 986)], [(1430, 942), (1430, 1030)], [(1640, 942), (1640, 986)], [(1720, 986), (1720, 1030)]], 6.9, 7.15, w=1.2)
text('WHY CATS MOVED IN · SHEET 1 OF 1', 1190, 906, 46, 7.0, 0.5)
text('DRAWN  c. 8000 BCE', 1190, 965, 30, 7.15, 0.3)
text('SCALE  1 : 20', 1450, 965, 30, 7.2, 0.25)
text('DWG FC-01', 1658, 965, 30, 7.25, 0.25)
text('FERTILE CRESCENT · NEOLITHIC', 1190, 1009, 30, 7.3, 0.3)
text('REV  A', 1740, 1009, 30, 7.4, 0.2)

# —— 屏幕固定的图题条（左上） ——
CAPS = [(0.12, 2.82, 'FIG. 1 — GRANARY, c. 8000 BCE'), (3.02, 4.62, 'FIG. 2 — MOUSE (Mus musculus)'), (4.82, 99, 'FIG. 3 — WILDCAT (Felis lybica)')]
CAPF = font(F_CAP, 62 * SS)
CAPW = max(CAPF.getlength(c[2]) for c in CAPS) / SS + 56
PANEL = (60, 60, 60 + CAPW, 160)

# —— 镜头关键帧：(t, 中心x, 中心y, 缩放) ——
KEYS = [(0, 520, 610, 1.32), (2.7, 700, 620, 1.24), (3.5, 900, 615, 1.3), (4.6, 960, 600, 1.28), (5.3, 1330, 640, 1.28),
        (6.3, 1290, 625, 1.17), (7.3, 960, 545, 1.0), (8.0, 960, 542, 0.985)]
def cam(t):
    for a, b in zip(KEYS, KEYS[1:]):
        if t <= b[0]:
            u = smooth((t - a[0]) / (b[0] - a[0])); return [a[k] + (b[k] - a[k]) * u for k in (1, 2, 3)]
    return list(KEYS[-1][1:])

# —— 蓝晒纸（图纸坐标，外扩一圈） ——
PX0, PY0, PW, PH = -440, -310, 2800, 1700
def lowfreq(sigma, seed, shape=(PH, PW)):
    r = np.random.default_rng(seed); h, w = shape; k = max(1, int(sigma / 4))
    n = r.standard_normal((h // k + 2, w // k + 2)).astype(np.float32); n = cv2.GaussianBlur(n, (0, 0), sigma / k)
    n = cv2.resize(n, (w, h), interpolation=cv2.INTER_CUBIC); return (n - n.mean()) / (n.std() + 1e-6)
def make_paper():
    base = np.array([128, 64, 20], np.float32) / 255                 # BGR：普鲁士蓝
    tone = 1 + 0.09 * lowfreq(140, 1) + 0.04 * lowfreq(26, 2) + 0.025 * lowfreq(3, 3) + 0.03 * np.random.default_rng(4).standard_normal((PH, PW)).astype(np.float32)
    p = base * tone[..., None]
    yy, xx = np.mgrid[0:PH, 0:PW].astype(np.float32); xx += PX0; yy += PY0
    fold = np.exp(-((xx - 960) / 2.2) ** 2) * 0.05 + np.exp(-((yy - 540) / 2.2) ** 2) * 0.04
    p = p + fold[..., None] * np.array([0.8, 0.7, 0.55], np.float32)
    return p
PAPER = make_paper()
WHITE = np.array([1.0, 0.97, 0.93], np.float32)                       # BGR：略带蓝的白
PANEL_C = np.array([128, 64, 20], np.float32) / 255 * 0.92

def frame(i):
    t = i / FPS; cx, cy, z = cam(t)
    M = np.float32([[z, 0, W / 2 - z * (cx - PX0)], [0, z, H / 2 - z * (cy - PY0)]])
    bg = cv2.warpAffine(PAPER, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    S = lambda p: np.round(((np.asarray(p, np.float32) - [cx, cy]) * z + [W / 2, H / 2]) * SS * 4).astype(np.int32)
    grid = np.zeros((H * SS, W * SS), np.uint8); ink = np.zeros((H * SS, W * SS), np.uint8)
    for g in range(60, 1866, 20):
        v = 255 if (g - 60) % 100 == 0 else 120
        cv2.line(grid, tuple(S([(g, 54)])[0]), tuple(S([(g, 1026)])[0]), v, 1, cv2.LINE_AA, 2)
    for g in range(60, 1026, 20):
        v = 255 if (g - 60) % 100 == 0 else 120
        cv2.line(grid, tuple(S([(54, g)])[0]), tuple(S([(1866, g)])[0]), v, 1, cv2.LINE_AA, 2)
    tips = []
    for st in STROKES:
        if t < st['ts']: continue
        u = min((t - st['ts']) / (st['te'] - st['ts']), 1.0); L = st['cum'][-1]; d = L * u
        th = max(1, int(round(st['w'] * z * SS)))
        if st['fill'] and u >= 1:
            cv2.fillPoly(ink, [S(st['p'])], 255, cv2.LINE_AA, 2); cv2.polylines(ink, [S(st['p'])], False, 255, th, cv2.LINE_AA, 2); continue
        segs = []
        if st['dash']:
            pat = st['dash']; s, k = 0.0, 0
            while s < d:
                e = min(s + pat[k % len(pat)], d)
                if k % 2 == 0: segs.append((s, e))
                s += pat[k % len(pat)]; k += 1
        else: segs = [(0.0, d)]
        for a, b in segs:
            q = sub(st['p'], st['cum'], a, b)
            if q is not None and len(q) >= 2: cv2.polylines(ink, [S(q)], False, 255, th, cv2.LINE_AA, 2)
        if u < 1: tips.append(sub(st['p'], st['cum'], 0, max(d, 0.01))[-1])
    for p in tips: cv2.circle(ink, tuple(S([p])[0]), int(3.4 * SS * 4), 255, -1, cv2.LINE_AA, 2)
    im = Image.fromarray(ink); dr = ImageDraw.Draw(im)
    for tx in TEXTS:
        if t < tx['ts']: continue
        u = min((t - tx['ts']) / (tx['te'] - tx['ts']), 1.0); s = tx['s'][:int(math.ceil(u * len(tx['s'])))]
        p = S([(tx['x'], tx['y'])])[0] / 4
        dr.text((float(p[0]), float(p[1])), s, font=font(tx['path'], tx['size'] * z * SS), fill=255, anchor=tx['anchor'])
    # QTY 计数（随老鼠画完跳字）
    if t >= QTY[0]:
        q = min(QTY[2], 1 + int((t - QTY[0]) / QTY[1])); p = S([(LAB[0] + 290, LAB[1] + 12)])[0] / 4
        dr.text((float(p[0]), float(p[1])), f'QTY {q:02d}', font=font(F_LAB, 34 * z * SS), fill=255, anchor='lm')
    ink = np.asarray(im)
    # 图题条：屏幕固定
    pan = np.zeros((H * SS, W * SS), np.uint8); cap = Image.new('L', (W * SS, H * SS), 0); dc = ImageDraw.Draw(cap)
    pu = ease(t / 0.35); x0, y0, x1, y1 = PANEL
    cv2.rectangle(pan, (x0 * SS, y0 * SS), (int((x0 + (x1 - x0) * pu) * SS), y1 * SS), 255, -1)
    dc.rectangle([x0 * SS, y0 * SS, int((x0 + (x1 - x0) * pu) * SS), y1 * SS], outline=255, width=2 * SS)
    dc.line([((x0 + 10) * SS, (y1 - 10) * SS), (int((x0 + 10 + (x1 - x0 - 20) * pu) * SS), (y1 - 10) * SS)], fill=255, width=SS)
    for a, b, s in CAPS:
        if a <= t < b + 0.2:
            n = len(s); k = int(math.ceil(min((t - a) / 0.6, 1) * n))
            if t > b: k = int(n * (1 - (t - b) / 0.2))
            if k > 0: dc.text((int((x0 + 26) * SS), int((y0 + 45) * SS)), s[:k], font=CAPF, fill=255, anchor='lm')
    small = lambda m: cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    a_ink = small(ink); a_grid = small(grid); a_pan = small(pan); a_cap = small(np.asarray(cap))
    bleed = cv2.GaussianBlur(a_ink, (0, 0), 1.6)
    a = np.clip(a_ink * 0.94 + bleed * 0.18 + a_grid * 0.22, 0, 1)
    out = bg * (1 - a[..., None]) + WHITE * a[..., None]
    out = out * (1 - a_pan[..., None] * 0.93) + PANEL_C * a_pan[..., None] * 0.93
    out = out * (1 - a_cap[..., None]) + WHITE * a_cap[..., None]
    gy_, gx_ = np.mgrid[0:H, 0:W].astype(np.float32)
    vig = 1 - 0.18 * (((gx_ / W - 0.5) * 1.4) ** 2 + ((gy_ / H - 0.5) * 1.6) ** 2)
    out = out * vig[..., None]
    cv2.imwrite(os.path.join(OUT, f'{i + 1:04d}.png'), np.clip(out * 255, 0, 255).astype(np.uint8))

if __name__ == '__main__':
    idx = [int(x) for x in os.environ['ONLY'].split(',')] if os.environ.get('ONLY') else range(N)
    with Pool(int(os.environ.get('JOBS', 4))) as p: p.map(frame, idx)
    print('frames', len(list(idx)))
