"""S30 黑白木刻版画 B — 风暴后修复渔船。
用法: python3 scene.py <帧目录> [帧号,逗号分隔(0起)] ；每帧是 t=f/30 的纯函数（种子固定）。"""
import os, sys, math
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
PX0, PY0, PX1, PY1 = 48, 36, 1872, 880          # 版面（印版）区域，纸边固定不动
YH = 522                                          # 海平线
SUN = np.array([1490.0, 500.0])
LIGHT = np.array([0.72, 0.42, 0.55]); LIGHT /= np.linalg.norm(LIGHT)
ELEV = math.radians(13)


def clamp(x, a=0.0, b=1.0): return np.minimum(b, np.maximum(a, x))
def seg(t, a, b): return float(np.clip((t - a) / (b - a), 0, 1))
def sine(k): return 0.5 - 0.5 * math.cos(math.pi * k)
def smooth(k): return k * k * (3 - 2 * k)
def spring(t, t0, amp, f=2.2, d=4.0): return 0.0 if t < t0 else amp * math.exp(-d * (t - t0)) * math.sin(2 * math.pi * f * (t - t0))


def vnoise(h, w, cell, seed, sx=1.0):
    rng = np.random.default_rng(seed)
    gh, gw = h // cell + 3, int(w // (cell * sx)) + 3
    g = rng.random((gh, gw)).astype(np.float32)
    big = cv2.resize(g, (gw * int(cell * sx), gh * cell), interpolation=cv2.INTER_CUBIC)
    return big[:h, :w]


# ---------------------------------------------------------------- 刻刀笔触
def draw_cut(img, P, Wd, val=255):
    if len(P) < 2: return
    d = np.gradient(P, axis=0)
    n = np.stack([-d[:, 1], d[:, 0]], 1)
    n /= (np.linalg.norm(n, axis=1, keepdims=True) + 1e-6)
    ok = Wd >= 0.55
    edges = np.flatnonzero(np.diff(np.r_[0, ok.astype(np.int8), 0]))
    for a, b in zip(edges[::2], edges[1::2]):
        if b - a < 2: continue
        p, w, nn = P[a:b], Wd[a:b, None] / 2, n[a:b]
        poly = np.concatenate([p + nn * w, (p - nn * w)[::-1]])
        cv2.fillPoly(img, [np.round(poly * 8).astype(np.int32)], val, cv2.LINE_AA, shift=3)


def gouge(img, P, Wd, seed, lmin=40, lmax=150, gmin=5, gmax=15, val=255, entry=.1, exitf=.4):
    """一条长线拆成一刀一刀：钝入口、尖出口，刀与刀之间留木。"""
    if len(P) < 2: return
    s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    L = s[-1]
    rng = np.random.default_rng(seed)
    cur = -rng.uniform(0, lmax)
    while cur < L:
        ln = rng.uniform(lmin, lmax)
        m = (s >= cur) & (s <= cur + ln)
        if m.sum() >= 2:
            tp = (s[m] - cur) / ln
            taper = np.clip(tp / entry, 0, 1) ** .5 * np.clip((1 - tp) / exitf, 0, 1) ** .7
            draw_cut(img, P[m], Wd[m] * taper, val)
        cur += ln + rng.uniform(gmin, gmax)


def poly_line(img, pts, width, val):
    cv2.polylines(img, [np.round(np.asarray(pts) * 8).astype(np.int32)], False, val, max(1, int(round(width))), cv2.LINE_AA, shift=3)


# ---------------------------------------------------------------- 天空
def sky_tone(x, y, t):
    op = 0.32 + 0.68 * smooth(seg(t, 3.4, 7.2))
    g = np.exp(-((x - SUN[0]) / 640) ** 2 - ((y - SUN[1]) / 240) ** 2)
    hz = np.exp(-((y - YH) / 85) ** 2)
    tone = 0.03 + 0.12 * (0.5 + 0.5 * np.sin(x / 210 + y / 90)) * clamp((y - 60) / 200) + 0.95 * g * op + hz * (0.25 + 0.45 * op) * clamp(x / 1500) + 0.08 * clamp((x - 900) / 900)
    tone *= clamp((y - 40) / 260 + 0.25)                       # 顶部风暴压暗
    return clamp(tone)


