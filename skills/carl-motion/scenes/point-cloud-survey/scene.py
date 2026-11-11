# S27 点云测绘／剥层 B —— 合成示意点云：剥去树冠回波，露出古堡墙基与拱门，再凝结成实体地表。
# 用法: blender -b -P scene.py -- <raw_frames_dir> [start end step] [res_percent]
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/s27_raw'
F0, F1, FS = (int(argv[1]), int(argv[2]), int(argv[3])) if len(argv) >= 4 else (0, 239, 1)
RES = int(argv[4]) if len(argv) >= 5 else 100
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(2710)

FPS = 30
CASTLE_C = np.array([10.0, -5.0])
CASTLE_ROT = math.radians(12)
WIN = (-80.0, 95.0, -65.0, 55.0)          # 实体地表显示范围（测区窗口）
BIG = (-185.0, 195.0, -150.0, 140.0)       # 窗口外仍保留暗点


def srgb(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------- 地形 ----------------
_waves = []
_r = np.random.default_rng(77)
for amp, wl, nd in [(0.55, 38, 3), (0.35, 21, 3), (0.16, 11, 5), (0.06, 6.0, 9), (0.035, 3.3, 11), (0.022, 1.9, 13), (0.03, 1.15, 15)]:
    for _ in range(nd):
        a = _r.uniform(0, math.pi)
        _waves.append((amp / math.sqrt(nd), math.cos(a) * 2 * math.pi / wl, math.sin(a) * 2 * math.pi / wl, _r.uniform(0, 6.28)))


def to_local(x, y):
    dx, dy = x - CASTLE_C[0], y - CASTLE_C[1]
    c, s = math.cos(-CASTLE_ROT), math.sin(-CASTLE_ROT)
    return dx * c - dy * s, dx * s + dy * c


def to_world(u, v):
    c, s = math.cos(CASTLE_ROT), math.sin(CASTLE_ROT)
    return u * c - v * s + CASTLE_C[0], u * s + v * c + CASTLE_C[1]


def sdbox(u, v, bx, by):
    qx, qy = np.abs(u) - bx, np.abs(v) - by
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)


def base_terrain(x, y):
    h = 9.0 * np.exp(-(((x - 10) / 85) ** 2 + ((y + 5) / 65) ** 2))
    h += 2.2 * np.sin(x / 27 + 0.7) * np.cos(y / 33 - 0.3) - 1.5 * np.exp(-(((x + 70) / 40) ** 2 + ((y - 40) / 30) ** 2))
    for amp, kx, ky, ph in _waves:
        h += amp * np.sin(kx * x + ky * y + ph)
    return h


def features(x, y):
    u, v = to_local(x, y)
    f = np.zeros_like(u)
    # 外墙（残高起伏、南门缺口、北墙一处坍塌）
    d = np.abs(sdbox(u, v, 24, 16))
    var = 0.72 + 0.28 * np.sin(0.21 * u + 1.3) * np.cos(0.17 * v - 0.4) + 0.1 * np.sin(0.9 * u + 0.7 * v)
    gate = 1 - smooth(3.0, 4.2, np.abs(u)) * 0 - (1 - smooth(3.2, 4.4, np.abs(u))) * (v < 0)
    breach = 1 - 0.85 * (1 - smooth(1.5, 3.0, np.abs(u - 15))) * (v > 0)
    f += 1.3 * var * np.clip(1 - (d / 1.6) ** 2, 0, 1) ** 0.8 * gate * breach
    # 四角圆塔（中空）
    for cu, cv in [(24, 16), (-24, 16), (24, -16), (-24, -16)]:
        r = np.hypot(u - cu, v - cv)
        f = np.maximum(f, 1.9 * np.clip(1 - (r / 4.8) ** 2, 0, 1) ** 0.7 - 0.9 * np.clip(1 - (r / 2.2) ** 2, 0, 1))
    # 内堡
    dk = np.abs(sdbox(u + 12, v - 5, 7, 5.5))
    f = np.maximum(f, 0.95 * np.clip(1 - (dk / 1.3) ** 2, 0, 1) ** 0.8)
    # 隔墙
    dc = np.where(np.abs(v) < 16, np.abs(u - 6), 99)
    f = np.maximum(f, 0.65 * np.clip(1 - (dc / 1.2) ** 2, 0, 1) ** 0.8)
    # 护城壕（南侧留土桥）
    dm = np.abs(sdbox(u, v, 31, 23))
    causeway = 1 - (1 - smooth(3.5, 5.0, np.abs(u))) * (v < 0)
    f -= 1.3 * np.exp(-(dm / 2.6) ** 2) * causeway
    return f


