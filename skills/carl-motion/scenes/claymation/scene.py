# S12 黏土定格 B — 原创黏土小猫把泥团捏成小盆栽。Blender 5.2, EEVEE。
# 用法: blender -b --factory-startup -P scene.py -- <帧目录> [起始帧 结束帧 步长 分辨率百分比]
import bpy, bmesh, math, sys, os, random
from mathutils import Vector, Matrix, Euler, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/S12_frames"
F0 = int(argv[1]) if len(argv) > 1 else 1
F1 = int(argv[2]) if len(argv) > 2 else 240
STEP = int(argv[3]) if len(argv) > 3 else 1
PCT = int(argv[4]) if len(argv) > 4 else 100
os.makedirs(OUT, exist_ok=True)
FPS = 30
CM = 0.01  # true miniature scale: model in centimetres

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene


def V(x, y, z):
    return Vector((x, y, z)) * CM


def hexrgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1,)


# ---------------- clay material: matte, grain, thumb dents, fingerprint ridges ----------------
def clay(name, col, rough=0.62, sss=0.06, print_strength=1.0, coord_scale=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough
    b.inputs["Subsurface Weight"].default_value = sss
    b.inputs["Subsurface Radius"].default_value = (0.004, 0.002, 0.0015)
    b.inputs["Specular IOR Level"].default_value = 0.35
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vm = nt.nodes.new("ShaderNodeVectorMath")
    vm.operation = 'SCALE'
    vm.inputs["Scale"].default_value = coord_scale
    nt.links.new(tc.outputs["Object"], vm.inputs[0])
    # colour variation
    nc = nt.nodes.new("ShaderNodeTexNoise")
    nc.inputs["Scale"].default_value = 90.0
    nc.inputs["Detail"].default_value = 3.0
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    mix.inputs["Factor"].default_value = 0.0
    rgb = hexrgb(col)
    mix.inputs["A"].default_value = tuple(c * 0.9 for c in rgb[:3]) + (1,)
    mix.inputs["B"].default_value = tuple(min(1, c * 1.08) for c in rgb[:3]) + (1,)
    nt.links.new(vm.outputs["Vector"], nc.inputs["Vector"])
    nt.links.new(nc.outputs["Fac"], mix.inputs["Factor"])
    nt.links.new(mix.outputs["Result"], b.inputs["Base Color"])
    # fine grain
    ng = nt.nodes.new("ShaderNodeTexNoise")
    ng.inputs["Scale"].default_value = 2600.0
    ng.inputs["Detail"].default_value = 2.0
    nt.links.new(vm.outputs["Vector"], ng.inputs["Vector"])
    # thumb dents: large soft voronoi cells
    vo = nt.nodes.new("ShaderNodeTexVoronoi")
    vo.feature = 'SMOOTH_F1'
    vo.inputs["Scale"].default_value = 140.0
    vo.inputs["Smoothness"].default_value = 1.0
    nt.links.new(vm.outputs["Vector"], vo.inputs["Vector"])
    # fingerprint ridges: fine rings, only in patches
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.wave_type = 'RINGS'
    wv.inputs["Scale"].default_value = 260.0
    wv.inputs["Distortion"].default_value = 3.0
    wv.inputs["Detail"].default_value = 1.0
    nt.links.new(vm.outputs["Vector"], wv.inputs["Vector"])
    patch = nt.nodes.new("ShaderNodeTexNoise")
    patch.inputs["Scale"].default_value = 70.0
    nt.links.new(vm.outputs["Vector"], patch.inputs["Vector"])
    pm = nt.nodes.new("ShaderNodeMapRange")
    pm.inputs["From Min"].default_value = 0.55
    pm.inputs["From Max"].default_value = 0.68
    nt.links.new(patch.outputs["Fac"], pm.inputs["Value"])
    ridge = nt.nodes.new("ShaderNodeMath")
    ridge.operation = 'MULTIPLY'
    nt.links.new(wv.outputs["Fac"], ridge.inputs[0])
    nt.links.new(pm.outputs["Result"], ridge.inputs[1])
    b1 = nt.nodes.new("ShaderNodeBump")
    b1.inputs["Strength"].default_value = 0.25
    b1.inputs["Distance"].default_value = 0.0004
    nt.links.new(ng.outputs["Fac"], b1.inputs["Height"])
    b2 = nt.nodes.new("ShaderNodeBump")
    b2.inputs["Strength"].default_value = 0.45
    b2.inputs["Distance"].default_value = 0.0012
    nt.links.new(vo.outputs["Distance"], b2.inputs["Height"])
    nt.links.new(b1.outputs["Normal"], b2.inputs["Normal"])
    b3 = nt.nodes.new("ShaderNodeBump")
    b3.inputs["Strength"].default_value = 0.18 * print_strength
    b3.inputs["Distance"].default_value = 0.0002
    nt.links.new(ridge.outputs["Value"], b3.inputs["Height"])
    nt.links.new(b2.outputs["Normal"], b3.inputs["Normal"])
    nt.links.new(b3.outputs["Normal"], b.inputs["Normal"])
    return m


M_CAT = clay("cat", "#5d6e87")
M_CREAM = clay("cream", "#efe2c4")
M_POT = clay("terracotta", "#c4653b")
M_GREEN = clay("green", "#56a23c")
M_PINK = clay("pink", "#e8959c", print_strength=0.3)
M_WHITE = clay("eyewhite", "#f3f0e8", rough=0.45, print_strength=0.2)
M_BLACK = clay("pupil", "#1a1a1d", rough=0.3, print_strength=0.0)
M_BLUE = clay("can", "#3f7fd4", coord_scale=0.1)
M_CAT_MB = clay("cat_mb", "#5d6e87", coord_scale=0.1)
M_CREAM_MB = clay("cream_mb", "#efe2c4", coord_scale=0.1)
M_GREEN_MB = clay("green_mb", "#56a23c", coord_scale=0.1)
M_RED = clay("mush", "#d8452f", coord_scale=0.1)

# ---------------- seamless yellow sweep ----------------
def sweep():
    bm = bmesh.new()
    prof = []
    for i in range(30):
        prof.append((-80 + i * (80 / 29) * 1.0, 0.0))
    R = 30.0
    for i in range(1, 25):
        a = (i / 24) * math.pi / 2
        prof.append((R * math.sin(a), R * (1 - math.cos(a))))
    for i in range(1, 10):
        prof.append((R, R + i * 8))
    # (y, z) profile; translate so curve starts at y=28
    rows = []
    for k, x in enumerate([-150, -50, 0, 50, 150]):
        row = [bm.verts.new((x * CM, (py + 28) * CM, pz * CM)) for py, pz in prof]
        rows.append(row)
    for k in range(len(rows) - 1):
        for i in range(len(prof) - 1):
            bm.faces.new((rows[k][i], rows[k + 1][i], rows[k + 1][i + 1], rows[k][i + 1]))
    me = bpy.data.meshes.new("sweep")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new("sweep", me)
    scene.collection.objects.link(o)
    m = bpy.data.materials.new("paper")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.85
    b.inputs["Specular IOR Level"].default_value = 0.12
    # even photographic backdrop: floor (up-facing) gets less albedo than the sweep wall
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], sz.inputs["Vector"])
    mx = nt.nodes.new("ShaderNodeMix")
    mx.data_type = 'RGBA'
    mx.inputs["A"].default_value = hexrgb("#d2b417")
    mx.inputs["B"].default_value = hexrgb("#8c760b")
    nt.links.new(sz.outputs["Z"], mx.inputs["Factor"])
    nt.links.new(mx.outputs["Result"], b.inputs["Base Color"])
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = 900.0
    bp = nt.nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.08
    bp.inputs["Distance"].default_value = 0.0003
    nt.links.new(n.outputs["Fac"], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])
    me.materials.append(m)
    return o