def draw_sky(img, t):
    xs = np.arange(PX0 - 30, PX1 + 30, 4.0)
    y = PY0 - 4.0; k = 0
    while y < YH - 2:
        sp = 6.0 + 7.0 * (1 - (y - PY0) / (YH - PY0)) ** 1.2      # 远（近地平线）细密
        drift = t * 10
        yy = y + 5 * np.sin((xs + drift) / 260 + k * .7) + 2.5 * np.sin((xs - drift * .6) / 97 + k)
        tone = sky_tone(xs, yy, t)
        gouge(img, np.stack([xs, yy], 1), sp * .95 * tone ** 1.25, 1000 + k, 50, 170, 4, 14)
        y += sp; k += 1
    # 太阳：整块刻白 + 一圈留木
    op = smooth(seg(t, 3.4, 7.2))
    cv2.circle(img, (int(SUN[0] * 8), int(SUN[1] * 8)), int(48 * 8), 255, -1, cv2.LINE_AA, shift=3)
    cv2.circle(img, (int(SUN[0] * 8), int(SUN[1] * 8)), int(58 * 8), 0, int(5), cv2.LINE_AA, shift=3)
    # 刻出来的光：放射 U 刀，随云散开而伸长
    grow = 60 + 520 * smooth(seg(t, 4.2, 7.6))
    rng = np.random.default_rng(77)
    for i, a in enumerate(np.arange(math.radians(186), math.radians(354), math.radians(6.5))):
        ln = grow * (0.55 + 0.45 * rng.random()) * (1 if i % 2 else .72)
        r = np.linspace(72, 72 + ln, 40)
        P = np.stack([SUN[0] + r * math.cos(a), SUN[1] + r * math.sin(a)], 1)
        wd = (13 - 9 * (r - 72) / max(ln, 1)) * (0.45 + 0.55 * op)
        draw_cut(img, P, wd * np.clip((r - 72) / 25, 0, 1) ** .5)


CLOUDS = []
def _make_clouds():
    rng = np.random.default_rng(5)
    for bank, (cx, cy, ex, ey, n, rmin, rmax) in enumerate([(430, 165, 600, 105, 34, 30, 78),
                                                              (1500, 430, 500, 62, 30, 24, 58),
                                                              (930, 305, 230, 34, 12, 16, 36),
                                                              (1180, 150, 320, 48, 14, 20, 44)]):
        for i in range(n):
            a = rng.uniform(0, 2 * math.pi); rr = math.sqrt(rng.random())
            dy = math.sin(a) * rr * ey
            CLOUDS.append(dict(bank=bank, dx=math.cos(a) * rr * ex, dy=dy * (0.45 if dy > 0 else 1),
                               r=rng.uniform(rmin, rmax), cx=cx, cy=cy, ph=rng.uniform(0, 6.28)))
_make_clouds()


def cloud_circles(t):
    part = smooth(seg(t, 3.6, 6.6))
    out = []
    for c in CLOUDS:
        x, y, r = c['cx'] + c['dx'], c['cy'] + c['dy'], c['r'] * (1 + .07 * math.sin(t * 1.4 + c['ph']))
        wgt = 1.0
        if c['bank'] == 0: x -= 26 * t; y -= 4 * t
        if c['bank'] == 1:                                   # 太阳前的云分开
            sgn = 1 if c['dy'] > -6 else -1
            y += (part * (70 + .3 * abs(c['dx']))) * (-1 if sgn < 0 else .25); x += (c['dx'] * .25) * part - 12 * t
            wgt = 1 - (.75 if sgn > 0 else .45) * part
        if c['bank'] == 2: x += 30 * t
        if c['bank'] == 3: x += 14 * t
        out.append((x, y, r, wgt))
    return out