def H(x, y):
    return base_terrain(x, y) + features(x, y)


def normals(x, y, e=0.3):
    hx = (H(x + e, y) - H(x - e, y)) / (2 * e)
    hy = (H(x, y + e) - H(x, y - e)) / (2 * e)
    n = np.stack([-hx, -hy, np.ones_like(hx)], 1)
    return n / np.linalg.norm(n, axis=1, keepdims=True)


SUN_AZ, SUN_EL = math.radians(188), math.radians(22)
SUN_DIR = np.array([math.cos(SUN_EL) * math.cos(SUN_AZ), math.cos(SUN_EL) * math.sin(SUN_AZ), math.sin(SUN_EL)])

# ---------------- 场景 ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.eevee.taa_render_samples = 24
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = RES
sc.render.fps = FPS
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
for k, v in [('use_shadows', True), ('use_raytracing', False)]:
    try:
        setattr(sc.eevee, k, v)
    except Exception:
        pass

world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']; bg.inputs[0].default_value = (*srgb('#05080A'), 1); bg.inputs[1].default_value = 1.0


def add_sun(name, d, strength, shadow=True, angle=2.0):
    l = bpy.data.lights.new(name, 'SUN'); l.energy = strength; l.angle = math.radians(angle)
    l.use_shadow = shadow; l.color = (1.0, 0.97, 0.92)
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o)
    o.rotation_euler = (-Vector(d)).to_track_quat('-Z', 'Y').to_euler()
    return o


add_sun('key', SUN_DIR, 3.5)
add_sun('fill', (-SUN_DIR[0], -SUN_DIR[1], 0.8), 0.9, shadow=False)
add_sun('front_fill', (0.1, -1.0, 0.9), 1.3, shadow=False)

# ---------- 实体地表（窗口内） ----------
STEP = 0.25
gx = np.arange(WIN[0], WIN[1] + 1e-6, STEP); gy = np.arange(WIN[2], WIN[3] + 1e-6, STEP)
nx, ny = len(gx), len(gy)
XX, YY = np.meshgrid(gx, gy)
ZZ = H(XX.ravel(), YY.ravel())
verts = np.c_[XX.ravel(), YY.ravel(), ZZ].astype(np.float32)
ii = np.arange(nx * ny).reshape(ny, nx)
quads = np.stack([ii[:-1, :-1], ii[:-1, 1:], ii[1:, 1:], ii[1:, :-1]], -1).reshape(-1, 4)
me = bpy.data.meshes.new('surface')
me.vertices.add(len(verts)); me.vertices.foreach_set('co', verts.ravel())
me.loops.add(quads.size); me.loops.foreach_set('vertex_index', quads.ravel().astype(np.int32))
me.polygons.add(len(quads)); me.polygons.foreach_set('loop_start', np.arange(0, quads.size, 4, dtype=np.int32))
me.update(); me.validate()
me.polygons.foreach_set('use_smooth', np.ones(len(quads), bool))
surf = bpy.data.objects.new('surface', me); sc.collection.objects.link(surf)


