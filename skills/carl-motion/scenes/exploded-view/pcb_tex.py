# S29 电路板：程序化生成主板/感光板版图贴图（阻焊、走线、铺铜、焊盘、过孔、丝印）与元件摆放表。
# 用法: python3 pcb_tex.py <out_dir>
# 输出: <board>_color.png, <board>_rmh.png (R=粗糙度 G=金属度 B=高度), <board>_parts.json
import sys, os, json, math, random
import numpy as np
from PIL import Image, ImageDraw

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)


class Board:
    def __init__(self, name, w, h, px_w, seed, mask, pour, trace, pad, silk):
        self.name, self.w, self.h = name, w, h
        self.ppm = px_w / w
        self.W, self.H = px_w, int(round(h * self.ppm))
        self.rng = random.Random(seed)
        self.col = Image.new('RGB', (self.W, self.H), mask)
        self.rmh = Image.new('RGB', (self.W, self.H), (90, 0, 70))
        self.dc, self.dr = ImageDraw.Draw(self.col), ImageDraw.Draw(self.rmh)
        self.mask, self.pourc, self.tracec, self.padc, self.silkc = mask, pour, trace, pad, silk
        self.occ = np.zeros((int(h * 4) + 2, int(w * 4) + 2), bool)   # 0.25 mm 占位网格
        self.parts, self.pads, self.pins = [], [], []

    def P(self, x, y):           # 板坐标 mm（原点居中，y 向上）→ 像素
        return ((x + self.w / 2) * self.ppm, (self.h / 2 - y) * self.ppm)

    def R(self, x0, y0, x1, y1):
        a, b = self.P(x0, y1), self.P(x1, y0)
        return [a[0], a[1], b[0], b[1]]

    def free(self, x0, y0, x1, y1, margin=0.35):
        i0, i1 = int((x0 - margin + self.w / 2) * 4), int((x1 + margin + self.w / 2) * 4) + 1
        j0, j1 = int((y0 - margin + self.h / 2) * 4), int((y1 + margin + self.h / 2) * 4) + 1
        if i0 < 4 or j0 < 4 or i1 > self.occ.shape[1] - 4 or j1 > self.occ.shape[0] - 4:
            return False
        return not self.occ[j0:j1, i0:i1].any()

    def take(self, x0, y0, x1, y1):
        i0, i1 = int((x0 + self.w / 2) * 4), int((x1 + self.w / 2) * 4) + 1
        j0, j1 = int((y0 + self.h / 2) * 4), int((y1 + self.h / 2) * 4) + 1
        self.occ[max(j0, 0):j1, max(i0, 0):i1] = True

    # ---- 绘制原语 ----
    def pad(self, x0, y0, x1, y1):
        self.pads.append((x0, y0, x1, y1))

    def silk_rect(self, x0, y0, x1, y1):
        self.dc.rectangle(self.R(x0, y0, x1, y1), outline=self.silkc, width=max(2, int(0.12 * self.ppm)))
        self.dr.rectangle(self.R(x0, y0, x1, y1), outline=(170, 0, 150), width=max(2, int(0.12 * self.ppm)))

    def trace(self, pts, w=0.16):
        px = [self.P(x, y) for x, y in pts]
        cw = int((w + 0.3) * self.ppm)
        self.dc.line(px, fill=self.mask, width=cw, joint='curve')                        # 铺铜间隙
        self.dc.line(px, fill=self.tracec, width=max(2, int(w * self.ppm)), joint='curve')
        self.dr.line(px, fill=(80, 0, 135), width=max(2, int(w * self.ppm)), joint='curve')

    def via(self, x, y, r=0.3):
        cx, cy = self.P(x, y); R1, R2 = r * self.ppm, r * 0.45 * self.ppm
        self.dc.ellipse([cx - R1, cy - R1, cx + R1, cy + R1], fill=self.tracec)
        self.dc.ellipse([cx - R2, cy - R2, cx + R2, cy + R2], fill=(20, 26, 20))
        self.dr.ellipse([cx - R1, cy - R1, cx + R1, cy + R1], fill=(80, 0, 140))
        self.dr.ellipse([cx - R2, cy - R2, cx + R2, cy + R2], fill=(150, 0, 0))

    def route(self, a, b):
        """45° 折线：先水平/竖直，再斜 45°，再直线到达"""
        (x0, y0), (x1, y1) = a, b
        dx, dy = x1 - x0, y1 - y0
        if abs(dx) > abs(dy):
            m = (x0 + math.copysign(abs(dx) - abs(dy), dx) * self.rng.uniform(0.3, 0.7), y0)
            k = (m[0] + math.copysign(abs(dy), dx), y1)
            return [a, m, k, b]
        m = (x0, y0 + math.copysign(abs(dy) - abs(dx), dy) * self.rng.uniform(0.3, 0.7))
        k = (x1, m[1] + math.copysign(abs(dx), dy))
        return [a, m, k, b]

    def finish(self):
        for x0, y0, x1, y1 in self.pads:
            self.dc.rectangle(self.R(x0, y0, x1, y1), fill=self.padc)
            self.dr.rectangle(self.R(x0, y0, x1, y1), fill=(55, 255, 200))
        self.col.save(os.path.join(OUT, f'{self.name}_color.png'), compress_level=3)
        self.rmh.save(os.path.join(OUT, f'{self.name}_rmh.png'), compress_level=3)
        json.dump({'w': self.w, 'h': self.h, 'parts': self.parts}, open(os.path.join(OUT, f'{self.name}_parts.json'), 'w'))
        print(self.name, 'parts', len(self.parts), 'px', self.W, self.H)