sweep()

# ---------------- revolved clay mesh: lump -> pancake -> column -> pot ----------------
NP, NA = 84, 80

def superell(a, b, cz, p, s0=0.15, dimple=0.0):
    pts = []
    # find phi0 where z = 0
    lo, hi = -math.pi / 2, 0.0
    def zf(ph):
        s = math.sin(ph)
        return cz + b * math.copysign(abs(s) ** (2 / p), s)
    for _ in range(40):
        mid = (lo + hi) / 2
        if zf(mid) < 0:
            lo = mid
        else:
            hi = mid
    ph0 = hi
    r0 = a * abs(math.cos(ph0)) ** (2 / p)
    for i in range(NP):
        s = i / (NP - 1)
        if s <= s0:
            pts.append((r0 * s / s0, 0.0))
        else:
            ph = ph0 + (math.pi / 2 - ph0) * (s - s0) / (1 - s0)
            r = a * abs(math.cos(ph)) ** (2 / p)
            z = zf(ph)
            if dimple:
                z -= dimple * math.exp(-((1 - s) / 0.08) ** 2)
            pts.append((r, max(0.0, z)))
    return pts

def from_ctrl(ctrl):
    pts = []
    for i in range(NP):
        s = i / (NP - 1)
        for k in range(len(ctrl) - 1):
            if ctrl[k][0] <= s <= ctrl[k + 1][0]:
                u = (s - ctrl[k][0]) / (ctrl[k + 1][0] - ctrl[k][0])
                pts.append((ctrl[k][1] + (ctrl[k + 1][1] - ctrl[k][1]) * u, ctrl[k][2] + (ctrl[k + 1][2] - ctrl[k][2]) * u))
                break
    return pts

