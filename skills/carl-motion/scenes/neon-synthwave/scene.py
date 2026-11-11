# S08 霓虹复古 Synthwave · B「NEON TAPE」(v2: 前冲行驶版)
# Blender 5.2 EEVEE。相机沿网格持续前冲（世界静止，透视/视差/运动模糊均真实）；
# 所有动画先按 t=(帧-1)/30 解析计算并逐帧打关键帧（线性插值），再渲染，保证 EEVEE 运动模糊可用。
# 用法: blender -b -P scene.py -- <frames_dir> [--frames 1,61] [--pct 100] [--samples 40]
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else "/tmp/s08"


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


FRAMES = [int(x) for x in opt("--frames", "").split(",") if x] or list(range(1, 241))
PCT = int(opt("--pct", "100"))
SAMPLES = int(opt("--samples", "48"))
os.makedirs(OUT, exist_ok=True)

FPS = 30
TITLE_FONT = "/System/Library/Fonts/Supplemental/Arial Black.ttf"

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, PCT
sc.render.fps = FPS
sc.eevee.taa_render_samples = SAMPLES
sc.eevee.use_raytracing = False
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.eevee.motion_blur_steps = 8
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def ease_out_back(x, s=1.70158):
    x = max(0.0, min(1.0, x)) - 1
    return 1 + x * x * ((s + 1) * x + s)


def lerp(a, b, u):
    return a + (b - a) * u


def hexc(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, a)


# ---------- 关键帧登记 ----------
KEYED = []  # (datablock, data_path)


def track(db, path):
    KEYED.append((db, path))