def add_passive(B, x, y, size, rot, kind):
    L, Wd = (1.0, 0.5) if size == '0402' else (1.6, 0.8)
    lx, ly = (L, Wd) if rot == 0 else (Wd, L)
    if not B.free(x - lx / 2, y - ly / 2, x + lx / 2, y + ly / 2):
        return None
    B.take(x - lx / 2 - 0.2, y - ly / 2 - 0.2, x + lx / 2 + 0.2, y + ly / 2 + 0.2)
    pe = 0.35 * L + 0.1
    pads = []
    for s in (-1, 1):
        if rot == 0:
            c = (x + s * (L / 2 - pe / 2 + 0.08), y); B.pad(c[0] - pe / 2, y - Wd / 2 - 0.05, c[0] + pe / 2, y + Wd / 2 + 0.05)
        else:
            c = (x, y + s * (L / 2 - pe / 2 + 0.08)); B.pad(x - Wd / 2 - 0.05, c[1] - pe / 2, x + Wd / 2 + 0.05, c[1] + pe / 2)
        pads.append(c)
    B.parts.append(dict(type='passive', kind=kind, size=size, x=x, y=y, rot=rot, L=L, W=Wd))
    return pads


def add_ic(B, typ, x, y, bw, bh, pins_side=0, pitch=0.5, lead=1.0):
    ext = lead + 0.4
    B.take(x - bw / 2 - ext, y - bh / 2 - ext, x + bw / 2 + ext, y + bh / 2 + ext)
    pins = []
    if pins_side:
        span = (pins_side - 1) * pitch
        for side in range(4):
            for k in range(pins_side):
                o = -span / 2 + k * pitch
                if side == 0: c, dx, dy = (x + o, y - bh / 2 - lead * 0.6), 0, -1
                elif side == 1: c, dx, dy = (x + bw / 2 + lead * 0.6, y + o), 1, 0
                elif side == 2: c, dx, dy = (x - o, y + bh / 2 + lead * 0.6), 0, 1
                else: c, dx, dy = (x - bw / 2 - lead * 0.6, y - o), -1, 0
                pl, pw = lead * 1.0, pitch * 0.55
                if dy: B.pad(c[0] - pw / 2, c[1] - pl / 2, c[0] + pw / 2, c[1] + pl / 2)
                else: B.pad(c[0] - pl / 2, c[1] - pw / 2, c[0] + pl / 2, c[1] + pw / 2)
                pins.append((c[0] + dx * lead * 0.5, c[1] + dy * lead * 0.5, dx, dy))
    B.silk_rect(x - bw / 2 - ext - 0.3, y - bh / 2 - ext - 0.3, x + bw / 2 + ext + 0.3, y + bh / 2 + ext + 0.3)
    B.parts.append(dict(type=typ, x=x, y=y, w=bw, h=bh, pins=pins_side, pitch=pitch, lead=lead))
    return pins