def surface_material():
    m = bpy.data.materials.new('stone'); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; Lk = nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    bsdf = N.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.92
    geo = N.new('ShaderNodeNewGeometry')
    sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(geo.outputs['Position'], sep.inputs[0])
    front = N.new('ShaderNodeValue'); front.name = 'front'; front.outputs[0].default_value = -999
    # 微弱等高线
    zm = N.new('ShaderNodeMath'); zm.operation = 'PINGPONG'; zm.inputs[1].default_value = 0.5
    Lk.new(sep.outputs[2], zm.inputs[0])
    cl = N.new('ShaderNodeMapRange'); cl.inputs[1].default_value = 0.0; cl.inputs[2].default_value = 0.025
    cl.inputs[3].default_value = 0.86; cl.inputs[4].default_value = 1.0; Lk.new(zm.outputs[0], cl.inputs[0])
    base = N.new('ShaderNodeRGB'); base.outputs[0].default_value = (*srgb('#BDB5A6'), 1)
    mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
    Lk.new(base.outputs[0], mul.inputs[6]); Lk.new(cl.outputs[0], mul.inputs[7])
    Lk.new(mul.outputs[2], bsdf.inputs['Base Color'])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 0.9; nz.inputs['Detail'].default_value = 6
    Lk.new(geo.outputs['Position'], nz.inputs['Vector'])
    bump = N.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.08
    Lk.new(nz.outputs['Fac'], bump.inputs['Height']); Lk.new(bump.outputs[0], bsdf.inputs['Normal'])
    # 前沿：x < front 显示实体；front-2.5..front 之间发冷白光缝
    dx = N.new('ShaderNodeMath'); dx.operation = 'SUBTRACT'; Lk.new(front.outputs[0], dx.inputs[0]); Lk.new(sep.outputs[0], dx.inputs[1])
    vis = N.new('ShaderNodeMath'); vis.operation = 'GREATER_THAN'; vis.inputs[1].default_value = 0.0; Lk.new(dx.outputs[0], vis.inputs[0])
    seam = N.new('ShaderNodeMapRange'); seam.inputs[1].default_value = 0.0; seam.inputs[2].default_value = 1.1
    seam.inputs[3].default_value = 1.0; seam.inputs[4].default_value = 0.0; Lk.new(dx.outputs[0], seam.inputs[0])
    seam_strength = N.new('ShaderNodeValue'); seam_strength.name = 'seam'; seam_strength.outputs[0].default_value = 0
    sm = N.new('ShaderNodeMath'); sm.operation = 'MULTIPLY'; Lk.new(seam.outputs[0], sm.inputs[0]); Lk.new(seam_strength.outputs[0], sm.inputs[1])
    bsdf.inputs['Emission Color'].default_value = (*srgb('#D4FFF0'), 1)
    Lk.new(sm.outputs[0], bsdf.inputs['Emission Strength'])
    tr = N.new('ShaderNodeBsdfTransparent')
    mix = N.new('ShaderNodeMixShader'); Lk.new(vis.outputs[0], mix.inputs[0]); Lk.new(tr.outputs[0], mix.inputs[1]); Lk.new(bsdf.outputs[0], mix.inputs[2])
    Lk.new(mix.outputs[0], out.inputs[0])
    return m


stone = surface_material()
surf.data.materials.append(stone)

# ---------- 拱门（实体 + 点） ----------
RO, RI, ZS, TH = 3.3, 2.2, 2.4, 1.6
GATE_U, GATE_V = 0.0, -16.0
K = 28


def arch_profile_faces():
    faces = []
    faces.append([(-RO, 0), (-RI, 0), (-RI, ZS), (-RO, ZS)])
    faces.append([(RI, 0), (RO, 0), (RO, ZS), (RI, ZS)])
    for i in range(K):
        a0, a1 = math.pi * (1 - i / K), math.pi * (1 - (i + 1) / K)
        faces.append([(RI * math.cos(a0), ZS + RI * math.sin(a0)), (RO * math.cos(a0), ZS + RO * math.sin(a0)),
                      (RO * math.cos(a1), ZS + RO * math.sin(a1)), (RI * math.cos(a1), ZS + RI * math.sin(a1))])
    return faces


