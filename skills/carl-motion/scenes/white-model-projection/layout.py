# S28 共享平面布局（模型单位：米；整张城区白模示意）。Blender 场景与投影图共用，确定性生成。
import math, random

PLATE = (-1.05, 1.05, -0.68, 0.68)
FS = 0.42                     # 工厂相对 v1 的缩放
FX, FY = 0.0, 0.04            # 工厂中心

_F = [
    ('hallA', -0.56, 0.04, -0.04, 0.30, 0.070, 'saw', dict(n=6, rise=0.038)),
    ('hallB', 0.11, 0.47, 0.02, 0.30, 0.064, 'saw', dict(n=4, rise=0.034)),
    ('ware1', -0.62, -0.16, -0.36, -0.19, 0.058, 'gable', dict(rise=0.032)),
    ('ware2', 0.20, 0.60, -0.37, -0.17, 0.082, 'flat', dict(parapet=0.006)),
    ('office', 0.53, 0.68, 0.04, 0.26, 0.120, 'flat', dict(parapet=0.005)),
    ('boiler', -0.08, 0.06, -0.33, -0.21, 0.090, 'gable', dict(rise=0.025)),
    ('shed1', -0.70, -0.62, 0.05, 0.14, 0.040, 'flat', dict(parapet=0.0)),
    ('shed2', 0.62, 0.72, -0.30, -0.20, 0.035, 'flat', dict(parapet=0.0)),
]


def _s(x, y): return FX + x * FS, FY + y * FS


BUILDINGS = []
for n, x0, x1, y0, y1, h, k, p in _F:
    a, b = _s(x0, y0); c, d = _s(x1, y1)
    p2 = {kk: (vv * FS if isinstance(vv, float) else vv) for kk, vv in p.items()}
    BUILDINGS.append((n, a, c, b, d, h * FS * 1.25, k, p2))
_cx, _cy = _s(0.0, -0.27)
CHIMNEY = dict(x=_cx, y=_cy, r0=0.026 * FS * 1.1, r1=0.016 * FS * 1.1, h=0.42 * FS * 1.3)
YARD = (_s(-0.12, 0)[0], _s(0.17, 0)[0], _s(0, -0.15)[1], _s(0, -0.05)[1])
SITE = (_s(-0.76, 0)[0], _s(0.80, 0)[0], _s(0, -0.44)[1], _s(0, 0.36)[1])
ROUTE = [_s(x, y) for x, y in [(0.0, -0.62), (0.0, -0.40), (0.02, -0.12), (-0.24, -0.02), (-0.26, 0.14), (0.05, 0.16),
                                 (0.28, 0.14), (0.30, -0.06), (0.40, -0.18), (0.40, -0.27)]]
PUBLIC = [
    ('yard', 0.22, '#4FD3EA', '庭院', 'Courtyard'),
    ('hallA', 0.44, '#5A78FF', '阅览室', 'Reading room'),
    ('hallB', 0.70, '#8FBAFF', '少儿区', "Children's room"),
    ('ware2', 0.95, '#E2FAFF', '屋顶花园', 'Roof garden'),
]
OLD_ORANGE = '#E0853A'
REACH = ['#3D5BEB', '#3FA7F0', '#A9E8F8']   # 步行可达：近 / 中 / 远（示意）


# ---------------- 河道 ----------------
def river_y(x):
    return -0.47 + 0.07 * math.sin(1.7 * x + 0.6)


RIVER_HALF = 0.075


def in_river(x, y, pad=0.0):
    return abs(y - river_y(x)) < RIVER_HALF + pad


BRIDGES = [(-0.58, 0.032), (0.42, 0.032)]   # (x 中心, 半宽)