def scatter_passives(B, cx, cy, rad_in, rad_out, n, size_mix=0.75):
    got = []
    for _ in range(n * 6):
        if len(got) >= n:
            break
        a = B.rng.uniform(0, 2 * math.pi); r = B.rng.uniform(rad_in, rad_out)
        x, y = round((cx + r * math.cos(a)) * 4) / 4, round((cy + r * math.sin(a)) * 4) / 4
        size = '0402' if B.rng.random() < size_mix else '0603'
        kind = 'cap' if B.rng.random() < 0.62 else 'res'
        p = add_passive(B, x, y, size, B.rng.choice([0, 90]), kind)
        if p:
            got.append(p)
    return got


def row_passives(B, x0, y0, dx, dy, n, rot, size='0402'):
    got = []
    for k in range(n):
        p = add_passive(B, x0 + dx * k, y0 + dy * k, size, rot, 'cap' if k % 3 else 'res')
        if p: got.append(p)
    return got


# ======================= 主板 =======================
M = Board('main', 110.0, 56.0, 8192, 2929, mask=(38, 92, 52), pour=(52, 116, 64), trace=(78, 146, 84),
          pad=(214, 172, 86), silk=(232, 232, 222))
dp = ImageDraw.Draw(M.col)
for poly in [[(-55, -28), (-8, -28), (-8, -12), (-55, -12)], [(10, 14), (55, 14), (55, 28), (10, 28)],
             [(36, -28), (55, -28), (55, 0), (36, 0)], [(-55, 16), (-36, 16), (-36, 28), (-55, 28)]]:
    dp.polygon([M.P(*p) for p in poly], fill=M.pourc)
    ImageDraw.Draw(M.rmh).polygon([M.P(*p) for p in poly], fill=(85, 0, 110))
# 安装孔（镀金环）
for hx, hy in [(-51, -24), (51, -24), (-51, 24), (51, 24)]:
    cx, cy = M.P(hx, hy); r1, r2 = 2.6 * M.ppm, 1.6 * M.ppm
    M.dc.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=M.padc); M.dc.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(12, 12, 12))
    M.dr.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=(55, 255, 200)); M.dr.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(200, 0, 0))
    M.take(hx - 3.2, hy - 3.2, hx + 3.2, hy + 3.2)
    M.parts.append(dict(type='hole', x=hx, y=hy))

soc = add_ic(M, 'qfp', -22.0, 5.0, 14.0, 14.0, pins_side=25, pitch=0.5, lead=1.1)
dram = add_ic(M, 'bga', 2.0, 8.0, 11.0, 9.0)
pmic = add_ic(M, 'qfn', 25.0, 12.0, 6.0, 6.0, pins_side=10, pitch=0.5, lead=0.5)
qa = add_ic(M, 'qfn', 26.0, -9.0, 4.0, 4.0, pins_side=6, pitch=0.5, lead=0.4)
qb = add_ic(M, 'qfn', -44.0, -6.0, 4.0, 4.0, pins_side=6, pitch=0.5, lead=0.4)
for x, y in [(36, 13.5), (36, 5.5), (17, 21), (44, -6)]:
    M.take(x - 2.4, y - 2.4, x + 2.4, y + 2.4); M.pad(x - 2.1, y - 2.0, x - 1.1, y + 2.0); M.pad(x + 1.1, y - 2.0, x + 2.1, y + 2.0)
    M.parts.append(dict(type='inductor', x=x, y=y, s=4.0))