def arch_loops():
    outer = [(-RO, 0), (-RO, ZS)] + [(RO * math.cos(math.pi * (1 - i / K)), ZS + RO * math.sin(math.pi * (1 - i / K))) for i in range(K + 1)] + [(RO, 0)]
    inner = [(RI, 0), (RI, ZS)] + [(RI * math.cos(math.pi * i / K), ZS + RI * math.sin(math.pi * i / K)) for i in range(K + 1)] + [(-RI, 0)]
    return outer, inner


gw = np.array([to_world(u, GATE_V + dv) for u in np.linspace(-RO, RO, 9) for dv in (-TH / 2, TH / 2)])
ARCH_BASE = float(H(gw[:, 0], gw[:, 1]).min()) - 0.35


def arch_world(u, z, dv):
    x, y = to_world(u, GATE_V + dv)
    return (x, y, ARCH_BASE + z)


bm = bmesh.new()
for dv in (-TH / 2, TH / 2):
    for f in arch_profile_faces():
        vs = [bm.verts.new(arch_world(u, z, dv)) for u, z in f]
        bm.faces.new(vs if dv > 0 else vs[::-1])
for loop in arch_loops():
    for (u0, z0), (u1, z1) in zip(loop[:-1], loop[1:]):
        vs = [bm.verts.new(arch_world(u0, z0, -TH / 2)), bm.verts.new(arch_world(u1, z1, -TH / 2)),
              bm.verts.new(arch_world(u1, z1, TH / 2)), bm.verts.new(arch_world(u0, z0, TH / 2))]
        bm.faces.new(vs)
for u0, u1 in [(-RO, -RI), (RI, RO)]:
    vs = [bm.verts.new(arch_world(u0, 0, -TH / 2)), bm.verts.new(arch_world(u1, 0, -TH / 2)),
          bm.verts.new(arch_world(u1, 0, TH / 2)), bm.verts.new(arch_world(u0, 0, TH / 2))]
    bm.faces.new(vs)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
arch_me = bpy.data.meshes.new('arch'); bm.to_mesh(arch_me); bm.free()
arch = bpy.data.objects.new('arch', arch_me); sc.collection.objects.link(arch)
arch.data.materials.append(stone)

# 拱门表面采样点
tri = []
for p in arch_me.polygons:
    vs = [np.array(arch_me.vertices[i].co) for i in p.vertices]
    for k in range(1, len(vs) - 1):
        tri.append((vs[0], vs[k], vs[k + 1]))
tri = np.array(tri)
area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
na = int(area.sum() * 10)
ti = rng.choice(len(tri), na, p=area / area.sum())
r1, r2 = rng.random(na), rng.random(na)
s1 = np.sqrt(r1)
arch_pts = (1 - s1)[:, None] * tri[ti, 0] + (s1 * (1 - r2))[:, None] * tri[ti, 1] + (s1 * r2)[:, None] * tri[ti, 2]
arch_pts = arch_pts[arch_pts[:, 2] > H(arch_pts[:, 0], arch_pts[:, 1]) - 0.05]
ARCH_TOP = np.array(arch_world(0, ZS + RO, 0))

# ---------- 点云 ----------
def scan_points(x0, x1, y0, y1, dl, ds, ang):
    c, s = math.cos(ang), math.sin(ang)
    R = math.hypot(x1 - x0, y1 - y0) / 2 + 2
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a = np.arange(-R, R, ds); b = np.arange(-R, R, dl)
    A, B = np.meshgrid(a, b)
    A = A + rng.normal(0, ds * 0.18, A.shape); B = B + rng.normal(0, dl * 0.12, B.shape)
    X = cx + A * c - B * s; Y = cy + A * s + B * c
    m = (X >= x0) & (X <= x1) & (Y >= y0) & (Y <= y1)
    return X[m], Y[m]