# ---------------- 街网与街区 ----------------
STREET = 0.022
GX = [-1.02, -0.84, -0.66, -0.49, -0.33, 0.33, 0.50, 0.67, 0.85, 1.02]
GY = [-0.66, -0.55, -0.36, -0.22, -0.08, 0.06, 0.20, 0.34, 0.48, 0.65]
rng = random.Random(28)
DISTRICT = []      # (x0, x1, y0, y1, h, roof, extra)
PARKS = []
BLOCKS = []
FACTORY_BLOCK = (-0.33 + STREET / 2, 0.33 - STREET / 2, -0.36 + STREET / 2, 0.34 - STREET / 2)


def _overlap(a, b):
    return not (a[1] <= b[0] or b[1] <= a[0] or a[3] <= b[2] or b[3] <= a[2])


def _add_building(x0, x1, y0, y1, h, roof):
    extra = []
    if roof in ('flat', 'tower') and rng.random() < 0.6:
        w, d = (x1 - x0), (y1 - y0)
        for _ in range(rng.randint(1, 3)):
            ew, ed = min(w * 0.4, rng.uniform(0.004, 0.011)), min(d * 0.4, rng.uniform(0.004, 0.009))
            ex = rng.uniform(x0 + 0.002, max(x0 + 0.0021, x1 - ew - 0.002)); ey = rng.uniform(y0 + 0.002, max(y0 + 0.0021, y1 - ed - 0.002))
            extra.append((ex, ex + ew, ey, ey + ed, rng.uniform(0.003, 0.008)))
    DISTRICT.append((x0, x1, y0, y1, h, roof, extra))


for i in range(len(GX) - 1):
    for j in range(len(GY) - 1):
        bx0, bx1 = GX[i] + STREET / 2, GX[i + 1] - STREET / 2
        by0, by1 = GY[j] + STREET / 2, GY[j + 1] - STREET / 2
        if _overlap((bx0, bx1, by0, by1), (-0.33, 0.33, -0.36, 0.34)):
            continue
        cy0, cy1 = by0, by1
        ry_lo = min(river_y(bx0), river_y(bx1), river_y((bx0 + bx1) / 2)) - RIVER_HALF - 0.025
        ry_hi = max(river_y(bx0), river_y(bx1), river_y((bx0 + bx1) / 2)) + RIVER_HALF + 0.025
        if cy0 < ry_hi and cy1 > ry_lo:
            if cy1 - ry_hi > 0.04:
                cy0 = ry_hi
            elif ry_lo - cy0 > 0.04:
                cy1 = ry_lo
            else:
                continue
        blk = (bx0, bx1, cy0, cy1)
        BLOCKS.append(blk)
        if rng.random() < 0.09:
            PARKS.append(blk); continue
        depth = rng.uniform(0.026, 0.036)
        base = rng.uniform(0.016, 0.034)
        for side in range(4):
            if side in (0, 1):
                yA, yB = (cy0, cy0 + depth) if side == 0 else (cy1 - depth, cy1)
                x = bx0
                while x < bx1 - 0.012:
                    x2 = min(bx1, x + rng.uniform(0.016, 0.046))
                    if bx1 - x2 < 0.012: x2 = bx1
                    _add_building(x, x2, yA, yB, base * rng.uniform(0.7, 1.4), 'gable' if rng.random() < 0.18 else 'flat'); x = x2
            else:
                xA, xB = (bx0, bx0 + depth) if side == 2 else (bx1 - depth, bx1)
                y = cy0 + depth
                while y < cy1 - depth - 0.012:
                    y2 = min(cy1 - depth, y + rng.uniform(0.016, 0.042))
                    if cy1 - depth - y2 < 0.012: y2 = cy1 - depth
                    _add_building(xA, xB, y, y2, base * rng.uniform(0.7, 1.4), 'gable' if rng.random() < 0.15 else 'flat'); y = y2
        if rng.random() < 0.25 and (bx1 - bx0) > 0.1 and (cy1 - cy0) > 0.085:
            tx = rng.uniform(bx0 + depth + 0.006, bx1 - depth - 0.036); ty = rng.uniform(cy0 + depth + 0.006, cy1 - depth - 0.036)
            _add_building(tx, tx + 0.03, ty, ty + 0.03, rng.uniform(0.07, 0.14), 'tower')