def mat_principled(name, color, rough=0.4, metal=0.0, emit=None, emit_str=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexc(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = hexc(emit)
        b.inputs["Emission Strength"].default_value = emit_str
    return m


def mat_emit(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = hexc(color)
    e.inputs["Strength"].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def link(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    return obj


def mesh_box(name, size):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    return me


def add_box(name, size, loc, mat=None, bevel=0.0, segs=3, parent=None):
    ob = bpy.data.objects.new(name, mesh_box(name, size))
    ob.location = loc
    sc.collection.objects.link(ob)
    if bevel:
        md = ob.modifiers.new("bev", "BEVEL")
        md.width, md.segments, md.limit_method = bevel, segs, "ANGLE"
    if mat:
        link(ob, mat)
    if parent:
        ob.parent = parent
    return ob


def add_cyl(name, r, depth, loc, rot=(0, 0, 0), mat=None, verts=48, r2=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    ob.location, ob.rotation_euler = loc, rot
    sc.collection.objects.link(ob)
    if mat:
        link(ob, mat)
    if parent:
        ob.parent = parent
    return ob


def add_torus(name, R, r, loc, rot=(math.pi / 2, 0, 0), mat=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    seg, ring = 96, 16
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        row = []
        for j in range(ring):
            b = 2 * math.pi * j / ring
            row.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        verts.append(row)
    for i in range(seg):
        for j in range(ring):
            f = bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % ring], verts[i][(j + 1) % ring]))
            f.smooth = True
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location, ob.rotation_euler = loc, rot
    sc.collection.objects.link(ob)
    if mat:
        link(ob, mat)
    if parent:
        ob.parent = parent
    return ob


def add_tube(name, pts, radius, mat, parent=None):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth, cu.bevel_resolution = radius, 4
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (*c, 1)
    ob = bpy.data.objects.new(name, cu)
    sc.collection.objects.link(ob)
    cu.materials.append(mat)
    if parent:
        ob.parent = parent
    return ob


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    sc.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


# ---------- 行驶参数 ----------
SPEED = 30.0          # 世界单位/秒，相机沿 +Y 前冲
PATH_A, PATH_L = 1.5, 120.0   # 轻微 S 形路线（产生转弯与倾侧）


def path_x(y):
    return PATH_A * math.sin(2 * math.pi * y / PATH_L)


def path_dx(y):
    return PATH_A * 2 * math.pi / PATH_L * math.cos(2 * math.pi * y / PATH_L)


def path_ddx(y):
    return -PATH_A * (2 * math.pi / PATH_L) ** 2 * math.sin(2 * math.pi * y / PATH_L)


Y_END = SPEED * 8.2 + 200

# ---------- 世界：深紫夜空 + 星点（方向函数，位于无穷远） ----------
world = bpy.data.worlds.new("sky")
sc.world = world
world.use_nodes = True
wn = world.node_tree
wn.nodes.clear()
tc = wn.nodes.new("ShaderNodeTexCoord")
sep = wn.nodes.new("ShaderNodeSeparateXYZ")
wn.links.new(tc.outputs["Generated"], sep.inputs[0])
ramp = wn.nodes.new("ShaderNodeValToRGB")
cr = ramp.color_ramp
cr.elements[0].position, cr.elements[0].color = 0.0, hexc("#ff3fa8")
cr.elements[1].position, cr.elements[1].color = 0.42, hexc("#06021a")
for pos, col in ((0.05, "#a2208c"), (0.14, "#2c0a4c"), (0.28, "#0d0326")):
    e = cr.elements.new(pos)
    e.color = hexc(col)
mr = wn.nodes.new("ShaderNodeMapRange")
mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = -0.02, 1.0
wn.links.new(sep.outputs["Z"], mr.inputs["Value"])
wn.links.new(mr.outputs[0], ramp.inputs[0])
vor = wn.nodes.new("ShaderNodeTexVoronoi")
vor.inputs["Scale"].default_value = 260
wn.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
star = wn.nodes.new("ShaderNodeMapRange")
star.inputs["From Min"].default_value, star.inputs["From Max"].default_value = 0.07, 0.0
star.inputs["To Min"].default_value, star.inputs["To Max"].default_value = 0.0, 6.0
wn.links.new(vor.outputs["Distance"], star.inputs["Value"])
sel = wn.nodes.new("ShaderNodeMath"); sel.operation = "GREATER_THAN"; sel.inputs[1].default_value = 0.82
wn.links.new(vor.outputs["Color"], sel.inputs[0])
hz = wn.nodes.new("ShaderNodeMapRange")
hz.inputs["From Min"].default_value, hz.inputs["From Max"].default_value = 0.06, 0.2
wn.links.new(sep.outputs["Z"], hz.inputs["Value"])
m1 = wn.nodes.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
m2 = wn.nodes.new("ShaderNodeMath"); m2.operation = "MULTIPLY"
wn.links.new(star.outputs[0], m1.inputs[0]); wn.links.new(sel.outputs[0], m1.inputs[1])
wn.links.new(m1.outputs[0], m2.inputs[0]); wn.links.new(hz.outputs[0], m2.inputs[1])
add = wn.nodes.new("ShaderNodeMix"); add.data_type = "RGBA"; add.blend_type = "ADD"
add.inputs["Factor"].default_value = 1.0
wn.links.new(ramp.outputs[0], add.inputs[6])
comb = wn.nodes.new("ShaderNodeCombineXYZ")
for k in "XYZ":
    wn.links.new(m2.outputs[0], comb.inputs[k])
wn.links.new(comb.outputs[0], add.inputs[7])
bg = wn.nodes.new("ShaderNodeBackground")
wn.links.new(add.outputs[2], bg.inputs[0])
wo = wn.nodes.new("ShaderNodeOutputWorld")
wn.links.new(bg.outputs[0], wo.inputs[0])

# ---------- 霓虹网格地面（世界坐标网格，静止；相机驶过） ----------
GRID_SP = 3.0
floor_m = bpy.data.materials.new("grid")
floor_m.use_nodes = True
nt = floor_m.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = hexc("#07020f")
bsdf.inputs["Roughness"].default_value = 0.3
bsdf.inputs["Specular IOR Level"].default_value = 0.08
geo = nt.nodes.new("ShaderNodeNewGeometry")
sxyz = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(geo.outputs["Position"], sxyz.inputs[0])


def line_mask(src, width):
    a = nt.nodes.new("ShaderNodeMath"); a.operation = "DIVIDE"; a.inputs[1].default_value = GRID_SP
    nt.links.new(src, a.inputs[0])
    b = nt.nodes.new("ShaderNodeMath"); b.operation = "PINGPONG"; b.inputs[1].default_value = 0.5
    nt.links.new(a.outputs[0], b.inputs[0])
    c = nt.nodes.new("ShaderNodeMapRange")
    c.inputs["From Min"].default_value, c.inputs["From Max"].default_value = width, width * 0.25
    nt.links.new(b.outputs[0], c.inputs["Value"])
    return c.outputs[0]


mx = line_mask(sxyz.outputs["X"], 0.012)
my = line_mask(sxyz.outputs["Y"], 0.012)
mm = nt.nodes.new("ShaderNodeMath"); mm.operation = "MAXIMUM"
nt.links.new(mx, mm.inputs[0]); nt.links.new(my, mm.inputs[1])
camd = nt.nodes.new("ShaderNodeCameraData")
fade = nt.nodes.new("ShaderNodeMapRange")
fade.inputs["From Min"].default_value, fade.inputs["From Max"].default_value = 150, 20
fade.inputs["To Min"].default_value, fade.inputs["To Max"].default_value = 0.0, 1.0
nt.links.new(camd.outputs["View Distance"], fade.inputs["Value"])
ms = nt.nodes.new("ShaderNodeMath"); ms.operation = "MULTIPLY"
nt.links.new(mm.outputs[0], ms.inputs[0]); nt.links.new(fade.outputs[0], ms.inputs[1])
gs = nt.nodes.new("ShaderNodeMath"); gs.operation = "MULTIPLY"; gs.inputs[1].default_value = 6.0
nt.links.new(ms.outputs[0], gs.inputs[0])
bsdf.inputs["Emission Color"].default_value = hexc("#ff2fd6")
nt.links.new(gs.outputs[0], bsdf.inputs["Emission Strength"])
me = bpy.data.meshes.new("floor")
me.from_pydata([(-300, -40, 0), (300, -40, 0), (300, Y_END + 200, 0), (-300, Y_END + 200, 0)], [], [(0, 1, 2, 3)])
floor = bpy.data.objects.new("floor", me)
sc.collection.objects.link(floor)
link(floor, floor_m)

# 随相机的远景层（地平线辉光、落日、线框山）——都在 FAR 空物体下，按相机 Y 平移
FAR = empty("far")
SUNROOT = empty("sunroot")
hl = add_box("horizon", (600, 0.4, 0.25), (0, 149.5, 0.12), mat_emit("hz", "#ff4fd8", 6), parent=FAR)

# ---------- 分段落日 ----------
sun_m = bpy.data.materials.new("sun")
sun_m.use_nodes = True
sun_m.surface_render_method = "BLENDED"
nt = sun_m.node_tree
nt.nodes.clear()
tc2 = nt.nodes.new("ShaderNodeTexCoord")
sp2 = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(tc2.outputs["Generated"], sp2.inputs[0])
rp = nt.nodes.new("ShaderNodeValToRGB")
rp.color_ramp.elements[0].position, rp.color_ramp.elements[0].color = 0.0, hexc("#ff1f8e")
rp.color_ramp.elements[1].position, rp.color_ramp.elements[1].color = 1.0, hexc("#ffe45c")
el = rp.color_ramp.elements.new(0.45); el.color = hexc("#ff7a2e")
nt.links.new(sp2.outputs["Y"], rp.inputs[0])
phase = nt.nodes.new("ShaderNodeValue"); phase.name = "phase"
yk = nt.nodes.new("ShaderNodeMath"); yk.operation = "MULTIPLY"; yk.inputs[1].default_value = 11.0
nt.links.new(sp2.outputs["Y"], yk.inputs[0])
yp = nt.nodes.new("ShaderNodeMath"); yp.operation = "ADD"
nt.links.new(yk.outputs[0], yp.inputs[0]); nt.links.new(phase.outputs[0], yp.inputs[1])
fr = nt.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
nt.links.new(yp.outputs[0], fr.inputs[0])
gw = nt.nodes.new("ShaderNodeMapRange")
gw.inputs["From Min"].default_value, gw.inputs["From Max"].default_value = 0.0, 0.8
gw.inputs["To Min"].default_value, gw.inputs["To Max"].default_value = 0.42, 0.0
nt.links.new(sp2.outputs["Y"], gw.inputs["Value"])
gap = nt.nodes.new("ShaderNodeMath"); gap.operation = "GREATER_THAN"
nt.links.new(gw.outputs[0], gap.inputs[1]); nt.links.new(fr.outputs[0], gap.inputs[0])
sun_glow = nt.nodes.new("ShaderNodeValue"); sun_glow.name = "glow"
em = nt.nodes.new("ShaderNodeEmission")
nt.links.new(rp.outputs[0], em.inputs["Color"])
nt.links.new(sun_glow.outputs[0], em.inputs["Strength"])
tr = nt.nodes.new("ShaderNodeBsdfTransparent")
mix = nt.nodes.new("ShaderNodeMixShader")
nt.links.new(gap.outputs[0], mix.inputs[0])
nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
o = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(mix.outputs[0], o.inputs[0])
SUN_PHASE, SUN_GLOW = phase.outputs[0], sun_glow.outputs[0]
track(SUN_PHASE, "default_value")
track(SUN_GLOW, "default_value")
me = bpy.data.meshes.new("sun")
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=128, radius=1.0)
bm.to_mesh(me); bm.free()
sun = bpy.data.objects.new("sun", me)
sc.collection.objects.link(sun)
link(sun, sun_m)
sun.scale = (20.0, 20.0, 1)
sun.rotation_euler = (math.pi / 2, 0, 0)
sun.location = (0, 165, 32.0)
sun.parent = SUNROOT

# ---------- 线框山（以 0.97 倍相机速度跟随 → 缓慢漂近） ----------
rng = random.Random(1986)
MTN = empty("mtn")
mount_solid = mat_principled("mt_solid", "#12041f", rough=0.6, emit="#3a0a55", emit_str=0.6)
mount_wire = mat_emit("mt_wire", "#36e2ff", 2.2)


def mountains(name, x0, x1, side):
    nx, ny = 26, 9
    y0, y1 = 118, 146
    verts, faces = [], []
    hs = [[0.0] * ny for _ in range(nx)]
    for i in range(nx):
        for j in range(ny):
            u, v = i / (nx - 1), j / (ny - 1)
            edge = u if side > 0 else 1 - u
            env = (0.15 + 0.85 * edge ** 0.8) * math.sin(math.pi * v) ** 0.7
            hs[i][j] = env * (5 + 9 * rng.random()) if 0 < j < ny - 1 and 0 < i < nx - 1 else 0.0
    for i in range(nx):
        for j in range(ny):
            x = lerp(x0, x1, i / (nx - 1)) + rng.uniform(-0.8, 0.8) * (0 < i < nx - 1)
            y = lerp(y0, y1, j / (ny - 1)) + rng.uniform(-0.8, 0.8) * (0 < j < ny - 1)
            verts.append((x, y, hs[i][j]))
    for i in range(nx - 1):
        for j in range(ny - 1):
            a, b, c, d = i * ny + j, (i + 1) * ny + j, (i + 1) * ny + j + 1, i * ny + j + 1
            faces += [(a, b, c), (a, c, d)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)
    link(ob, mount_solid)
    ob.parent = MTN
    w = bpy.data.objects.new(name + "_w", me.copy())
    sc.collection.objects.link(w)
    md = w.modifiers.new("wf", "WIREFRAME")
    md.thickness = 0.12
    w.data.materials.clear(); w.data.materials.append(mount_wire)
    w.location.z = 0.02
    w.parent = MTN


mountains("mtL", -150, -16, -1)
mountains("mtR", 16, 150, 1)

# ---------- 路边三层：近处霓虹立柱 / 中层路灯 / 中远层与远层棕榈剪影（全部静止于世界） ----------
neon_post_m = mat_emit("neon_post", "#2fe8ff", 7)
neon_post_m2 = mat_emit("neon_post2", "#ff2fd6", 7)
pole_m = mat_principled("pole", "#1a0a2c", rough=0.5)
bulb_m = mat_emit("bulb", "#ffd2f6", 8)
palm_m = mat_principled("palm", "#0b0214", rough=0.9, emit="#16031f", emit_str=0.4)

np_me = mesh_box("np", (0.14, 0.14, 2.8))
np_base = mesh_box("npb", (0.4, 0.4, 0.2))
for side in (-1, 1):
    for k, y in enumerate(range(-10, int(Y_END), 11)):
        ob = bpy.data.objects.new("np", np_me)
        ob.location = (side * 6.6 + path_x(y), y, 1.4)
        sc.collection.objects.link(ob)
        ob.data.materials.append(neon_post_m) if not ob.data.materials else None
        b = bpy.data.objects.new("npb", np_base)
        b.location = (side * 6.6 + path_x(y), y, 0.1)
        sc.collection.objects.link(b)
link(bpy.data.objects["np"], neon_post_m)
link(bpy.data.objects["npb"], pole_m)

pole_me = bpy.data.meshes.new("pole")
bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=0.06, radius2=0.05, depth=2.6)
bm.to_mesh(pole_me); bm.free()
bulb_me = bpy.data.meshes.new("bulb")
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=8, radius=0.2)
bm.to_mesh(bulb_me); bm.free()
pole_me.materials.append(pole_m)
bulb_me.materials.append(bulb_m)
for side in (-1, 1):
    for y in range(-6, int(Y_END), 9):
        x = side * 11.0 + path_x(y)
        p = bpy.data.objects.new("pole", pole_me); p.location = (x, y + 4, 1.3); sc.collection.objects.link(p)
        b = bpy.data.objects.new("bulb", bulb_me); b.location = (x, y + 4, 2.65); sc.collection.objects.link(b)