M.take(-11, -9, -5.4, -4.6); M.pad(-10.6, -8.6, -9.4, -7.6); M.pad(-7.0, -6.0, -5.8, -5.0)
M.parts.append(dict(type='crystal', x=-8.2, y=-6.8, w=3.2, h=2.5))
for x, y in [(-3, -16), (8, -14), (14, 2), (-38, 14), (-36, -18), (44, 22), (18, -22), (-2, 22)]:
    if M.free(x - 1.6, y - 1.6, x + 1.6, y + 1.6):
        M.take(x - 1.8, y - 1.8, x + 1.8, y + 1.8)
        for px, py in [(-0.95, -1.0), (0.95, -1.0), (0, 1.0)]:
            M.pad(x + px - 0.3, y + py - 0.35, x + px + 0.3, y + py + 0.35)
        M.parts.append(dict(type='sot23', x=x, y=y))
# FPC 连接器（软排线）与板对板连接器
M.take(-41, -26.8, -19, -19.6)
for k in range(24):
    px = -39.4 + k * 0.8; M.pad(px - 0.22, -25.6, px + 0.22, -24.4)
M.parts.append(dict(type='fpc', x=-30.0, y=-23.0, w=20.0, h=5.0, n=24))
M.take(18, -27, 42, -19)
for k in range(30):
    px = 19.8 + k * 0.7; M.pad(px - 0.18, -26.0, px + 0.18, -25.0); M.pad(px - 0.18, -21.0, px + 0.18, -20.0)
M.parts.append(dict(type='b2b', x=30.0, y=-23.0, w=22.0, h=5.0))

# 去耦电容：沿主控四边整齐排列（A 中那种成排元件）
caps = []
caps += row_passives(M, -31.5, -5.6, 1.5, 0, 13, 90)
caps += row_passives(M, -31.5, 15.6, 1.5, 0, 13, 90)
caps += row_passives(M, -32.6, -3.5, 0, 1.4, 14, 0)
caps += row_passives(M, -11.4, -3.5, 0, 1.4, 14, 0)
caps += row_passives(M, -4.5, 1.8, 1.5, 0, 9, 90)
caps += row_passives(M, -4.5, 14.2, 1.5, 0, 9, 90)
caps += scatter_passives(M, 25, 12, 5.5, 9, 26)
caps += scatter_passives(M, 26, -9, 4, 8, 16)
caps += scatter_passives(M, -44, -6, 4, 8, 14)
caps += scatter_passives(M, 0, -6, 2, 30, 120)
caps += scatter_passives(M, -30, 18, 2, 25, 40)
caps += scatter_passives(M, 30, 0, 2, 25, 60)

# 走线：主控 → 内存的总线（平行束）、主控 → 去耦、电源 → 电感、其余元件就近连线、连接器扇出
for k, (px, py, dx, dy) in enumerate(soc):
    if dx == 1 and k % 1 == 0:
        tgt = (2.0 - 5.5 - 0.8, 8.0 - 4.2 + (k % 25) * 0.33)
        M.trace(M.route((px + 0.6, py), (tgt[0], tgt[1])), w=0.13)
    elif dy == -1 and k % 2 == 0:
        M.trace([(px, py - 0.5), (px, py - 3.0 - (k % 5) * 0.4)], w=0.13)
        M.via(px, py - 3.4 - (k % 5) * 0.4, 0.28)
    elif dy == 1 and k % 3 == 0:
        M.trace([(px, py + 0.5), (px, py + 2.6)], w=0.13); M.via(px, py + 3.0, 0.28)
    elif dx == -1 and k % 2 == 0:
        M.trace([(px - 0.5, py), (px - 2.0, py)], w=0.13)
for k in range(24):
    px = -39.4 + k * 0.8
    tgt = (-29 + (k - 12) * 0.5, -4.8)
    M.trace([(px, -24.4), (px, -18 + abs(k - 12) * 0.2), (tgt[0], -12.0), (tgt[0], -6.8)], w=0.12)