def smooth(pts, it=6):
    p = list(pts)
    for _ in range(it):
        q = [p[0]]
        for i in range(1, len(p) - 1):
            q.append(((p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4))
        q.append(p[-1])
        p = q
    return p

SH_A = smooth(superell(1.95, 1.75, 1.62, 2.0), 3)                       # lump
SH_B = smooth(superell(3.05, 0.62, 0.44, 3.2), 3)                       # pressed pancake
SH_C = smooth(superell(1.62, 2.2, 2.05, 3.0, dimple=0.35), 3)           # pulled-up column
SH_D = smooth(from_ctrl([(0, 0, 0), (0.15, 1.72, 0.0), (0.2, 1.88, 0.22), (0.55, 2.3, 3.35), (0.58, 2.42, 3.72),
                         (0.61, 2.32, 3.95), (0.645, 2.02, 3.93), (0.68, 1.86, 3.62), (0.92, 1.32, 0.8),
                         (0.96, 0.72, 0.64), (1.0, 0, 0.6)]), 5)             # pot

def mixp(a, b, u):
    return [(p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u) for p, q in zip(a, b)]

def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

def lerp(a, b, u):
    return a + (b - a) * u

SH_AB = mixp(SH_A, SH_B, 0.55)
KEYS = [(0.0, SH_A), (1.05, SH_A), (1.4, SH_AB), (1.6, SH_AB), (2.0, SH_B), (2.4, SH_B), (3.1, SH_C), (3.9, SH_D)]

def shape_at(t):
    if t >= KEYS[-1][0]:
        return KEYS[-1][1]
    for k in range(len(KEYS) - 1):
        if KEYS[k][0] <= t < KEYS[k + 1][0]:
            return mixp(KEYS[k][1], KEYS[k + 1][1], ease((t - KEYS[k][0]) / (KEYS[k + 1][0] - KEYS[k][0])))

POT_C = Vector((-0.6, -0.4, 0.0))
DENTS = [(0.6, 0.38, 0.13, 0.55), (2.4, 0.33, 0.11, 0.5), (4.1, 0.45, 0.12, 0.6), (5.3, 0.3, 0.09, 0.45),
         (1.5, 0.6, 0.08, 0.4), (3.6, 0.62, 0.08, 0.4), (0.2, 0.8, 0.07, 0.5)]

me_pot = bpy.data.meshes.new("pot")
bm = bmesh.new()
verts = [bm.verts.new((0, 0, 0)) for _ in range((NP - 2) * NA + 2)]
bm.verts.ensure_lookup_table()
def vid(i, j):
    return 1 + (i - 1) * NA + (j % NA)
for j in range(NA):
    bm.faces.new((bm.verts[0], bm.verts[vid(1, j + 1)], bm.verts[vid(1, j)]))
    for i in range(1, NP - 2):
        bm.faces.new((bm.verts[vid(i, j)], bm.verts[vid(i, j + 1)], bm.verts[vid(i + 1, j + 1)], bm.verts[vid(i + 1, j)]))
    last = len(verts) - 1
    bm.faces.new((bm.verts[vid(NP - 2, j)], bm.verts[vid(NP - 2, j + 1)], bm.verts[last]))
bm.to_mesh(me_pot)
bm.free()
for p in me_pot.polygons:
    p.use_smooth = True
pot = bpy.data.objects.new("pot", me_pot)
scene.collection.objects.link(pot)
me_pot.materials.append(M_POT)
pot.location = POT_C * CM

def update_pot(prof, squash=0.0):
    co = [0.0] * (len(me_pot.vertices) * 3)
    def put(idx, x, y, z):
        co[idx * 3:idx * 3 + 3] = (x * CM, y * CM, z * CM)
    put(0, 0, 0, 0)
    put(len(me_pot.vertices) - 1, 0, 0, prof[-1][1])
    for i in range(1, NP - 1):
        r, z = prof[i]
        tr = Vector((prof[i + 1][0] - prof[i - 1][0], prof[i + 1][1] - prof[i - 1][1]))
        nrm = Vector((tr.y, -tr.x))
        if nrm.length > 1e-6:
            nrm.normalize()
        s = i / (NP - 1)
        for j in range(NA):
            a = 2 * math.pi * j / NA
            # handmade asymmetry
            rr = r * (1 + 0.035 * math.sin(a + 0.7) + 0.02 * math.sin(2 * a + 1.9) + 0.012 * math.sin(5 * a))
            d = 0.07 * noise.noise(Vector((math.cos(a) * 1.4, math.sin(a) * 1.4, s * 7.0)))
            for (da, ds, depth, rad) in DENTS:
                dang = math.atan2(math.sin(a - da), math.cos(a - da))
                d -= depth * math.exp(-((dang * max(r, 0.5)) ** 2 + ((s - ds) * 9) ** 2) / (rad ** 2))
            if r < 0.05:
                d = 0
            x = (rr + nrm.x * d) * math.cos(a)
            y = (rr + nrm.x * d) * math.sin(a)
            zz = max(0.0, z + nrm.y * d)
            put(vid(i, j), x, y, zz)
    me_pot.vertices.foreach_set("co", co)
    me_pot.update()

# ---------------- metaball helpers ----------------
def metaball(name, mat, res=0.0011):
    # Blender clamps metaball resolution to >= 5 mm, so build at 10x and scale the object down
    mb = bpy.data.metaballs.new(name)
    mb.resolution = max(0.005, res * MBS * 0.6)
    mb.render_resolution = max(0.005, res * MBS * 0.45)
    mb.threshold = 0.6
    o = bpy.data.objects.new(name, mb)
    o.scale = (1 / MBS, 1 / MBS, 1 / MBS)
    scene.collection.objects.link(o)
    mb.materials.append(mat)
    return o, mb

RS = 1.74
MBS = 10.0

def VM(x, y, z):
    return V(x, y, z) * MBS

def mb_el(mb, typ='BALL', r=1.0, size=(1, 1, 1)):
    e = mb.elements.new()
    e.type = typ
    e.radius = r * RS * CM * MBS  # field radius -> visible radius at threshold 0.6
    if typ == 'ELLIPSOID':
        e.size_x, e.size_y, e.size_z = size
    return e

# ---------------- cat ----------------
cat_obj, cat_mb = metaball("catMB", M_CAT_MB)
cream_obj, cream_mb = metaball("creamMB", M_CREAM_MB)
el = {}
el['haunch'] = mb_el(cat_mb, 'ELLIPSOID', 2.3, (1.15, 1.0, 0.75))
el['haunch2'] = mb_el(cat_mb, 'BALL', 1.5)          # lopsided extra lump
el['chest'] = mb_el(cat_mb, 'ELLIPSOID', 1.9, (0.95, 0.85, 1.15))
el['neck'] = mb_el(cat_mb, 'BALL', 1.35)
el['head'] = mb_el(cat_mb, 'ELLIPSOID', 2.0, (1.08, 0.95, 0.92))
el['cheekL'] = mb_el(cat_mb, 'BALL', 0.95)
el['cheekR'] = mb_el(cat_mb, 'BALL', 1.0)
el['hindL'] = mb_el(cat_mb, 'ELLIPSOID', 1.0, (1.0, 1.25, 0.6))
el['hindR'] = mb_el(cat_mb, 'ELLIPSOID', 1.0, (1.0, 1.25, 0.6))
for sx in ('L', 'R'):
    for k in range(4):
        el[f'leg{sx}{k}'] = mb_el(cat_mb, 'BALL', 0.62 - 0.02 * k)
TAIL_N = 9
for k in range(TAIL_N):
    el[f'tail{k}'] = mb_el(cat_mb, 'BALL', 0.62 - 0.03 * k)
el['muzzle'] = mb_el(cream_mb, 'ELLIPSOID', 0.95, (1.05, 0.6, 0.7))
el['pawL'] = mb_el(cream_mb, 'ELLIPSOID', 0.68, (1.0, 1.1, 0.8))
el['pawR'] = mb_el(cream_mb, 'ELLIPSOID', 0.68, (1.0, 1.1, 0.8))
el['tailtip'] = mb_el(cream_mb, 'BALL', 0.55)

head_e = bpy.data.objects.new("head_frame", None)
scene.collection.objects.link(head_e)

def ear_mesh(name, mat, r, h, parent, loc, rot):
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=r * CM, radius2=0.12 * CM, depth=h * CM)
    o = bpy.context.active_object
    o.name = name
    sd = o.modifiers.new("sub", 'SUBSURF')
    sd.levels = sd.render_levels = 2
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    o.parent = parent
    o.location = Vector(loc) * CM
    o.rotation_euler = rot
    return o