ang = math.radians(18)
gx_all, gy_all = scan_points(*BIG, 0.62, 0.52, ang)
inwin_coarse = (gx_all >= WIN[0]) & (gx_all <= WIN[1]) & (gy_all >= WIN[2]) & (gy_all <= WIN[3])
gx_all, gy_all = gx_all[~inwin_coarse], gy_all[~inwin_coarse]
wx, wy = scan_points(*WIN, 0.40, 0.31, ang)
GX = np.r_[wx, gx_all]; GY = np.r_[wy, gy_all]

# 树：抖动网格
CELL = 8.6
cx_n = int((BIG[1] - BIG[0]) / CELL) + 1; cy_n = int((BIG[3] - BIG[2]) / CELL) + 1
TX = np.full((cy_n, cx_n), np.nan); TY = np.full((cy_n, cx_n), np.nan); TR = np.zeros((cy_n, cx_n))
for j in range(cy_n):
    for i in range(cx_n):
        if rng.random() < 0.14:
            continue
        TX[j, i] = BIG[0] + (i + 0.5) * CELL + rng.uniform(-3.4, 3.4)
        TY[j, i] = BIG[2] + (j + 0.5) * CELL + rng.uniform(-3.4, 3.4)
        TR[j, i] = rng.uniform(3.3, 5.6)

# 拱门正上方压一棵大树，剥层前看不到拱门
_gx, _gy = to_world(GATE_U, GATE_V)
_i, _j = int((_gx - BIG[0]) / CELL), int((_gy - BIG[2]) / CELL)
TX[_j, _i], TY[_j, _i], TR[_j, _i] = _gx + 0.8, _gy + 0.5, 5.4
TX[_j - 1, _i], TY[_j - 1, _i], TR[_j - 1, _i] = _gx - 0.6, _gy - 7.2, 5.6

# 树冠下地面回波稀疏
ci = np.clip(((GX - BIG[0]) / CELL).astype(int), 0, cx_n - 1); cj = np.clip(((GY - BIG[2]) / CELL).astype(int), 0, cy_n - 1)
covered = np.zeros(len(GX), bool)
for dj in (-1, 0, 1):
    for di in (-1, 0, 1):
        jj = np.clip(cj + dj, 0, cy_n - 1); ii2 = np.clip(ci + di, 0, cx_n - 1)
        tx, ty, tr = TX[jj, ii2], TY[jj, ii2], TR[jj, ii2]
        covered |= np.nan_to_num((GX - tx) ** 2 + (GY - ty) ** 2, nan=1e9) < tr ** 2
keep = ~covered | (rng.random(len(GX)) < 0.5)
GX, GY = GX[keep], GY[keep]
GZ = H(GX, GY) + rng.normal(0, 0.025, len(GX))

vx, vy, vz = [], [], []
for j in range(cy_n):
    for i in range(cx_n):
        if np.isnan(TX[j, i]):
            continue
        x0, y0, rc = TX[j, i], TY[j, i], TR[j, i]
        g0 = float(H(np.array([x0]), np.array([y0]))[0])
        hc = g0 + rng.uniform(9.5, 15.5); cz = 0.75 * rc
        n = int(3.0 * math.pi * rc * rc)
        dz = np.clip(rng.uniform(-0.3, 1.0, n), -1, 1)
        ph = rng.uniform(0, 2 * math.pi, n)
        depth = 1 - np.clip(rng.exponential(0.12, n), 0, 0.6)
        lob = 1 + 0.12 * np.sin(3 * ph + i) * np.cos(2 * dz * math.pi)
        rr = rc * np.sqrt(1 - dz ** 2) * depth * lob
        vx.append(x0 + rr * np.cos(ph)); vy.append(y0 + rr * np.sin(ph)); vz.append(hc + cz * dz * depth)
        nt_ = 9
        tz = np.linspace(g0 + 1.2, hc - cz * 0.3, nt_)
        vx.append(x0 + rng.normal(0, 0.15, nt_)); vy.append(y0 + rng.normal(0, 0.15, nt_)); vz.append(tz)
VX, VY, VZ = np.concatenate(vx), np.concatenate(vy), np.concatenate(vz)

