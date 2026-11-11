# S28 投影机画面：逐帧生成 240 张 4096² 投影图（颜色只以"光"的形式落到白模上）
# 静态线稿（街道路缘、屋顶轮廓、公园/水面/院落排线）预先画好；每帧画建筑填色、路线、点亮闪光。
# 用法: python3 project.py <out_dir> [start end]
import sys, os, math
from PIL import Image, ImageDraw, ImageChops, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout import *

OUT = sys.argv[1]
F0, F1 = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) >= 4 else (0, 239)
os.makedirs(OUT, exist_ok=True)
S = PROJ_RES
FPS = 30


def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def ease(x):
    x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)


def hull(pts):
    pts = sorted(set((round(a, 2), round(b, 2)) for a, b in pts))
    if len(pts) < 3:
        return pts
    def cr(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cr(hi[-2], hi[-1], p) <= 0: hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def box_hull(x0, x1, y0, y1, z0, z1):
    return hull([proj_px((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)])


def rect_px(x0, x1, y0, y1, z):
    return [proj_px((x0, y0, z)), proj_px((x1, y0, z)), proj_px((x1, y1, z)), proj_px((x0, y1, z))]


def mix(c1, c2, a):
    return tuple(int(round(c1[i] * (1 - a) + c2[i] * a)) for i in range(3))


def scale(c, k):
    return tuple(max(0, min(255, int(round(v * k)))) for v in c)


# ---------- 预计算多边形 ----------
import random as _r
_rr = _r.Random(2828)
DIST_POLY = []
for x0, x1, y0, y1, h, roof, extra in DISTRICT:
    _lit, _jit, _lv, _bj = _rr.random() > 0.2, 0.8 + 0.4 * _rr.random(), 0.75 + 0.25 * _rr.random(), _rr.random()
    top = h + (0.008 if roof == 'gable' else 0.0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    DIST_POLY.append((box_hull(x0, x1, y0, y1, 0.0, top + 0.001), math.hypot(cx - LIB_C[0], cy - LIB_C[1]) * _jit if _lit else 99.0,
                      rect_px(x0, x1, y0, y1, top), (_lv, _bj)))
FAC_POLY = {}
for b in BUILDINGS:
    name, x0, x1, y0, y1, h, kind, prm = b
    FAC_POLY[name] = (box_hull(x0, x1, y0, y1, 0.0, roof_top(b) + 0.001), rect_px(x0, x1, y0, y1, h))
c = CHIMNEY
FAC_POLY['chimney'] = (hull([proj_px((c['x'] + r * math.cos(a), c['y'] + r * math.sin(a), z))
                              for a in [k * math.pi / 12 for k in range(24)] for r, z in ((c['r0'], 0), (c['r1'], c['h']))]), None)
FAC_POLY['yard'] = (box_hull(*YARD, 0.0, 0.003), None)

# ---------- 静态线稿 ----------
lines = Image.new('L', (S, S), 0)
ld = ImageDraw.Draw(lines)
# 河面与公园/院落排线（用遮罩裁切）
def hatch(angle_deg, spacing, width):
    im = Image.new('L', (S, S), 0); d = ImageDraw.Draw(im)
    a = math.radians(angle_deg); dx, dy = math.cos(a), math.sin(a); nx, ny = -dy, dx
    for k in range(-int(1.5 * S / spacing), int(1.5 * S / spacing)):
        ox, oy = S / 2 + nx * k * spacing, S / 2 + ny * k * spacing
        d.line([(ox - dx * 2 * S, oy - dy * 2 * S), (ox + dx * 2 * S, oy + dy * 2 * S)], fill=255, width=width)
    return im


river_poly = [proj_px((x / 100, river_y(x / 100) - RIVER_HALF, -0.004)) for x in range(-106, 107, 2)] + \
             [proj_px((x / 100, river_y(x / 100) + RIVER_HALF, -0.004)) for x in range(106, -107, -2)]
water_mask = Image.new('L', (S, S), 0); ImageDraw.Draw(water_mask).polygon(river_poly, fill=255)
for bx, bw in BRIDGES:
    ImageDraw.Draw(water_mask).polygon(rect_px(bx - bw, bx + bw, -0.62, -0.30, 0.004), fill=0)
lines = ImageChops.lighter(lines, ImageChops.multiply(hatch(0, 12, 3), water_mask).point(lambda v: v * 0.7))
park_mask = Image.new('L', (S, S), 0); pd = ImageDraw.Draw(park_mask)
for p in PARKS:
    pd.polygon(rect_px(*p, 0.001), fill=255)
lines = ImageChops.lighter(lines, ImageChops.multiply(hatch(45, 10, 3), park_mask).point(lambda v: v * 0.8))
court_mask = Image.new('L', (S, S), 0); cd = ImageDraw.Draw(court_mask)
for blk in BLOCKS:
    cd.polygon(rect_px(*blk, 0.001), fill=255)
for poly, *_ in DIST_POLY:
    cd.polygon(poly, fill=0)
lines = ImageChops.lighter(lines, ImageChops.multiply(hatch(-45, 13, 3), court_mask).point(lambda v: v * 0.55))
ld = ImageDraw.Draw(lines)
for blk in BLOCKS:                               # 路缘
    ld.line(rect_px(*blk, 0.001) + [rect_px(*blk, 0.001)[0]], fill=255, width=5)
for _, _, roofr, _ in DIST_POLY:                    # 屋顶轮廓
    ld.line(roofr + [roofr[0]], fill=230, width=3)
ld.line(river_poly[:len(river_poly) // 2], fill=220, width=3)
ld.line(river_poly[len(river_poly) // 2:], fill=220, width=3)
for bx, bw in BRIDGES:
    r = rect_px(bx - bw, bx + bw, -0.62, -0.30, 0.006); ld.line(r + [r[0]], fill=220, width=3)
LINE_TINT = rgb('#D4E6F7')
lines_rgb = Image.merge('RGB', [lines.point(lambda v, c=c: v * c / 255) for c in LINE_TINT])

site_line = Image.new('L', (S, S), 0)
r = rect_px(*SITE, 0.002); ImageDraw.Draw(site_line).line(r + [r[0]], fill=255, width=5)
for name, (poly, roofr) in FAC_POLY.items():
    if roofr:
        ImageDraw.Draw(site_line).line(roofr + [roofr[0]], fill=200, width=3)
ORANGE = rgb(OLD_ORANGE)
site_rgb = Image.merge('RGB', [site_line.point(lambda v, c=c: v * c / 255) for c in ORANGE])

# 径向铺开遮罩（投影轴心距离）
cxp, cyp = proj_px((0.0, 0.0, 0.0))
rad = Image.radial_gradient('L').resize((S * 2, S * 2), Image.BILINEAR)
rad = rad.crop((int(S - cxp), int(S - cyp), int(2 * S - cxp), int(2 * S - cyp)))    # 0 在轴心，255 在 S 像素处

plate_poly = rect_px(PLATE[0] - 0.03, PLATE[1] + 0.03, PLATE[2] - 0.03, PLATE[3] + 0.03, 0.0)
glow = Image.radial_gradient('L').resize((220, 220)).point(lambda v: int(255 * max(0, 1 - v / 255) ** 2.2))

OLD = [b[0] for b in BUILDINGS] + ['chimney']
PUB = {p[0]: p for p in PUBLIC}
TON = {p[0]: next(3.0 + k / 3000 * 2.6 for k in range(3001) if ease(k / 3000) >= p[1]) for p in PUBLIC}
NEAR, MID = 0.36, 0.72
REACH_RGB = [rgb(h) for h in REACH]
FLICK = {30: 0.35, 31: 1.0, 32: 0.5, 33: 0.9, 34: 1.0}


def route_upto(s):
    L = route_len(); pts, acc = [ROUTE[0]], 0.0
    for a, b in zip(ROUTE[:-1], ROUTE[1:]):
        l = math.dist(a, b)
        if acc + l <= s * L:
            pts.append(b); acc += l
        else:
            t = (s * L - acc) / l; pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)); break
    return [proj_px((x, y, 0.004)) for x, y in pts]


def reach_R(t):
    return 1.35 * ease((t - 4.4) / 2.2)


for f in range(F0, F1 + 1):
    t = f / FPS
    img = Image.new('RGB', (S, S), (0, 0, 0))
    strike = 0.0 if f < 30 else FLICK.get(f, 1.0)
    if strike > 0:
        d = ImageDraw.Draw(img)
        d.polygon(plate_poly, fill=(5, 7, 9))
        R = reach_R(t)
        line_k = 1.0 * (1 - 0.3 * ease((t - 4.6) / 1.0))
        # 周边建筑：步行可达（示意）逐栋点亮
        for poly, dist, _, (lv, bj) in DIST_POLY:
            if R <= dist:
                continue
            tl = 4.4 + 2.2 * (dist / 1.35)     # 近似点亮时刻（用于闪光）
            band = max(0, min(2, int(dist / 0.42 + 1.3 * bj - 0.45)))
            col = REACH_RGB[band]
            on = min(1.0, (R - dist) / 0.05)
            fl = max(0.0, 1 - (t - tl) / 0.3) if t >= tl else 0.0
            d.polygon(poly, fill=scale(mix(col, (255, 255, 255), 0.55 * fl), 0.95 * lv * on))
        # 厂区：旧厂房橙色，公共空间按路线点亮
        s_route = ease((t - 3.0) / 2.6)
        for name in OLD + ['yard']:
            poly = FAC_POLY[name][0]
            if name in PUB:
                on = ease((s_route - PUB[name][1]) / 0.06) if t >= 3.0 else 0.0
                if on > 0:
                    fl = max(0.0, 1 - (t - TON[name]) / 0.35) if t >= TON[name] else 0.0
                    br = 1 + 0.05 * math.sin(2 * math.pi * (t - 6.0) / 1.6) * ease((t - 6.0) / 0.4)
                    d.polygon(poly, fill=scale(mix(rgb(PUB[name][2]), (255, 255, 255), 0.6 * fl), on * br))
                    continue
                if name == 'yard':
                    continue
                lvl = 1.0
            else:
                lvl = 1 - 0.45 * ease((t - 3.0) / 0.5)
            d.polygon(poly, fill=scale(ORANGE, lvl))
        img = ImageChops.add(img, lines_rgb.point(lambda v: int(v * line_k)))
        img = ImageChops.add(img, site_rgb.point(lambda v: int(v * (1 - 0.4 * ease((t - 3.0) / 0.5)))))
        # 路线光迹与光头
        if t >= 3.0:
            pts = route_upto(max(s_route, 0.002))
            d = ImageDraw.Draw(img)
            if len(pts) >= 2:
                d.line(pts, fill=rgb('#D2F6FF'), width=9, joint='curve')
            if s_route < 1.0:
                hx, hy = proj_px((*route_point(s_route), 0.004))
                g = Image.merge('RGB', [glow] * 3)
                box = (int(hx) - 110, int(hy) - 110)
                region = img.crop((box[0], box[1], box[0] + 220, box[1] + 220))
                img.paste(ImageChops.add(region, g), box)
        # 投影机铺开（1.05–2.4 s）
        wr = ease((t - 1.05) / 1.3) * 1.25
        if wr < 1.2:
            thr = wr * S * 0.7
            m = rad.point(lambda v: int(255 * min(1.0, max(0.0, (thr - v * S / 255 / 2 * 2) / (0.06 * S) + 0.5))))
            img = ImageChops.multiply(img, Image.merge('RGB', [m] * 3))
        if strike < 1.0:
            img = img.point(lambda v: int(v * strike))
    img.save(os.path.join(OUT, f'{f + 1:04d}.png'), compress_level=1)
    if f % 20 == 0:
        print('proj', f + 1, flush=True)
print('PROJ DONE')