# 工厂超级街区内、厂区外的零星建筑
for x0, x1, y0, y1 in [(-0.315, -0.29, 0.20, 0.31), (-0.315, -0.29, -0.34, -0.25), (0.29, 0.315, -0.34, -0.24), (0.29, 0.315, 0.18, 0.31)]:
    _add_building(x0, x1, y0, y1, rng.uniform(0.02, 0.03), 'flat')

TREES = []
for x in GX:
    yy = -0.64
    while yy < 0.64:
        if not in_river(x, yy, 0.03) and not (-0.36 < x < 0.36 and -0.38 < yy < 0.36):
            TREES.append((x - 0.006, yy, rng.uniform(0.005, 0.0075)))
        yy += rng.uniform(0.026, 0.034)
for p in PARKS:
    for _ in range(int((p[1] - p[0]) * (p[3] - p[2]) / 0.0007)):
        TREES.append((rng.uniform(p[0] + 0.01, p[1] - 0.01), rng.uniform(p[2] + 0.01, p[3] - 0.01), rng.uniform(0.007, 0.011)))
xx = -1.0
while xx < 1.0:
    if not any(abs(xx - bx) < bw + 0.02 for bx, bw in BRIDGES):
        TREES.append((xx, river_y(xx) + RIVER_HALF + 0.016, rng.uniform(0.0055, 0.008)))
    xx += rng.uniform(0.028, 0.036)

# ---------------- 投影机（静止） ----------------
PROJ_POS = (0.0, -0.85, 3.7)
PROJ_TGT = (0.0, 0.0, 0.0)
PROJ_HALF = math.radians(18.5)
PROJ_RES = 4096


def _sub(a, b): return [a[i] - b[i] for i in range(3)]
def _dot(a, b): return sum(a[i] * b[i] for i in range(3))
def _norm(a):
    l = math.sqrt(_dot(a, a)); return [c / l for c in a]
def _cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def proj_basis():
    f = _norm(_sub(PROJ_TGT, PROJ_POS))
    z = [-c for c in f]
    x = _norm(_cross([0, 1, 0], z))
    y = _cross(z, x)
    return x, y, z


_B = proj_basis()


def proj_uv(p):
    x, y, z = _B
    d = _sub(p, PROJ_POS)
    xl, yl, zl = _dot(d, x), _dot(d, y), _dot(d, z)
    k = 1 / math.tan(PROJ_HALF)
    return 0.5 + 0.5 * k * xl / (-zl), 0.5 + 0.5 * k * yl / (-zl)


def proj_px(p):
    u, v = proj_uv(p)
    return u * PROJ_RES, (1 - v) * PROJ_RES


def building(name):
    for b in BUILDINGS:
        if b[0] == name:
            return b
    raise KeyError(name)


def roof_top(b):
    _, x0, x1, y0, y1, h, kind, prm = b
    return h + (prm.get('rise', 0) if kind in ('saw', 'gable') else prm.get('parapet', 0))


def route_len():
    return sum(math.dist(a, b) for a, b in zip(ROUTE[:-1], ROUTE[1:]))


def route_point(s):
    target = s * route_len()
    for a, b in zip(ROUTE[:-1], ROUTE[1:]):
        L = math.dist(a, b)
        if target <= L:
            t = target / L if L else 0
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        target -= L
    return ROUTE[-1]


LIB_C = ((building('hallA')[1] + building('hallB')[2]) / 2, (building('hallA')[3] + building('hallA')[4]) / 2)

if __name__ == '__main__':
    print('district buildings', len(DISTRICT), 'blocks', len(BLOCKS), 'parks', len(PARKS), 'trees', len(TREES))