ears = []
for sx, tilt in ((-1, 0.32), (1, -0.36)):
    piv = bpy.data.objects.new(f"earpiv{sx}", None)
    scene.collection.objects.link(piv)
    piv.parent = head_e
    piv.location = V(sx * 1.15, 0.2, 1.45)
    piv.rotation_euler = (0.12, tilt, 0)
    ear_mesh(f"ear{sx}", M_CAT, 1.0, 1.9, piv, (0, 0, 0.7), (0, 0, 0))
    ear_mesh(f"earin{sx}", M_PINK, 0.6, 1.25, piv, (0, -0.5, 0.55), (0.25, 0, 0)).scale = (1, 0.35, 1)
    ears.append(piv)

def ball_mesh(name, mat, r, parent, loc, scale=(1, 1, 1), rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=r * CM)
    o = bpy.context.active_object
    o.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(mat)
    o.parent = parent
    o.location = Vector(loc) * CM
    o.scale = scale
    o.rotation_euler = rot
    return o

eyes = []
for sx, sc in ((-1, 1.0), (1, 0.93)):
    e = ball_mesh(f"eye{sx}", M_WHITE, 0.62, head_e, (sx * 0.76, -1.9, 0.38), (1.0 * sc, 0.45, 1.12 * sc), (0.15, 0, sx * -0.25))
    ball_mesh(f"pupil{sx}", M_BLACK, 0.34, e, (0.02 * sx, -0.45, 0.04), (1, 0.6, 1.05))
    eyes.append(e)