PX = np.r_[GX, arch_pts[:, 0], VX]; PY = np.r_[GY, arch_pts[:, 1], VY]; PZ = np.r_[GZ, arch_pts[:, 2], VZ]
CLS = np.r_[np.zeros(len(GX), np.int8), np.ones(len(arch_pts), np.int8), np.full(len(VX), 2, np.int8)]
NP = len(PX)
HAG = PZ - H(PX, PY)
INWIN = (PX >= WIN[0]) & (PX <= WIN[1]) & (PY >= WIN[2]) & (PY <= WIN[3])
print('points', NP, 'ground', len(GX), 'arch', len(arch_pts), 'veg', len(VX))

nrm = normals(PX, PY)
shade = np.clip(nrm @ SUN_DIR, 0, 1)
inten = np.clip(0.42 + 0.75 * shade + rng.normal(0, 0.08, NP), 0.25, 1.15)
inten[CLS == 1] = np.clip(0.55 + rng.normal(0, 0.1, (CLS == 1).sum()), 0.35, 0.8)

base_col = np.tile(srgb('#D6D3CA'), (NP, 1)) * (1.25 * inten)[:, None]
veg = CLS == 2
t_h = np.clip((HAG[veg] - 6) / 12, 0, 1)[:, None]
c0, c1, c2 = srgb('#1F3F35'), srgb('#5C9A7A'), srgb('#E2F3DC')
vcol = np.where(t_h < 0.5, c0 + (c1 - c0) * (t_h / 0.5), c1 + (c2 - c1) * ((t_h - 0.5) / 0.5))
base_col[veg] = vcol * (0.55 + 0.6 * np.clip(inten[veg], 0, 1))[:, None]
FRONT_C = srgb('#D4FFF0')
BASE_RAD = np.where(CLS == 2, 0.085, 0.065).astype(np.float32)
BASE_RAD[CLS == 1] = 0.07

pc_me = bpy.data.meshes.new('cloud')
pc_me.vertices.add(NP)
P0 = np.c_[PX, PY, PZ].astype(np.float32)
pc_me.vertices.foreach_set('co', P0.ravel())
a_col = pc_me.attributes.new('col', 'FLOAT_COLOR', 'POINT')
a_rad = pc_me.attributes.new('rad', 'FLOAT', 'POINT')
cloud = bpy.data.objects.new('cloud', pc_me); sc.collection.objects.link(cloud)
cloud.visible_shadow = False

ng = bpy.data.node_groups.new('pts', 'GeometryNodeTree')
ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
N = ng.nodes; Lk = ng.links
gi = N.new('NodeGroupInput'); go = N.new('NodeGroupOutput')
m2p = N.new('GeometryNodeMeshToPoints')
nr = N.new('GeometryNodeInputNamedAttribute'); nr.data_type = 'FLOAT'; nr.inputs['Name'].default_value = 'rad'
cmp_ = N.new('FunctionNodeCompare'); cmp_.data_type = 'FLOAT'; cmp_.operation = 'GREATER_THAN'; cmp_.inputs[1].default_value = 0.004
Lk.new(nr.outputs[0], cmp_.inputs[0])
smat = N.new('GeometryNodeSetMaterial')
pm = bpy.data.materials.new('pt'); pm.use_nodes = True; pnt = pm.node_tree; pnt.nodes.clear()
em = pnt.nodes.new('ShaderNodeEmission'); at = pnt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'col'
po = pnt.nodes.new('ShaderNodeOutputMaterial')
pnt.links.new(at.outputs['Color'], em.inputs['Color']); pnt.links.new(em.outputs[0], po.inputs[0])
smat.inputs['Material'].default_value = pm
Lk.new(gi.outputs[0], m2p.inputs['Mesh']); Lk.new(cmp_.outputs[0], m2p.inputs['Selection']); Lk.new(nr.outputs[0], m2p.inputs['Radius'])
Lk.new(m2p.outputs[0], smat.inputs['Geometry']); Lk.new(smat.outputs[0], go.inputs[0])
cloud.modifiers.new('gn', 'NODES').node_group = ng