def palm_mesh(name, seed):
    r = random.Random(seed)
    bm = bmesh.new()
    # 弯曲树干：一串收窄的截面
    H = 7.5
    lean = r.uniform(-1.2, 1.2)
    prev = None
    rings = []
    for i in range(12):
        u = i / 11
        cx, cz = lean * u * u, H * u
        rad = lerp(0.32, 0.16, u)
        ring = [bm.verts.new((cx + rad * math.cos(2 * math.pi * k / 8), rad * math.sin(2 * math.pi * k / 8), cz)) for k in range(8)]
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(8):
            bm.faces.new((a[k], a[(k + 1) % 8], b[(k + 1) % 8], b[k]))
    top = Vector((lean, 0, H))
    # 叶片：下垂弧形，带锯齿边
    for f in range(9):
        ang = 2 * math.pi * f / 9 + r.uniform(-0.2, 0.2)
        L = r.uniform(3.4, 4.6)
        droop = r.uniform(1.6, 2.8)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-d.y, d.x, 0))
        left, right = [], []
        for s in range(10):
            u = s / 9
            p = top + d * (L * u) + Vector((0, 0, 0.9 * math.sin(math.pi * u * 0.8) - droop * u * u))
            w = 0.55 * math.sin(math.pi * min(1.0, u * 1.1)) * (1.15 if s % 2 else 0.75)
            left.append(bm.verts.new(p + side * w))
            right.append(bm.verts.new(p - side * w))
        for s in range(9):
            bm.faces.new((left[s], left[s + 1], right[s + 1], right[s]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(palm_m)
    return me


PALMS = [palm_mesh(f"palm{i}", 100 + i) for i in range(4)]
rp_ = random.Random(7)
for side in (-1, 1):
    y = -8.0
    while y < Y_END:
        x = side * rp_.uniform(17, 22) + path_x(y)
        ob = bpy.data.objects.new("palm", PALMS[rp_.randrange(4)])
        ob.location = (x, y, 0)
        ob.rotation_euler = (0, 0, rp_.uniform(0, 6.28))
        s = rp_.uniform(0.85, 1.15)
        ob.scale = (s, s, s)
        sc.collection.objects.link(ob)
        y += rp_.uniform(11, 17)
    y = 0.0
    while y < Y_END + 120:
        x = side * rp_.uniform(40, 70)
        ob = bpy.data.objects.new("palm_far", PALMS[rp_.randrange(4)])
        ob.location = (x, y, 0)
        ob.rotation_euler = (0, 0, rp_.uniform(0, 6.28))
        s = rp_.uniform(1.3, 1.7)
        ob.scale = (s, s, s)
        sc.collection.objects.link(ob)
        y += rp_.uniform(18, 28)

# ---------- 磁带播放器（无品牌，随相机前行并悬浮） ----------
DECK = empty("deck")
body_m = mat_principled("body", "#120e22", rough=0.28, metal=0.15, coat=0.6)
panel_m = mat_principled("panel", "#1b1630", rough=0.45, metal=0.3)
chrome_m = mat_principled("chrome", "#e8e4f4", rough=0.12, metal=1.0)
dark_m = mat_principled("dark", "#08060e", rough=0.6)
cone_m = mat_principled("cone", "#16121e", rough=0.75)
neon_mag = mat_emit("neon_mag", "#ff2fd6", 5)
neon_cyan = mat_emit("neon_cyan", "#2fe8ff", 4)
tape_m = mat_principled("tape", "#3b2116", rough=0.35, metal=0.2)
hub_m = mat_principled("hub", "#f4f0ff", rough=0.3, emit="#bdf6ff", emit_str=0.6)
cass_m = mat_principled("cass", "#2b2540", rough=0.4)
label_m = bpy.data.materials.new("label")
label_m.use_nodes = True
lnt = label_m.node_tree
lb = lnt.nodes["Principled BSDF"]
ltc = lnt.nodes.new("ShaderNodeTexCoord")
lsp = lnt.nodes.new("ShaderNodeSeparateXYZ")
lnt.links.new(ltc.outputs["Generated"], lsp.inputs[0])
lr = lnt.nodes.new("ShaderNodeValToRGB")
lr.color_ramp.interpolation = "CONSTANT"
cols = ["#2a1f5c", "#ff3fa0", "#ff8a3c", "#ffd45a", "#f6efe2"]
lr.color_ramp.elements[0].color = hexc(cols[0])
lr.color_ramp.elements[1].position, lr.color_ramp.elements[1].color = 0.82, hexc(cols[4])
for pos, c in zip([0.18, 0.32, 0.46], cols[1:4]):
    el = lr.color_ramp.elements.new(pos); el.color = hexc(c)
lnt.links.new(lsp.outputs["Z"], lr.inputs[0])
lnt.links.new(lr.outputs[0], lb.inputs["Base Color"])
lb.inputs["Roughness"].default_value = 0.5
lnt.links.new(lr.outputs[0], lb.inputs["Emission Color"])
lb.inputs["Emission Strength"].default_value = 0.35

W, H, D = 5.2, 2.1, 1.25
Z0 = 0.32
P = DECK
body = add_box("body", (W, D, H), (0, D / 2, Z0 + H / 2), body_m, bevel=0.09, parent=P)
hp = [(-2.0, 0.62, Z0 + H - 0.02), (-2.0, 0.62, Z0 + H + 0.45), (-1.7, 0.62, Z0 + H + 0.62),
      (1.7, 0.62, Z0 + H + 0.62), (2.0, 0.62, Z0 + H + 0.45), (2.0, 0.62, Z0 + H - 0.02)]
add_tube("handle", hp, 0.07, chrome_m, parent=P)
fz0, fz1 = Z0 + 0.06, Z0 + H - 0.06
add_tube("edge_top", [(-W / 2 + 0.08, -0.03, fz1), (W / 2 - 0.08, -0.03, fz1)], 0.028, neon_mag, parent=P)
add_tube("edge_bot", [(-W / 2 + 0.08, -0.03, fz0), (W / 2 - 0.08, -0.03, fz0)], 0.028, neon_cyan, parent=P)
# 悬浮底部辉光条（像悬浮滑板的推进灯）
add_box("hover_glow", (W - 0.6, 0.9, 0.04), (0, D / 2, Z0 - 0.02), mat_emit("hover", "#ff2fd6", 6), parent=P)
SPK = []
for sx in (-1, 1):
    cx, cz = sx * 1.78, Z0 + 1.0
    add_torus(f"spk_rim{sx}", 0.8, 0.06, (cx, -0.02, cz), mat=chrome_m, parent=P)
    add_cyl(f"spk_back{sx}", 0.8, 0.04, (cx, 0.0, cz), (math.pi / 2, 0, 0), mat=dark_m, parent=P)
    ring = add_torus(f"spk_neon{sx}", 0.9, 0.025, (cx, -0.03, cz), mat=neon_mag, parent=P)
    cone = add_cyl(f"spk_cone{sx}", 0.72, 0.3, (cx, -0.12, cz), (math.pi / 2, 0, 0), mat=cone_m, r2=0.22, parent=P)
    cap = add_cyl(f"spk_cap{sx}", 0.2, 0.08, (cx, -0.3, cz), (math.pi / 2, 0, 0), mat=chrome_m, r2=0.12, parent=P)
    inner = add_torus(f"spk_in{sx}", 0.46, 0.018, (cx, -0.2, cz), mat=neon_cyan, parent=P)
    SPK.append((cone, cap, inner))
    for ob in (cone, cap, inner):
        track(ob, "location")
    track(inner, "scale")
CX, CZ = 0.0, Z0 + 1.18
add_box("door", (1.95, 0.06, 1.12), (CX, -0.02, CZ), panel_m, bevel=0.03, parent=P)
add_box("cass", (1.72, 0.05, 0.92), (CX, -0.07, CZ), cass_m, bevel=0.04, parent=P)
add_box("label", (1.6, 0.02, 0.62), (CX, -0.105, CZ + 0.1), label_m, parent=P)
add_box("win", (1.06, 0.02, 0.36), (CX, -0.12, CZ + 0.02), dark_m, bevel=0.01, parent=P)
REELS = []
for k, sx in enumerate((-1, 1)):
    rx = CX + sx * 0.32
    pack = add_cyl(f"pack{k}", 0.17, 0.02, (rx, -0.135, CZ + 0.02), (math.pi / 2, 0, 0), mat=tape_m, parent=P)
    add_cyl(f"hub{k}", 0.115, 0.03, (rx, -0.15, CZ + 0.02), (math.pi / 2, 0, 0), mat=hub_m, verts=32, parent=P)
    add_cyl(f"hole{k}", 0.055, 0.04, (rx, -0.155, CZ + 0.02), (math.pi / 2, 0, 0), mat=dark_m, verts=24, parent=P)
    rot = empty(f"reel{k}", parent=P, loc=(rx, -0.17, CZ + 0.02))
    for s in range(6):
        a = s * math.pi / 3
        sp = add_box(f"spoke{k}{s}", (0.06, 0.03, 0.024), (0.085 * math.cos(a), 0, 0.085 * math.sin(a)), hub_m, parent=rot)
        sp.rotation_euler = (0, -a, 0)
    REELS.append((pack, rot))
    track(pack, "scale")
    track(rot, "rotation_euler")
add_tube("door_neon", [(-0.99, -0.06, CZ - 0.58), (0.99, -0.06, CZ - 0.58), (0.99, -0.06, CZ + 0.58),
                       (-0.99, -0.06, CZ + 0.58), (-0.99, -0.06, CZ - 0.58)], 0.016, neon_cyan, parent=P)
# 电平柱
vu_m = bpy.data.materials.new("vu")
vu_m.use_nodes = True
vnt = vu_m.node_tree
vnt.nodes.clear()
vtc = vnt.nodes.new("ShaderNodeTexCoord")
vs = vnt.nodes.new("ShaderNodeSeparateXYZ")
vnt.links.new(vtc.outputs["Generated"], vs.inputs[0])
vr = vnt.nodes.new("ShaderNodeValToRGB")
vr.color_ramp.elements[0].color = hexc("#2fe8ff")
vr.color_ramp.elements[1].color = hexc("#ff2fd6")
vnt.links.new(vs.outputs["Z"], vr.inputs[0])
vem = vnt.nodes.new("ShaderNodeEmission")
vem.inputs["Strength"].default_value = 3.5
vnt.links.new(vr.outputs[0], vem.inputs["Color"])
vo = vnt.nodes.new("ShaderNodeOutputMaterial")
vnt.links.new(vem.outputs[0], vo.inputs[0])
add_box("vu_bg", (1.9, 0.04, 0.3), (CX, -0.01, Z0 + 0.5), dark_m, bevel=0.02, parent=P)
VU = []
NB = 14
for i in range(NB):
    x = CX - 0.84 + i * (1.68 / (NB - 1))
    b = add_box(f"vu{i}", (0.085, 0.02, 1.0), (x, -0.04, Z0 + 0.38), vu_m, parent=P)
    VU.append(b)
    track(b, "location")
    track(b, "scale")
KEYS = []
key_m = mat_principled("key", "#cfcadb", rough=0.22, metal=0.85)
sym = [("rec", "#ff2f5a"), ("play", "#2fe8ff"), ("rew", "#ff2fd6"), ("ff", "#ff2fd6"), ("stop", "#ffd45a")]
for i, (nm, col) in enumerate(sym):
    x = -1.0 + i * 0.5
    k = add_box(f"key_{nm}", (0.44, 0.5, 0.26), (x, 0.36, Z0 + H + 0.08), key_m, bevel=0.035, parent=P)
    lm = mat_emit(f"led_{nm}", col, 1.0)
    led = add_box(f"led_{nm}", (0.3, 0.12, 0.03), (x, 0.36, Z0 + H + 0.215), lm, parent=P)
    KEYS.append((k, led, lm.node_tree.nodes["Emission"].inputs["Strength"]))
    if i == 1:
        track(k, "location"); track(led, "location"); track(lm.node_tree.nodes["Emission"].inputs["Strength"], "default_value")

# ---------- 标题 NEON TAPE（挂在相机上，保证 9:16 下大而清楚） ----------
font = bpy.data.fonts.load(TITLE_FONT)
cu = bpy.data.curves.new("title", "FONT")
cu.body = "NEON TAPE"
cu.font = font
cu.align_x, cu.align_y = "CENTER", "CENTER"
cu.extrude, cu.bevel_depth, cu.bevel_resolution = 0.16, 0.035, 2
cu.space_character = 1.04
tmp = bpy.data.objects.new("title_tmp", cu)
sc.collection.objects.link(tmp)
dg = bpy.context.evaluated_depsgraph_get()
tme = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
bpy.data.objects.remove(tmp)
title = bpy.data.objects.new("title", tme)
sc.collection.objects.link(title)
chr_m = bpy.data.materials.new("chrome_title")
chr_m.use_nodes = True
cnt = chr_m.node_tree
cb = cnt.nodes["Principled BSDF"]
ctc = cnt.nodes.new("ShaderNodeTexCoord")
csp = cnt.nodes.new("ShaderNodeSeparateXYZ")
cnt.links.new(ctc.outputs["Generated"], csp.inputs[0])
crp = cnt.nodes.new("ShaderNodeValToRGB")
ce = crp.color_ramp.elements
ce[0].position, ce[0].color = 0.0, hexc("#ff4fb8")
ce[1].position, ce[1].color = 1.0, hexc("#ffffff")
for pos, c in [(0.22, "#ffb347"), (0.47, "#ffe9b0"), (0.5, "#1b2a6e"), (0.56, "#3e7fd6"), (0.8, "#bfe8ff")]:
    el = ce.new(pos); el.color = hexc(c)
cnt.links.new(csp.outputs["Y"], crp.inputs[0])
cnt.links.new(crp.outputs[0], cb.inputs["Base Color"])
cnt.links.new(crp.outputs[0], cb.inputs["Emission Color"])
cb.inputs["Metallic"].default_value = 0.85
cb.inputs["Roughness"].default_value = 0.16
cb.inputs["Emission Strength"].default_value = 0.9
tme.materials.append(chr_m)
tme.materials.append(mat_emit("title_rim", "#ff2fd6", 3))
for p in tme.polygons:
    p.material_index = 0 if p.normal.z > 0.6 else 1
glint = add_cyl("glint", 0.11, 0.05, (0, 0, 0), (math.pi / 2, 0, 0), mat=mat_emit("glint", "#ffffff", 0.0), verts=24)
GLINT_S = glint.data.materials[0].node_tree.nodes["Emission"].inputs["Strength"]

# ---------- 相机 ----------
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 35
cam_d.dof.use_dof = True
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam.rotation_mode = "QUATERNION"
cam_d.dof.focus_object = DECK
track(cam, "location"); track(cam, "rotation_quaternion"); track(cam_d.dof, "aperture_fstop")
title.parent = cam
glint.parent = cam
TITLE_D, TITLE_UP, TITLE_S = 40.0, 5.1, 6.45
track(title, "location"); track(title, "scale"); track(title, "hide_render")
track(glint, "location"); track(glint, "hide_render"); track(GLINT_S, "default_value")
track(DECK, "location"); track(DECK, "rotation_euler")
track(FAR, "location"); track(SUNROOT, "location"); track(MTN, "location")


def area(name, loc, rot, size, power, color, parent=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.size, ld.energy, ld.color = size, power, hexc(color)[:3]
    ob = bpy.data.objects.new(name, ld)
    ob.location, ob.rotation_euler = loc, rot
    sc.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


# 灯光跟着机身走
area("key_l", (-6, -5, 6), (math.radians(55), 0, math.radians(-45)), 6, 900, "#ff5fd8", DECK)
area("key_r", (6, -5, 5), (math.radians(60), 0, math.radians(45)), 6, 700, "#4fd8ff", DECK)
area("rim", (0, 8, 6), (math.radians(-60), 0, 0), 8, 1500, "#ff8a5c", DECK)

# ---------- 合成：双层辉光 + 星芒 ----------
sc.render.use_compositing = True
ng = bpy.data.node_groups.new("comp", "CompositorNodeTree")
ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
rl = ng.nodes.new("CompositorNodeRLayers")
g1 = ng.nodes.new("CompositorNodeGlare")
g1.inputs["Type"].default_value = "Bloom"
g1.inputs["Quality"].default_value = "High"
g1.inputs["Threshold"].default_value = 0.75
g1.inputs["Strength"].default_value = 0.6
g1.inputs["Size"].default_value = 0.65
g2 = ng.nodes.new("CompositorNodeGlare")
g2.inputs["Type"].default_value = "Streaks"
g2.inputs["Quality"].default_value = "High"
g2.inputs["Threshold"].default_value = 20.0
g2.inputs["Strength"].default_value = 1.0
g2.inputs["Streaks"].default_value = 4
g2.inputs["Streaks Angle"].default_value = 0.0
g2.inputs["Fade"].default_value = 0.93
go = ng.nodes.new("NodeGroupOutput")
ng.links.new(rl.outputs["Image"], g1.inputs["Image"])
ng.links.new(g1.outputs["Image"], g2.inputs["Image"])
ng.links.new(g2.outputs["Image"], go.inputs[0])
sc.compositing_node_group = ng

# ---------- 时间线 ----------
BPM = 112
BEAT = 60 / BPM


def play_amt(t):
    return ease((t - 1.45) / 0.8)


def kick(t):
    if t < 1.6:
        return 0.0
    return math.exp(-(((t - 1.6) % BEAT) / BEAT) * 7)


def band(t, i):
    if t < 1.5:
        return 0.04
    v = 0.35 + 0.25 * math.sin(t * (3.1 + 0.37 * i) + i * 1.7) + 0.2 * math.sin(t * (7.3 + 0.61 * i) + i * 0.9)
    v += 0.45 * kick(t) * (1.0 - i / NB) + 0.15 * kick(t + BEAT / 2) * (i / NB)
    return 0.04 + play_amt(t) * max(0.05, min(1.0, v))


def key_offset(t):
    if t < 1.0:
        return 0.0
    if t < 1.15:
        return 0.025 * ease((t - 1.0) / 0.15)
    if t < 1.27:
        return lerp(0.025, -0.15, ease((t - 1.15) / 0.12))
    u = t - 1.27
    return -0.1 - 0.05 * math.exp(-u * 9) * math.cos(u * 30)


def reel_angle(t):
    w, t0, ramp = 5.5, 1.6, 0.9
    if t < t0:
        return 0.0
    if t < t0 + ramp:
        u = (t - t0) / ramp
        return w * ramp * (u * u / 2)
    return w * ramp / 2 + w * (t - t0 - ramp)


def shake(t, a, f, ph):
    return a * (math.sin(f * t + ph) + 0.6 * math.sin(1.73 * f * t + 2 * ph) + 0.35 * math.sin(2.91 * f * t + 3 * ph))


def deck_rel(t):
    # 机身在相机前方的距离与相机高度：先近距离高机位看按键，后拉开成低机位全景
    u = ease((t - 2.7) / 2.6)
    return lerp(10.2, 13.8, u)


def cam_height(t):
    return lerp(3.3, 1.15, ease((t - 2.7) / 2.6))


def state(t):
    cy = SPEED * t
    cx = path_x(cy)
    # 相机：沿路线前进 + 倾侧 + 发动机震动
    cpos = Vector((cx + shake(t, 0.018, 31, 0.3), cy, cam_height(t) + shake(t, 0.016, 43, 1.1)))
    dy = deck_rel(t)
    dyw = cy + dy
    sway = 0.28 * math.sin(2.3 * t + 0.4)
    dpos = Vector((path_x(dyw) + sway, dyw, 0.38 + 0.07 * math.sin(2 * math.pi * 1.3 * t)))
    look = Vector((dpos.x, dpos.y, lerp(1.55, 2.75, ease((t - 2.7) / 2.6))))
    d = (look - cpos).normalized()
    q = d.to_track_quat("-Z", "Y")
    lat_acc = path_ddx(cy) * SPEED * SPEED      # 横向加速度
    roll = -0.022 * lat_acc + math.radians(shake(t, 0.25, 37, 0.7))
    pitch_j = math.radians(shake(t, 0.18, 47, 2.0))
    q = Quaternion(d, roll) @ q
    q = q @ Quaternion((1, 0, 0), pitch_j)
    deck_yaw = -math.atan(path_dx(dyw))
    deck_roll = 0.6 * (-0.022 * path_ddx(dyw) * SPEED * SPEED) + 0.05 * math.sin(2.3 * t + 1.9)
    return cpos, q, dpos, (0.03 * math.sin(2.9 * t), deck_roll, deck_yaw), cy


def apply(t):
    cpos, q, dpos, drot, cy = state(t)
    cam.location = cpos
    cam.rotation_quaternion = q
    DECK.location = dpos
    DECK.rotation_euler = drot
    FAR.location = (path_x(cy), cy, 0)
    SUNROOT.location = (0, cy, 0)
    MTN.location = (0, 0.97 * cy, 0)
    cam_d.dof.aperture_fstop = lerp(4.5, 9.0, ease((t - 2.7) / 2.6))
    SUN_PHASE.default_value = -0.9 * max(0.0, t - 1.6) * play_amt(t)
    SUN_GLOW.default_value = 1.15 + 0.35 * kick(t) * play_amt(t) + (1.2 * math.exp(-max(0, t - 5.25) * 4) if t > 5.25 else 0)
    for i, (k, led, ls) in enumerate(KEYS):
        if i == 1:
            off = key_offset(t)
            k.location.z = Z0 + H + 0.08 + off
            led.location.z = Z0 + H + 0.215 + off
            ls.default_value = 1.0 + 11.0 * ease((t - 1.25) / 0.2)
    ang = reel_angle(t)
    prog = max(0.0, t - 1.6) / 6.4 * play_amt(t)
    for k, (pack, rot) in enumerate(REELS):
        r = (0.17 - 0.03 * prog) if k == 0 else (0.14 + 0.03 * prog)
        pack.scale = (r / 0.17, r / 0.17, 1)
        rot.rotation_euler = (0, -ang, 0)
    for cone, cap, inner in SPK:
        pump = 0.09 * kick(t) * play_amt(t)
        cone.location.y = -0.12 - pump
        cap.location.y = -0.3 - pump * 1.4
        inner.location.y = -0.2 - pump * 1.2
        s_ = 1 + 0.04 * kick(t) * play_amt(t)
        inner.scale = (s_, s_, s_)
    for i, b in enumerate(VU):
        h = 0.04 + 0.22 * band(t, i)
        b.scale.z = h
        b.location.z = Z0 + 0.38 + h / 2
    # 标题：相机坐标系内冲入并回弹
    if t < 4.95:
        title.hide_render = True
        title.location = (0, TITLE_UP, -95)
        title.scale = (0.01, 0.01, 0.01)
    else:
        title.hide_render = False
        u = (t - 4.95) / 0.5
        if u < 1:
            s = TITLE_S * lerp(0.08, 1.0, ease_out_back(u, 2.4))
            z = lerp(-95, -TITLE_D, ease(u))
        else:
            dd = t - 5.45
            s = TITLE_S * (1 + 0.035 * math.exp(-dd * 6) * math.sin(dd * 26))
            z = -TITLE_D
        title.location = (0, TITLE_UP, z)
        title.scale = (s, s, s)
    if 5.55 < t < 6.6:
        u = (t - 5.55) / 1.05
        glint.hide_render = False
        glint.location = (lerp(-16.0, 15.4, ease(u)), TITLE_UP + 3.1 - 0.94 * u, -TITLE_D + 1.0)
        GLINT_S.default_value = 260 * math.sin(math.pi * u) ** 0.6
    else:
        glint.hide_render = True
        GLINT_S.default_value = 0.0


# 逐帧打关键帧（含 0 与 241 帧，供运动模糊取样）
for f in range(0, 242):
    apply((f - 1) / FPS)
    for db, path in KEYED:
        db.keyframe_insert(path, frame=f)


def linearize(idb):
    ad = getattr(idb, "animation_data", None)
    if not ad or not ad.action:
        return
    act = ad.action
    curves = []
    if hasattr(act, "fcurves"):
        curves = list(act.fcurves)
    else:
        for layer in act.layers:
            for strip in layer.strips:
                for cb_ in strip.channelbags:
                    curves += list(cb_.fcurves)
    for fc in curves:
        for kp in fc.keyframe_points:
            if kp.interpolation != "CONSTANT" or not fc.data_path.endswith("hide_render"):
                kp.interpolation = "LINEAR" if not fc.data_path.endswith("hide_render") else "CONSTANT"


for coll in (bpy.data.objects, bpy.data.materials, bpy.data.cameras, bpy.data.node_groups):
    for idb in coll:
        linearize(idb)
        if hasattr(idb, "node_tree") and idb.node_tree:
            linearize(idb.node_tree)

for f in FRAMES:
    sc.frame_set(f)
    sc.render.filepath = os.path.join(OUT, f"{f:04d}.png")
    bpy.ops.render.render(write_still=True)
    print("FRAME", f, flush=True)
print("DONE")