ball_mesh("nose", M_PINK, 0.27, head_e, (0.04, -2.33, -0.3), (1.25, 0.8, 0.9))
# mouth: two little rolled-clay strokes
for sx in (-1, 1):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.28 * CM, minor_radius=0.05 * CM, major_segments=24, minor_segments=8)
    mo = bpy.context.active_object
    mo.data.materials.append(M_BLACK)
    for p in mo.data.polygons:
        p.use_smooth = True
    mo.parent = head_e
    mo.location = V(sx * 0.26, -2.3, -0.7)
    mo.rotation_euler = (math.radians(90), 0, 0)
    mo.scale = (1, 1, 1)
# whisker dots
for sx in (-1, 1):
    for k in range(3):
        ball_mesh(f"wdot{sx}{k}", M_CAT, 0.08, head_e, (sx * (0.5 + 0.14 * k), -2.18 + 0.06 * k, -0.48 + 0.14 * (k % 2)))

# ---------------- sprout ----------------
sprout = bpy.data.objects.new("sprout_root", None)
scene.collection.objects.link(sprout)
st_obj, st_mb = metaball("stemMB", M_GREEN_MB, res=0.0008)
st_obj.parent = sprout
STEM = []
for k in range(14):
    e = mb_el(st_mb, 'BALL', 0.34 - 0.006 * k)
    u = k / 13
    e.co = VM(0.25 * math.sin(u * 2.2), 0, u * 4.2)
    STEM.append(e)
leafp = bpy.data.objects.new("leaf_pivot", None)
scene.collection.objects.link(leafp)
leafp.parent = sprout
leafp.location = V(0.2, 0, 4.1)
leaves = []
for sx in (-1, 1):
    lp = bpy.data.objects.new(f"leafp{sx}", None)
    scene.collection.objects.link(lp)
    lp.parent = leafp
    lp.rotation_euler = (0, sx * -0.95, 0)
    ball_mesh(f"leaf{sx}", M_GREEN, 1.0, lp, (0, 0, 1.0), (0.62, 0.17, 1.15), (0, 0, 0.0))
    leaves.append(lp)

# ---------------- set dressing (out of focus) ----------------
def prop_can():
    o, mb = metaball("canMB", M_BLUE, res=0.0018)
    o.location = V(-11.5, 17.0, 0)
    e = mb_el(mb, 'ELLIPSOID', 3.4, (1.0, 1.0, 0.82))
    e.co = VM(0, 0, 2.6)
    for k in range(5):
        s = mb_el(mb, 'BALL', 0.85)
        s.co = VM(3.0 + k * 1.1, 0, 3.2 + k * 0.85)
    for k in range(7):
        a = math.pi * k / 6
        h = mb_el(mb, 'BALL', 0.75)
        h.co = VM(-3.4 - 1.6 * math.sin(a), 0, 3.0 + 2.2 * math.cos(a) + 1.4)
prop_can()
mo, mmb = metaball("mushMB", M_RED, res=0.0016)
mo.location = V(10.5, 13.0, 0)
c = mb_el(mmb, 'ELLIPSOID', 2.6, (1, 1, 0.5))
c.co = VM(0, 0, 3.4)
so, smb = metaball("stalkMB", M_CREAM_MB, res=0.0016)
so.location = V(10.5, 13.0, 0)
for k in range(4):
    s = mb_el(smb, 'BALL', 1.15 - 0.08 * k)
    s.co = VM(0, 0, 0.8 + 0.7 * k)
for k, (dx, dy) in enumerate([(-1.1, -1.4), (0.8, -1.6), (1.6, -0.5)]):
    ball_mesh(f"spot{k}", M_CREAM, 0.42, None, (10.5 + dx * 0.8, 13.0 + dy * 0.8, 3.95), (1, 1, 0.45))