# ---------- 琥珀色描线（已发现的墙基） ----------
amber = bpy.data.materials.new('amber'); amber.use_nodes = True
an = amber.node_tree.nodes; an.clear()
ae = an.new('ShaderNodeEmission'); ae.inputs[0].default_value = (*srgb('#FFB347'), 1); ae.inputs[1].default_value = 1.7
ao = an.new('ShaderNodeOutputMaterial'); amber.node_tree.links.new(ae.outputs[0], ao.inputs[0])


def ridge_poly(local_pts, step=0.5):
    out = []
    for (u0, v0), (u1, v1) in zip(local_pts[:-1], local_pts[1:]):
        n = max(2, int(math.hypot(u1 - u0, v1 - v0) / step))
        for k in range(n):
            t = k / n
            out.append(to_world(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t))
    out.append(to_world(*local_pts[-1]))
    out = np.array(out)
    z = H(out[:, 0], out[:, 1]) + 0.08
    return np.c_[out, z]


def make_trace(name, pts):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    sp.points.foreach_set('co', np.c_[pts, np.ones(len(pts))].astype(np.float32).ravel())
    cu.bevel_depth = 0.042; cu.bevel_resolution = 1; cu.use_fill_caps = True
    cu.bevel_factor_start = 0.0; cu.bevel_factor_end = 0.0
    ob = bpy.data.objects.new(name, cu); sc.collection.objects.link(ob)
    ob.data.materials.append(amber); ob.visible_shadow = False
    return ob


outer = make_trace('trace_outer', ridge_poly([(-3.6, -16), (-24, -16), (-24, 16), (24, 16), (24, -16), (3.6, -16)]))
keep_tr = make_trace('trace_keep', ridge_poly([(-19, -0.5), (-19, 10.5), (-5, 10.5), (-5, -0.5), (-19, -0.5)]))
cross_tr = make_trace('trace_cross', ridge_poly([(6, -15), (6, 15)]))
TRACES = [(outer, 5.45, 6.75), (keep_tr, 6.05, 6.95), (cross_tr, 6.3, 7.05)]

# ---------- 相机 ----------
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 32; cam_d.clip_start = 0.5; cam_d.clip_end = 2000
cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam
KEYS = [  # t, target xyz, dist, heading, pitch
    (0.0, (6, 0, 11), 140, -38, 24),
    (2.0, (8, -3, 8), 122, -26, 27),
    (4.0, (10, -6, 4.5), 98, -12, 31),
    (6.0, (11, -12, 3.5), 70, 6, 28),
    (8.0, (13, -14.5, 2.5), 50, 30, 24),
]


def catmull(t):
    ts = [k[0] for k in KEYS]
    vals = [np.array([*k[1], k[2], k[3], k[4]], float) for k in KEYS]
    i = min(max(np.searchsorted(ts, t) - 1, 0), len(KEYS) - 2)
    p1, p2 = vals[i], vals[i + 1]
    p0 = vals[i - 1] if i > 0 else 2 * p1 - p2
    p3 = vals[i + 2] if i + 2 < len(vals) else 2 * p2 - p1
    u = (t - ts[i]) / (ts[i + 1] - ts[i])
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)


def place_camera(t):
    v = catmull(t)
    tgt = Vector([float(a) for a in v[:3]]); d, hd, pt = float(v[3]), math.radians(float(v[4])), math.radians(float(v[5]))
    pos = tgt + d * Vector((math.cos(pt) * math.sin(hd), -math.cos(pt) * math.cos(hd), math.sin(pt)))
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    return np.array(pos)