for (x, y) in [(36, 13.5), (36, 5.5), (17, 21), (44, -6)]:
    M.trace(M.route((25, 12), (x, y)), w=0.45)
for k in range(30):
    px = 19.8 + k * 0.7
    if k % 2 == 0:
        M.trace([(px, -20.0), (px, -16 - (k % 4)), (px - 6 + k * 0.25, -12)], w=0.12)
for pads in caps:
    if M.rng.random() < 0.75:
        a = pads[0]
        b = (a[0] + M.rng.choice([-1, 1]) * M.rng.uniform(1.5, 6), a[1] + M.rng.choice([-1, 1]) * M.rng.uniform(1.0, 5))
        M.trace(M.route(a, b), w=0.15); M.via(*b, 0.28)
for _ in range(220):
    x, y = M.rng.uniform(-52, 52), M.rng.uniform(-26, 26)
    if M.free(x - 0.4, y - 0.4, x + 0.4, y + 0.4, 0.1):
        M.via(x, y, 0.26)
# 丝印：元件框与 pin1 标记（不写文字）
for p in M.parts:
    if p['type'] == 'passive':
        L, Wd = (p['L'], p['W']) if p['rot'] == 0 else (p['W'], p['L'])
        if M.rng.random() < 0.35:
            M.silk_rect(p['x'] - L / 2 - 0.25, p['y'] - Wd / 2 - 0.25, p['x'] + L / 2 + 0.25, p['y'] + Wd / 2 + 0.25)
cx, cy = M.P(-22 - 9.5, 5 + 9.5); r = 0.5 * M.ppm
M.dc.ellipse([cx - r, cy - r, cx + r, cy + r], fill=M.silkc)
for fx, fy in [(-48, 0), (48, 12), (0, -26)]:
    cx, cy = M.P(fx, fy); r1 = 0.5 * M.ppm
    M.dc.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=M.padc)
M.finish()

# ======================= 感光板 =======================
S = Board('sensor', 50.0, 44.0, 4096, 3131, mask=(22, 24, 24), pour=(30, 34, 33), trace=(48, 56, 52),
          pad=(214, 172, 86), silk=(220, 220, 212))
S.take(-19, -15, 19, 17)
S.parts.append(dict(type='sensor', x=0.0, y=1.0, w=36.0, h=30.0))
for k in range(4):
    for side in (-1, 1):
        S.pad(side * 18.4 - 0.4, -12 + k * 7.5, side * 18.4 + 0.4, -11 + k * 7.5)
S.take(-10, -21.5, 10, -16.5)
for k in range(16):
    px = -6.0 + k * 0.8; S.pad(px - 0.22, -21.0, px + 0.22, -19.8)
S.parts.append(dict(type='fpc', x=0.0, y=-19.0, w=16.0, h=4.0, n=16))
for hx, hy in [(-22, -18), (22, -18), (-22, 19), (22, 19)]:
    cx, cy = S.P(hx, hy); r1, r2 = 1.9 * S.ppm, 1.2 * S.ppm
    S.dc.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=S.padc); S.dc.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(10, 10, 10))
    S.dr.ellipse([cx - r1, cy - r1, cx + r1, cy + r1], fill=(55, 255, 200)); S.dr.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(200, 0, 0))
    S.take(hx - 2.2, hy - 2.2, hx + 2.2, hy + 2.2); S.parts.append(dict(type='hole', x=hx, y=hy, r=1.2))
sc_ = scatter_passives(S, 0, 0, 19, 24, 34)
sc_ += row_passives(S, -15, -16.5, 1.5, 0, 4, 90) + row_passives(S, 11, -16.5, 1.5, 0, 4, 90)
for pads in sc_:
    a = pads[0]; b = (a[0] * 0.8, a[1] * 0.8)
    S.trace(S.route(a, b), w=0.14); S.via(*b, 0.25)
for k in range(16):
    px = -6.0 + k * 0.8
    S.trace([(px, -19.8), (px, -16.5), (px * 1.8, -14.0)], w=0.12)
S.finish()