def draw_clouds(img, t):
    tq = math.floor(t * 12) / 12                              # 云的刀痕按 twos 重刻
    circ = np.array(cloud_circles(tq))
    q = 4
    gy, gx = np.mgrid[0:H // q, 0:W // q].astype(np.float32) * q
    F = np.zeros_like(gx)
    for x, y, r, wg in circ:
        F += .62 * wg * np.exp(-((gx - x) ** 2 + (gy - y) ** 2) / (r * r))
    Ff = cv2.resize(F, (W, H), interpolation=cv2.INTER_CUBIC)
    cm = Ff > .72
    halo = cv2.dilate(cm.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
    ys, xs = np.nonzero(halo & ~cm)
    keep = sky_tone(xs.astype(np.float32), ys.astype(np.float32), t) > .22
    img[ys[keep], xs[keep]] = 255
    img[cm] = 0
    op = 0.35 + 0.65 * smooth(seg(t, 3.4, 7.2))
    gyF, gxF = np.gradient(F)
    for li, lev in enumerate((.78, .95, 1.15, 1.4, 1.75)):
        cs, _ = cv2.findContours((F > lev).astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        for c in cs:
            if len(c) < 6: continue
            c = c[:, 0, :].astype(np.float32)
            ix, iy = np.clip(c[:, 0].astype(int), 0, W // q - 1), np.clip(c[:, 1].astype(int), 0, H // q - 1)
            P = c * q + q / 2
            nrm = -np.stack([gxF[iy, ix], gyF[iy, ix]], 1); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
            to = SUN[None] - P; dist = np.linalg.norm(to, axis=1); to /= dist[:, None] + 1e-9
            facing = np.clip((nrm * to).sum(1), 0, 1) ** 1.3
            near = np.exp(-(dist / 950) ** 2)
            wd = (7.0 - li * 1.15) * facing * (0.25 + 0.75 * near) * op
            P = np.vstack([P, P[:1]]); wd = np.r_[wd, wd[:1]]
            k = max(1, len(P) // 400)
            P = cv2.GaussianBlur(P.reshape(-1, 1, 2), (1, 5), 0).reshape(-1, 2)[::k]; wd = wd[::k]
            m = P.mean(0)
            gouge(img, P, wd, 5000 + li * 1000 + int(m[0] // 90) * 13 + int(m[1] // 90), 18, 80, 4, 11, exitf=.5)


# ---------------------------------------------------------------- 海面
def wave_y(xs, k, N, t):
    d = k / N
    amp = 1.2 + 9 * d ** 1.3
    f1, f2 = 2 * math.pi / (80 + 300 * d), 2 * math.pi / (37 + 130 * d)
    rock = 1 + .5 * smooth(seg(t, 3.8, 5)) * (1 - .4 * smooth(seg(t, 6.5, 8)))
    return amp * rock * (.62 * np.sin(xs * f1 - t * (1.2 + d) + k * 1.3) + .38 * np.sin(xs * f2 + t * (1.9 + d) + k * 2.1))


def sea_rows():
    N = 44
    return [(k, YH + 3 + (k / N) ** 1.75 * (PY1 + 20 - YH), N) for k in range(N)]


def draw_sea(img, t):
    xs = np.arange(PX0 - 30, PX1 + 30, 4.0)
    op = 0.35 + 0.65 * smooth(seg(t, 3.4, 7.2))
    rows = sea_rows()
    for idx, (k, y0, N) in enumerate(rows):
        sp = (rows[idx + 1][1] - y0) if idx + 1 < len(rows) else 22
        y = y0 + wave_y(xs, k, N, t)
        dy = np.gradient(y, xs)
        d = k / N
        crest = clamp(.5 - dy * 3.2)
        glit = np.exp(-((xs - SUN[0]) / (50 + 340 * d)) ** 2) * op * (.55 + .45 * np.sin(xs * .09 - t * 4 + k * 1.7))
        tone = clamp(.06 + .42 * crest ** 2 * (.5 + .5 * clamp(xs / 1600)) + .95 * glit + .25 * np.exp(-((y0 - YH) / 30) ** 2) * op)
        gouge(img, np.stack([xs + (t * 6 * (1 + d)) % 1, y], 1), sp * .9 * tone ** 1.15, 2000 + k,
              30 + 40 * d, 90 + 120 * d, 4, 10 + 10 * d)


# ---------------------------------------------------------------- 渔船（3D 投影）
def hull_point(u, v, side):
    b = .17 * max(0.0, 1 - (2 * u) ** 2) ** .55
    g = .07 + .11 * (2 * u) ** 4 + .03 * max(0.0, u)
    k = -.10 * max(0.0, 1 - (2 * u) ** 2) ** .5
    th = v * math.pi / 2
    return np.array([u, k + (g - k) * (1 - math.cos(th)), side * b * math.sin(th)])


class Boat:
    def __init__(self, t):
        tq = math.floor(t * 12) / 12                        # 角色/船按 12fps 更新（twos）
        self.t = tq
        turn = smooth(seg(tq, 5.85, 7.7))
        self.yaw = math.radians(200 + 128 * turn)
        rockk = .5 + 1.2 * smooth(seg(tq, 3.8, 4.4)) * (1 - .55 * smooth(seg(tq, 6.4, 8)))
        self.roll = .035 * rockk * math.sin(tq * 2.3 + .4) + .015 * math.sin(tq * 1.1)
        self.pitch = .02 * rockk * math.sin(tq * 1.7 + 1.1)
        self.cx = 760 + 70 * turn + 3 * math.sin(tq * 1.3)
        self.cy = 646 + 7 * math.sin(tq * 1.9) * rockk
        self.S = 640.0

    def P(self, p):
        u, v, w = p
        cr, sr = math.cos(self.roll), math.sin(self.roll)
        v, w = v * cr - w * sr, v * sr + w * cr
        cp, sp = math.cos(self.pitch), math.sin(self.pitch)
        u, v = u * cp - v * sp, u * sp + v * cp
        ca, sa = math.cos(self.yaw), math.sin(self.yaw)
        X, Z, Y = u * ca - w * sa, u * sa + w * ca, v
        return np.array([self.cx + self.S * X, self.cy - self.S * (Y * math.cos(ELEV) - Z * math.sin(ELEV))]), \
            np.array([X, Y, Z])

    def world_dir(self, p):
        return self.P(p)[1] - self.P((0, 0, 0))[1]


def draw_boat(img, t):
    B = Boat(t)
    tq = B.t
    US, VS = np.linspace(-.5, .5, 41), np.linspace(0, 1, 11)
    view = np.array([0, math.sin(ELEV), math.cos(ELEV)])
    sil = np.zeros((H, W), np.uint8)
    quads = []
    for side in (-1, 1):
        G = [[B.P(hull_point(u, v, side)) for v in VS] for u in US]
        for i in range(len(US) - 1):
            for j in range(len(VS) - 1):
                c = [G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]]
                pts = np.array([q[0] for q in c]); wp = np.array([q[1] for q in c])
                nrm = np.cross(wp[1] - wp[0], wp[3] - wp[0]) * side
                nrm /= np.linalg.norm(nrm) + 1e-9
                quads.append((wp.mean(0) @ view, pts, nrm))
    for _, pts, _ in quads:
        cv2.fillPoly(sil, [np.round(pts * 8).astype(np.int32)], 255, cv2.LINE_AA, shift=3)
    deck = np.array([B.P(hull_point(u, 1, -1))[0] for u in US] + [B.P(hull_point(u, 1, 1))[0] for u in US[::-1]])
    cv2.fillPoly(sil, [np.round(deck * 8).astype(np.int32)], 255, cv2.LINE_AA, shift=3)
    # 桅、桁、帆的几何
    mu = .1
    deck_y = hull_point(mu, 1, 1)[1]
    mast_top = (mu, deck_y + .70, 0)
    hb = deck_y + .09
    raise_k = smooth(seg(tq, 1.0, 3.5))
    hh = hb + .06 + (.56 - .06) * raise_k + spring(tq, 3.5, .025, 2.4, 5)
    boom_ang = .22 + .05 * math.sin(tq * 1.6)
    bdir = np.array([-math.cos(boom_ang), 0, math.sin(boom_ang)])
    LB = .55
    boom_end = np.array([mu, hb, 0]) + bdir * LB
    gaff_ang = math.radians(4 + 24 * raise_k)
    gaff_end = np.array([mu, hh, 0]) + bdir * ((.30 + .08 * raise_k) * math.cos(gaff_ang)) + np.array([0, (.30 + .08 * raise_k) * math.sin(gaff_ang), 0])
    fill = .35 + .65 * smooth(seg(tq, 2.4, 4.2))
    fold_amp = .028 * (1 - raise_k) ** .8

    def sail_pt(p, q):
        foot = np.array([mu, hb, 0]) + bdir * LB * p
        head = np.array([mu, hh, 0]) + (gaff_end - np.array([mu, hh, 0])) * p
        pt = foot + (head - foot) * q
        side = np.array([math.sin(boom_ang), 0, math.cos(boom_ang)])
        belly = .07 * fill * math.sin(math.pi * p) * math.sin(math.pi * min(1, q * 1.05)) + fold_amp * math.sin(q * 9 * math.pi) * math.sin(math.pi * p)
        return pt + side * belly

    PS, QS = np.linspace(0, 1, 26), np.linspace(0, 1, 34)
    SP = np.array([[B.P(sail_pt(p, q))[0] for q in QS] for p in PS])
    SW = np.array([[B.P(sail_pt(p, q))[1] for q in QS] for p in PS])
    sail_poly = np.concatenate([SP[:, 0], SP[-1, :], SP[::-1, -1], SP[0, ::-1]])

    def solid_line(a, b, wd, halo=4):
        poly_line(img, [a, b], wd + 2 * halo, 255)
        poly_line(img, [a, b], wd, 0)

    # 白色刀晕 → 实体留黑
    halo = cv2.dilate(sil, np.ones((9, 9), np.uint8))
    img[halo > 127] = 255
    img[sil > 127] = 0
    # 船板：受光侧沿船形长刀
    for v in (.22, .36, .5, .63, .76, .88):
        pts, wds = [], []
        for u in np.linspace(-.48, .48, 90):
            for side in (-1, 1):
                p0 = hull_point(u, v, side)
                dv = hull_point(u, min(1, v + .02), side) - hull_point(u, max(0, v - .02), side)
                du = hull_point(min(.5, u + .01), v, side) - hull_point(max(-.5, u - .01), v, side)
                n = B.world_dir(tuple(np.cross(du, dv) * side))
                n /= np.linalg.norm(n) + 1e-9
                if n @ view > 0.02:
                    scr, _ = B.P(p0)
                    pts.append(scr); wds.append(1.0 + 7.5 * max(0, n @ LIGHT) ** 1.4)
        if len(pts) > 3:
            gouge(img, np.array(pts), np.array(wds), 3000 + int(v * 100), 40, 140, 3, 9)
    # 船舷上沿：一条刀线
    for side in (-1, 1):
        rim = np.array([B.P(hull_point(u, 1, side))[0] for u in np.linspace(-.49, .49, 80)])
        gouge(img, rim, np.full(len(rim), 2.6), 3900 + side, 80, 220, 3, 7)
    # 桅、桁
    mb, mt = B.P((mu, deck_y, 0))[0], B.P(mast_top)[0]
    solid_line(mb, mt, 12)
    poly_line(img, [mb + np.array([4, 0]), mt + np.array([3, 0])], 1.6, 255)
    solid_line(B.P((mu, hb, 0))[0], B.P(tuple(boom_end))[0], 9)
    # 帆：先刀晕，再留黑，再沿布纹刻宽刀（亮处几乎连成白）
    sm = np.zeros((H, W), np.uint8)
    cv2.fillPoly(sm, [np.round(sail_poly * 8).astype(np.int32)], 255, cv2.LINE_AA, shift=3)
    img[cv2.dilate(sm, np.ones((9, 9), np.uint8)) > 127] = 255
    img[sm > 127] = 0
    for i, p in enumerate(PS[1:-1], 1):
        col = SP[i]
        dp = np.linalg.norm(SP[i + 1] - SP[i - 1], axis=1) / 2
        dq = SW[i, 1:] - SW[i, :-1]; dq = np.vstack([dq, dq[-1:]])
        dpw = SW[i + 1] - SW[i - 1]
        n = np.cross(dpw, dq); n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        lit = np.abs(n @ LIGHT)
        fold_shade = 1 - .7 * (fold_amp / .028) * (.5 + .5 * np.cos(QS * 9 * math.pi * 2))
        tone = clamp(.32 + .68 * lit) * fold_shade
        gouge(img, col, dp * .84 * tone, 4000 + i, 260, 700, 3, 5, entry=.04, exitf=.12)
    # 补丁与针脚（风暴撕破处）
    if raise_k > .35:
        pq = [(.5, .34), (.74, .34), (.74, .6), (.5, .6), (.5, .34)]
        pp = np.array([B.P(sail_pt(p, q))[0] for p, q in pq])
        poly_line(img, pp, 3, 0)
        for (a, b) in zip(pp[:-1], pp[1:]):
            for s in np.linspace(.1, .9, 5):
                c = a + (b - a) * s; d = (b - a) / (np.linalg.norm(b - a) + 1e-6); n = np.array([-d[1], d[0]])
                poly_line(img, [c - n * 7, c + n * 7], 2, 0)
    poly_line(img, np.vstack([sail_poly, sail_poly[:1]]), 3, 0)
    solid_line(B.P((mu, hh, 0))[0], B.P(tuple(gaff_end))[0], 7, 3)

    # 绳：白色刀线（黑底上的绳）
    def rope(a, b, sag, wd=2.4, seed=0):
        s = np.linspace(0, 1, 40)
        P = a[None] + (b - a)[None] * s[:, None]
        P[:, 1] += sag * 4 * s * (1 - s)
        gouge(img, P, np.full(40, wd), seed, 60, 400, 2, 4, entry=.02, exitf=.05)
        d = (b - a) / (np.linalg.norm(b - a) + 1e-6); n = np.array([-d[1], d[0]])
        for j, q in enumerate(np.linspace(.06, .94, int(np.linalg.norm(b - a) / 14))):
            c = P[int(q * 39)]
            poly_line(img, [c - n * 2.2 - d * 2, c + n * 2.2 + d * 2], 1.2, 0)
    bow = B.P(hull_point(.5, 1, 0))[0]; stern = B.P(hull_point(-.5, 1, 0))[0]
    rope(mt, bow, 0, 2.2, 61)
    rope(mt, stern, 0, 2.2, 62)
    rope(mt, B.P((mu, hh, 0))[0] + np.array([2, 0]), 0, 2.0, 63)
    # 主缆：先松后收紧，带回弹
    tight = smooth(seg(tq, 2.5, 3.3))
    sag = 46 * (1 - tight) + spring(tq, 3.3, 7, 3.2, 4.5)
    cleat = B.P(hull_point(-.43, 1, 0))[0]
    rope(B.P(tuple(boom_end))[0], cleat, sag, 2.6, 64)
    # 绳结：收紧时缩小
    ks = 1.35 - .35 * smooth(seg(tq, 3.0, 3.5)) + spring(tq, 3.5, .1, 3, 5)
    cv2.circle(img, tuple(np.int32(cleat * 8)), int(15 * ks * 8), 255, -1, cv2.LINE_AA, shift=3)
    cv2.circle(img, tuple(np.int32(cleat * 8)), int(11 * ks * 8), 0, -1, cv2.LINE_AA, shift=3)
    for a in (0.6, 2.2, 3.9, 5.4):
        c = cleat + 6 * ks * np.array([math.cos(a + tq), math.sin(a + tq)])
        poly_line(img, [c - 3 * ks, c + 3 * ks], 1.8, 255)
    return B


def front_water(img, sea, B, t):
    xs = np.arange(0, W, 1.0)
    hull = np.array([B.P(hull_point(u, 0, s))[0] for u in np.linspace(-.5, .5, 30) for s in (-1, 1)])
    x0, x1 = hull[:, 0].min() - 40, hull[:, 0].max() + 40
    surf = B.cy + 3 + 4 * np.sin(xs / 37 + t * 2.2) + 2.5 * np.sin(xs / 13 - t * 3.1)
    yy = np.arange(H)[:, None]
    reg = (yy > surf[None, :]) & (xs[None, :] >= x0) & (xs[None, :] <= x1)
    img[reg] = sea[reg]
    # 吃水线白浪 + 刺点
    m = (xs >= x0 + 30) & (xs <= x1 - 30)
    P = np.stack([xs[m], surf[m]], 1)
    gouge(img, P, np.full(m.sum(), 3.2), 7000 + int(t * 15), 14, 50, 4, 14)
    rng = np.random.default_rng(int(t * 15))
    for _ in range(26):
        x = rng.uniform(x0 + 20, x1 - 20); y = B.cy + rng.uniform(-6, 16)
        cv2.circle(img, (int(x * 8), int(y * 8)), int(rng.uniform(1.6, 3.4) * 8), 255, -1, cv2.LINE_AA, shift=3)


# ---------------------------------------------------------------- 印刷
NOISE = {}
def noises():
    if not NOISE:
        NOISE['hf'] = vnoise(H + 64, W + 64, 2, 11)
        NOISE['lf'] = vnoise(H, W, 90, 12)
        NOISE['grain'] = vnoise(H + 64, W + 64, 3, 13, sx=40)
        NOISE['speck'] = vnoise(H + 64, W + 64, 1, 14)
        NOISE['fib'] = vnoise(H, W, 2, 15)
        e = vnoise(H, W, 6, 16)
        yy, xx = np.mgrid[0:H, 0:W]
        NOISE['plate'] = ((xx > PX0 + 3 * e) & (xx < PX1 - 3 * e) & (yy > PY0 + 3 * e) & (yy < PY1 - 3 * e)).astype(np.float32)
        NOISE['plate'] = cv2.GaussianBlur(NOISE['plate'], (0, 0), .7)
        NOISE['laid'] = (np.sin(yy * 2 * np.pi / 9.0) * .010).astype(np.float32)
        NOISE['text'] = caption_mask()
    return NOISE


def caption_mask():
    im = Image.new('L', (W, H), 0); d = ImageDraw.Draw(im)
    try: f1 = ImageFont.truetype('/System/Library/Fonts/Supplemental/Baskerville.ttc', 46)
    except OSError: f1 = ImageFont.load_default()
    try: f2 = ImageFont.truetype('/System/Library/Fonts/Supplemental/Songti.ttc', 38)
    except OSError: f2 = f1
    for txt, f, y in (("After the storm, the sail goes up again.", f1, 912), ("风暴过后，帆重新升起。", f2, 976)):
        w = d.textlength(txt, font=f); d.text(((W - w) / 2, y), txt, font=f, fill=255)
    return np.asarray(im, np.float32) / 255


def print_frame(mask, t, f):
    N = noises()
    step = f // 2                                               # 纸墨每 2 帧微动
    r = np.random.default_rng(900 + step); ox, oy = r.integers(0, 64, 2)
    hf = N['hf'][oy:oy + H, ox:ox + W]
    grain = N['grain'][oy // 4:oy // 4 + H, ox:ox + W]
    speck = N['speck'][oy:oy + H, ox:ox + W]
    cut = mask.astype(np.float32) / 255
    cut = np.clip((cut - .5 + .3 * (hf - .5)) * 3.2 + .5, 0, 1)
    cut = cv2.GaussianBlur(cut, (0, 0), .55)
    cut = np.maximum(cut, (speck > .993) * .55)                 # 没吃墨的小白点
    plate = N['plate']
    ink_amt = plate * (1 - cut)
    cap = N['text'] * (0.0 if t < .6 else min(1, (t - .6) / .1))
    cap = np.clip((cap - .5 + .25 * (hf - .5)) * 2.4 + .5, 0, 1) * (N['text'] > .02)
    ink_amt = np.maximum(ink_amt, cap * .92)
    paper = np.array([214, 229, 237], np.float32)               # BGR 暖白纸
    ink = np.array([20, 21, 25], np.float32)
    pap = paper[None, None] * (1 + .03 * (N['fib'][..., None] - .5) + N['laid'][..., None])
    inkc = ink[None, None] + (paper - ink)[None, None] * (.05 * N['lf'][..., None] + .09 * grain[..., None] ** 3)
    out = pap * (1 - ink_amt[..., None]) + inkc * ink_amt[..., None]
    return np.clip(out, 0, 255).astype(np.uint8)


def render(f):
    t = f / 30
    img = np.zeros((H, W), np.uint8)
    draw_sky(img, t)
    draw_clouds(img, t)
    sea = np.zeros((H, W), np.uint8)
    draw_sea(sea, t)
    img[YH:] = sea[YH:]
    B = draw_boat(img, t)
    front_water(img, sea, B, t)
    z = 1 + .045 * sine(t / 8)
    cx, cy = 900 + 25 * smooth(seg(t, 5.8, 8)), 470
    M = np.float32([[z, 0, cx - z * cx], [0, z, cy - z * cy]])
    img = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
    return print_frame(img, t, f)


def _job(args):
    f, out = args
    cv2.imwrite(os.path.join(out, f"{f + 1:04d}.png"), render(f))
    return f


if __name__ == '__main__':
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    frames = [int(x) for x in sys.argv[2].split(',')] if len(sys.argv) > 2 else list(range(240))
    from multiprocessing import Pool
    with Pool(int(os.environ.get('JOBS', 4))) as p:
        for f in p.imap_unordered(_job, [(f, out) for f in frames]):
            if f % 30 == 0: print('frame', f, flush=True)
    print('DONE', len(frames))