# ---------- 时间线 ----------
def ease(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


CUT_STEPS = [(1.0, 1.55, 30.0, 17.0), (1.75, 2.35, 17.0, 11.5), (2.55, 3.15, 11.5, 6.0), (3.3, 3.9, 6.0, 0.4)]


def zcut(t):
    t = np.asarray(t, float)
    z = np.full(t.shape, 30.0)
    for a, b, z0, z1 in CUT_STEPS:
        z = np.where(t >= a, z0 + (z1 - z0) * ease((t - a) / (b - a)), z)
    return z


def front_x(t):
    return -100 + 210 * ease((t - 3.95) / (5.75 - 3.95)) if t >= 3.95 else -1000.0


ts_tab = np.linspace(0, 8, 4801)
zs_tab = zcut(ts_tab)
T_CROSS = np.full(NP, 99.0)
T_CROSS[veg] = np.interp(-HAG[veg], -zs_tab, ts_tab)
LIFE = 0.45
meta = {}
vsel = np.where(veg)[0]
gsel = np.where(~veg)[0]

for f in range(F0, F1 + 1, FS):
    t = f / FPS
    campos = place_camera(t)
    zc = float(zcut(np.array([t])))
    fx = front_x(t)
    rad = BASE_RAD.copy()
    col = base_col.copy()
    pos = P0.copy()
    # 植被：被切割平面越过后原地上浮、变亮、消隐
    life = (t - T_CROSS[vsel]) / LIFE
    gone = life >= 1
    act = (life > 0) & ~gone
    rad[vsel[gone]] = 0
    la = life[act]
    rad[vsel[act]] *= (1 - la) ** 0.7
    pos[vsel[act], 2] += 1.6 * la * la
    col[vsel[act]] = (col[vsel[act]] * (1 - 0.8 * (1 - la))[:, None] + FRONT_C * (0.9 * (1 - la))[:, None]) * (1 - 0.6 * la)[:, None]
    if 0.9 < t < 4.1:
        ring = vsel[(~gone) & (life <= 0) & (zc - HAG[vsel] > 0) & (zc - HAG[vsel] < 0.9)]
        col[ring] = col[ring] * 0.4 + FRONT_C * 0.75
    # 地面/拱门点：前沿之后凝结为实体，前沿之前略亮
    if fx > -999:
        d = PX[gsel] - fx
        inw = INWIN[gsel] | (CLS[gsel] == 1)
        k = np.clip((-d - 0.6) / 2.6, 0, 1) * inw
        rad[gsel] *= (1 - k)
        b = np.clip(1 - d / 3.0, 0, 1) * (d > 0) * inw
        col[gsel] = col[gsel] * (1 - 0.3 * b)[:, None] + FRONT_C * (0.4 * b)[:, None]
        if t > 5.0:
            out_w = ~INWIN[gsel] & (CLS[gsel] == 0)
            col[gsel[out_w]] *= 1 - 0.35 * ease((t - 5.0) / 1.2)
    # 距离雾
    dist = np.linalg.norm(pos - campos[None, :].astype(np.float32), axis=1)
    fog = np.exp(-np.maximum(dist - 105, 0) / 240)
    col *= (0.22 + 0.78 * fog)[:, None]
    pc_me.vertices.foreach_set('co', pos.ravel())
    a_rad.data.foreach_set('value', rad.astype(np.float32))
    a_col.data.foreach_set('color', np.c_[col, np.ones(NP)].astype(np.float32).ravel())
    pc_me.update()
    stone.node_tree.nodes['front'].outputs[0].default_value = fx
    stone.node_tree.nodes['seam'].outputs[0].default_value = 0.85 if 3.95 < t < 6.0 else 0.0
    for ob, a, b in TRACES:
        ob.data.bevel_factor_end = float(ease((t - a) / (b - a)))
    sc.frame_set(f + 1)
    co = world_to_camera_view(sc, cam, Vector(ARCH_TOP))
    meta[f + 1] = {'t': t, 'zcut': zc, 'arch_top': [co.x, co.y, co.z]}
    sc.render.filepath = os.path.join(OUT, f'{f + 1:04d}.png')
    bpy.ops.render.render(write_still=True)
    print('FRAME', f + 1, flush=True)

json.dump(meta, open(os.path.join(OUT, f'meta_{F0}_{F1}_{FS}.json'), 'w'))
print('DONE')