crumbs = []
for k, (x, y, r) in enumerate([(-3.4, -1.6, 0.22), (-2.9, -2.6, 0.15), (1.9, -1.9, 0.18), (-1.6, 1.9, 0.12)]):
    crumbs.append(ball_mesh(f"crumb{k}", M_POT, r, None, (x, y, r * 0.7), (1, 1.2, 0.75)))
tool = ball_mesh("tool", clay("wood", "#c08b52"), 0.28, None, (-5.4, -3.0, 0.25), (1, 13, 1), (0, 0, 0.5))

# ---------------- camera & lights ----------------
cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.lens = 40
cam_d.clip_start = 0.01
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = 11.0
cam_d.dof.aperture_blades = 7
focus = bpy.data.objects.new("focus", None)
scene.collection.objects.link(focus)
cam_d.dof.focus_object = focus
aim = bpy.data.objects.new("aim", None)
scene.collection.objects.link(aim)
tr = cam.constraints.new("TRACK_TO")
tr.target = aim
tr.track_axis = 'TRACK_NEGATIVE_Z'
tr.up_axis = 'UP_Y'

def area(name, loc, size, power, col, target=(0, 0, 0.03)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.size = size
    ld.energy = power
    ld.color = col
    o = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(o)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ld

key = area("key", (-0.3, -0.12, 0.55), 0.55, 26.0, (1.0, 0.96, 0.9), target=(0.0, 0.01, 0.04))
fill = area("fill", (0.4, -0.3, 0.12), 0.5, 7.0, (1.0, 0.97, 0.92), target=(0.0, 0.03, 0.05))
rim = area("rim", (0.15, 0.3, 0.35), 0.3, 10.0, (1.0, 1.0, 1.0))
world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.78, 0.35, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.2

r = scene.render
r.engine = 'BLENDER_EEVEE'
r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, PCT
r.fps = FPS
r.image_settings.file_format = 'PNG'
ee = scene.eevee
ee.taa_render_samples = 32
ee.use_raytracing = True
ee.use_shadows = True
ee.use_fast_gi = True
ee.use_bokeh_jittered = True  # post-process DOF leaves bright halos on silhouettes
ee.bokeh_overblur = 0.0
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = -1.3

# ---------------- animation (poses step at 12 fps) ----------------
def q12(t):
    return math.floor(t * 12 + 1e-6) / 12

def vl(a, b, u):
    return Vector(a).lerp(Vector(b), u)

CAT0 = Vector((1.15, 3.5, 0.0))

def top_z(prof):
    return max(p[1] for p in prof)

def max_r(prof):
    return max(p[0] for p in prof)

def sprout_state(t, cat_root, pawR_world):
    """sprout root world position (cm) and tilt."""
    rest = Vector((4.3, -0.2, 0.3))
    grip = Vector((0, 0, 0.0))
    if t < 4.55:
        return rest, (0, math.radians(84), math.radians(-25)), False
    inserted = POT_C + Vector((0.05, 0.0, 0.62))
    if t < 5.3:
        return pawR_world + Vector((0.0, -0.1, -0.9)), None, True
    return inserted, (0, 0, 0), False

def paw_targets(t, prof, root):
    """world positions of left/right forepaws (cm)."""
    restL = root + Vector((-1.05, -2.55, 0.55))
    restR = root + Vector((1.05, -2.55, 0.55))
    top = top_z(prof)
    c = POT_C
    if t < 0.6:
        return restL, restR
    if t < 1.0:
        u = ease((t - 0.6) / 0.4)
        return vl(restL, c + Vector((-0.6, 0.1, top + 1.6)), u), vl(restR, c + Vector((0.6, 0.1, top + 1.7)), u)
    if t < 2.0:
        # two press pushes; paws ride the top surface, lifting between pushes
        lift = 0.9 * math.exp(-((t - 1.48) / 0.08) ** 2)
        return c + Vector((-0.6, 0.1, top + 0.5 + lift)), c + Vector((0.6, 0.1, top + 0.5 + lift))
    if t < 2.4:
        u = ease((t - 2.0) / 0.4)
        R = max_r(prof)
        a = c + Vector((-0.6, 0.1, top + 0.5))
        b = c + Vector((0.6, 0.1, top + 0.5))
        return vl(a, c + Vector((-R - 0.55, 0.3, 0.9)), u), vl(b, c + Vector((R + 0.55, 0.3, 0.9)), u)
    if t < 3.1:
        # squeezing and pulling the clay up
        R = max(p[0] for p in prof[int(NP * 0.2):int(NP * 0.6)])
        h = lerp(0.9, 3.0, ease((t - 2.4) / 0.7))
        return c + Vector((-R - 0.55, 0.3, h)), c + Vector((R + 0.55, 0.3, h))
    if t < 3.9:
        # left paw steadies the side, right paw presses into the top to open the pot
        R = max(p[0] for p in prof[int(NP * 0.2):int(NP * 0.6)])
        inner = prof[-1][1]
        u = ease((t - 3.1) / 0.8)
        pr = c + Vector((0.0, 0.0, lerp(top + 0.6, inner + 0.7, u)))
        if t < 3.25:
            pr = vl(c + Vector((R + 0.55, 0.3, 3.0)), c + Vector((0, 0, top + 0.6)), ease((t - 3.1) / 0.15))
        return c + Vector((-R - 0.5, 0.3, 2.4)), pr
    if t < 4.2:
        u = ease((t - 3.9) / 0.3)
        inner = prof[-1][1]
        return vl(c + Vector((-2.9, 0.3, 2.4)), restL, u), vl(c + Vector((0, 0, inner + 0.7)), c + Vector((0.6, 0.2, 6.2)), u)
    if t < 4.55:
        u = ease((t - 4.2) / 0.35)
        return restL, vl(c + Vector((0.6, 0.2, 6.2)), Vector((4.25, -0.15, 0.95)), u)
    if t < 5.3:
        # carry sprout: up and over, then down into the pot
        u = (t - 4.55) / 0.75
        a = Vector((4.25, -0.15, 0.95))
        above = POT_C + Vector((0.05, 0.1, 6.6))
        down = POT_C + Vector((0.05, 0.1, 1.55 + 0.9))
        if u < 0.65:
            k = ease(u / 0.65)
            p = vl(a, above, k)
            p.z += 2.0 * math.sin(math.pi * k)
        else:
            p = vl(above, down, ease((u - 0.65) / 0.35))
        return restL, p
    if t < 6.0:
        u = ease((t - 5.3) / 0.7)
        return restL, vl(POT_C + Vector((0.05, 0.1, 2.45)), restR, u)
    return restL, restR

def cat_root(t):
    lean = Vector((0, 0, 0))
    if 4.2 <= t < 5.3:
        lean = Vector((0.7, -0.2, 0)) * math.sin(math.pi * min(1, (t - 4.2) / 1.1))
    back = ease((t - 5.3) / 0.7) * 1.0
    hop = 0.35 * math.sin(math.pi * max(0, min(1, (t - 5.3) / 0.7)))
    return CAT0 + lean + Vector((0.95 * ease((t - 5.3) / 0.7), back, hop))

def set_el(name, p):
    el[name].co = p * CM * MBS

def apply(frame):
    t_real = (frame - 1) / FPS
    t = q12(t_real)
    pose_id = int(t * 12)
    jit = random.Random(pose_id * 7 + 3)
    j = lambda s=0.03: Vector((jit.uniform(-s, s), jit.uniform(-s, s), jit.uniform(-s * 0.5, s * 0.5)))
    prof = shape_at(t)
    update_pot(prof)
    pot.location = (POT_C + j(0.015)) * CM
    root = cat_root(t) + j(0.02)
    pawL, pawR = paw_targets(t, prof, cat_root(t))
    breathe = 1 + 0.025 * math.sin(t * 2 * math.pi * 0.7)
    # body
    set_el('haunch', root + Vector((0, 0.85, 1.7)))
    set_el('haunch2', root + Vector((0.6, 1.1, 1.35)))
    set_el('chest', root + Vector((0, 0.05, 3.35)))
    el['chest'].size_z = 1.15 * breathe
    set_el('hindL', root + Vector((-1.45, -1.0, 0.45)))
    set_el('hindR', root + Vector((1.5, -0.9, 0.45)))
    # head looks at the work
    if t < 4.2:
        look = POT_C + Vector((0, 0, 2.0))
    elif t < 5.3:
        look = pawR
    elif t < 6.4:
        look = POT_C + Vector((0.0, 0.0, 4.6))
    else:
        look = Vector((0.5, -30.0, 4.0))  # glance to camera
    hc = root + Vector((0.0, -0.35, 6.05))
    d = (look - hc)
    yaw = max(-0.5, min(0.5, math.atan2(d.x, -d.y)))
    pitch = max(-0.45, min(0.25, math.atan2(d.z, Vector((d.x, d.y)).length)))
    tilt = 0.12 + (0.14 * ease((t - 6.6) / 0.4) if t > 6.6 else 0)
    hm = Matrix.Translation(hc * CM) @ Euler((pitch * 0.8, tilt, yaw), 'YXZ').to_matrix().to_4x4()
    head_e.matrix_world = hm
    def H(x, y, z):
        return Vector((hm @ (Vector((x, y, z)) * CM))) / CM
    set_el('head', H(0, 0, 0.1))
    set_el('neck', root + Vector((0, -0.15, 4.75)))
    set_el('cheekL', H(-0.95, -0.85, -0.45))
    set_el('cheekR', H(1.0, -0.8, -0.5))
    set_el('muzzle', H(0.03, -1.72, -0.52))
    # forelegs: chain from shoulder to paw with slight outward elbow
    for sx, paw, nm in ((-1, pawL, 'L'), (1, pawR, 'R')):
        sh = root + Vector((sx * 0.95, -0.75, 4.1))
        for k in range(4):
            u = (k + 0.5) / 4.6
            p = sh.lerp(paw, u) + Vector((sx * 0.35 * math.sin(math.pi * u), 0, 0))
            set_el(f'leg{nm}{k}', p)
        set_el('paw' + nm, paw)
    # tail: lies around the haunch, tip swishes
    sw = 0.0
    if t > 5.9:
        sw = 0.55 * math.sin((t - 5.9) * 2 * math.pi * 0.55)
    elif t < 1.0:
        sw = 0.25 * math.sin(t * 2 * math.pi * 0.9)
    for k in range(TAIL_N):
        u = k / (TAIL_N - 1)
        a = lerp(1.2, -0.9 - sw * u, u)
        rad = 2.55 + 0.25 * u
        p = root + Vector((0.4 + rad * math.cos(a), 0.9 + rad * math.sin(a) * 1.05, 0.55 + 0.25 * u + 0.6 * u * abs(sw)))
        set_el(f'tail{k}', p)
        if k == TAIL_N - 1:
            set_el('tailtip', p + Vector((0.0, -0.25, 0.08)))
    # ears twitch
    tw0 = 0.5 * math.exp(-((t - 6.55) / 0.09) ** 2) + 0.35 * math.exp(-((t - 7.45) / 0.09) ** 2)
    tw1 = 0.4 * math.exp(-((t - 2.45) / 0.1) ** 2) + 0.45 * math.exp(-((t - 7.0) / 0.09) ** 2)
    ears[0].rotation_euler = (0.12 - tw0, 0.32, -tw0 * 0.4)
    ears[1].rotation_euler = (0.12 - tw1, -0.36, tw1 * 0.4)
    # blink
    bl = 1.0 - 0.85 * math.exp(-((t - 6.95) / 0.06) ** 2) - 0.85 * math.exp(-((t - 0.75) / 0.06) ** 2)
    for e, sc in zip(eyes, (1.0, 0.93)):
        e.scale = (1.0 * sc, 0.45, 1.12 * sc * max(0.12, bl))
    # sprout
    sp, rot, carried = sprout_state(t, root, pawR)
    sprout.location = sp * CM
    if rot is not None:
        sprout.rotation_euler = rot
    else:
        k = ease((t - 4.55) / 0.5)
        sprout.rotation_euler = (0, lerp(math.radians(84), 0, k), lerp(math.radians(-25), 0, k))
    # leaves: settle wobble after insertion + gentle breeze, on 12 fps
    wob = 0.0
    if t >= 5.3:
        wob = 0.35 * math.exp(-(t - 5.3) * 1.3) * math.sin((t - 5.3) * 2 * math.pi * 1.8) + 0.06 * math.sin(t * 2 * math.pi * 0.6)
    elif carried:
        wob = 0.18 * math.sin(t * 2 * math.pi * 2.2)
    leaves[0].rotation_euler = (wob * 0.6, 0.95 + wob, 0)
    leaves[1].rotation_euler = (-wob * 0.5, -0.95 + wob * 0.8, 0)
    for k, e in enumerate(STEM):
        u = k / 13
        e.co = VM(0.25 * math.sin(u * 2.2) + wob * 0.35 * u * u, 0, u * 4.2)
    leafp.location = V(0.25 * math.sin(2.2) + wob * 0.35, 0, 4.1)
    # crumbs jiggle slightly (re-placed by hand each pose)
    for k, cr in enumerate(crumbs):
        cr.rotation_euler = (0, 0, pose_id * 0.03 * (k + 1) % 0.2)
    # camera on ones: locked-off with a very slow push-in
    u = t_real / 8.0
    cam.location = Vector((lerp(2.4, 1.9, u), lerp(-27.0, -25.0, ease(u)), lerp(7.6, 7.2, u))) * CM
    aim.location = Vector((0.4, 1.2, 4.1)) * CM
    focus.location = Vector((0.2, 1.2, 3.0)) * CM
    # stop-motion light flicker per pose
    key.energy = 26.0 * (1 + jit.uniform(-0.02, 0.02))
    fill.energy = 7.0 * (1 + jit.uniform(-0.03, 0.03))

for f in range(F0, F1 + 1, STEP):
    scene.frame_set(f)
    apply(f)
    r.filepath = os.path.join(OUT, f"{f:04d}.png")
    bpy.ops.render.render(write_still=True)
    print("FRAME", f, flush=True)
