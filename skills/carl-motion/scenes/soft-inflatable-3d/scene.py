# S34 软体充气3D · B「GO」(v2: 真实重力落体 + 快速衰减回弹 + 互补色)
# Blender 5.2 EEVEE。字母竖直运动由一维接触物理（重力 + 单侧弹簧阻尼）数值积分得到；
# 压扁/余振由二阶弹簧跟随；托盘形变 = 接触中心位移按距离延迟传播（numpy 逐帧写网格）。
# 字母/相机/接触阴影参数逐帧打关键帧（线性），EEVEE 运动模糊可用。
# 用法: blender -b -P scene.py -- <frames_dir> [--frames 1,61] [--pct 100] [--samples 48]
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0]) if argv else "/tmp/s34"


def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


FRAMES = [int(x) for x in opt("--frames", "").split(",") if x] or list(range(1, 241))
PCT = int(opt("--pct", "100"))
SAMPLES = int(opt("--samples", "48"))
os.makedirs(OUT, exist_ok=True)
FPS = 30
FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, PCT
sc.render.fps = FPS
sc.eevee.taa_render_samples = SAMPLES
sc.eevee.use_raytracing = True
sc.eevee.use_shadows = True
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
sc.eevee.motion_blur_steps = 8
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"


def hexc(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, a)


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


KEYED = []


def track(db, path):
    KEYED.append((db, path))


# ---------- 世界与背景（淡奶油黄） ----------
world = bpy.data.worlds.new("w")
sc.world = world
world.use_nodes = True
bgn = world.node_tree.nodes["Background"]
bgn.inputs["Color"].default_value = hexc("#fff3c6")
bgn.inputs["Strength"].default_value = 0.55

cyc_m = bpy.data.materials.new("cyc")
cyc_m.use_nodes = True
cn = cyc_m.node_tree
cb = cn.nodes["Principled BSDF"]
ctc = cn.nodes.new("ShaderNodeTexCoord")
csp = cn.nodes.new("ShaderNodeSeparateXYZ")
cn.links.new(ctc.outputs["Generated"], csp.inputs[0])
cr = cn.nodes.new("ShaderNodeValToRGB")
cr.color_ramp.elements[0].color = hexc("#f8dc84")
cr.color_ramp.elements[1].color = hexc("#fff1bd")
el = cr.color_ramp.elements.new(0.45)
el.color = hexc("#ffeaa8")
cn.links.new(csp.outputs["Y"], cr.inputs[0])
cn.links.new(cr.outputs[0], cb.inputs["Base Color"])
cb.inputs["Roughness"].default_value = 0.85
bm = bmesh.new()
prof = []
for i in range(40):
    a = i / 39
    if a < 0.5:
        prof.append((-12 + 26 * a, 0.0))
    else:
        th = (a - 0.5) / 0.5 * math.pi / 2
        prof.append((1 + 6 * math.sin(th), 6 - 6 * math.cos(th)))
prof.append((7, 14))
rows = []
for x in (-30, 30):
    rows.append([bm.verts.new((x, y, z)) for y, z in prof])
for i in range(len(prof) - 1):
    bm.faces.new((rows[0][i], rows[1][i], rows[1][i + 1], rows[0][i + 1]))
me = bpy.data.meshes.new("cyc")
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
cyc = bpy.data.objects.new("cyc", me)
cyc.location = (0, 4, -0.001)
sc.collection.objects.link(cyc)
cyc.data.materials.append(cyc_m)

# ---------- 充气托盘（暖奶油色绗缝软垫） ----------
TW, TD = 9.6, 5.6
HT = 0.95
EDGE_R = 0.75
CELL = 0.8
NX, NY = 241, 141
xs = np.linspace(-TW / 2, TW / 2, NX)
ys = np.linspace(-TD / 2, TD / 2, NY)
GX, GY = np.meshgrid(xs, ys, indexing="ij")
DEDGE = np.minimum(np.minimum(GX + TW / 2, TW / 2 - GX), np.minimum(GY + TD / 2, TD / 2 - GY))
EP = np.sqrt(1 - (1 - np.clip(DEDGE / EDGE_R, 0, 1)) ** 2)
fu = (GX + TW / 2) / CELL % 1.0
fv = (GY + TD / 2) / CELL % 1.0
PUFF = 0.11 * (np.sin(np.pi * fu) * np.sin(np.pi * fv)) ** 0.55
REST_Z = HT * EP + PUFF * EP ** 3
verts = np.stack([GX.ravel(), GY.ravel(), REST_Z.ravel()], 1)
faces = []
for i in range(NX - 1):
    for j in range(NY - 1):
        a = i * NY + j
        faces.append((a, a + NY, a + NY + 1, a + 1))
tray_me = bpy.data.meshes.new("tray")
tray_me.from_pydata(verts.tolist(), [], faces)
uv = tray_me.uv_layers.new(name="UV")
loop_v = np.zeros(len(tray_me.loops), np.int32)
tray_me.loops.foreach_get("vertex_index", loop_v)
uv.data.foreach_set("uv", np.stack([verts[loop_v, 0], verts[loop_v, 1]], 1).astype(np.float32).ravel())
for p in tray_me.polygons:
    p.use_smooth = True
tray = bpy.data.objects.new("tray", tray_me)
sc.collection.objects.link(tray)

TRAY_COL, THREAD_COL = "#f7e1bb", "#3fbf8c"
tm = bpy.data.materials.new("tray_vinyl")
tm.use_nodes = True
tn = tm.node_tree
tb = tn.nodes["Principled BSDF"]
tb.inputs["Roughness"].default_value = 0.34
tb.inputs["Coat Weight"].default_value = 0.35
tb.inputs["Coat Roughness"].default_value = 0.2
tb.inputs["Subsurface Weight"].default_value = 0.12
tb.inputs["Subsurface Radius"].default_value = (1.0, 0.6, 0.35)
tb.inputs["Subsurface Scale"].default_value = 0.08
uvn = tn.nodes.new("ShaderNodeUVMap")
sep = tn.nodes.new("ShaderNodeSeparateXYZ")
tn.links.new(uvn.outputs[0], sep.inputs[0])


def m_(op, a=None, b=None):
    n = tn.nodes.new("ShaderNodeMath")
    n.operation = op
    if a is not None:
        tn.links.new(a, n.inputs[0])
    if b is not None:
        if isinstance(b, (int, float)):
            n.inputs[1].default_value = b
        else:
            tn.links.new(b, n.inputs[1])
    return n.outputs[0]


def seam(axis_out, half):
    c = m_("PINGPONG", m_("DIVIDE", m_("ADD", axis_out, half), CELL), 0.5)
    return m_("LESS_THAN", c, 0.016)


def dash(axis_out):
    return m_("LESS_THAN", m_("FRACT", m_("MULTIPLY", axis_out, 14.0)), 0.55)


stitch = m_("MAXIMUM", m_("MULTIPLY", seam(sep.outputs["X"], TW / 2), dash(sep.outputs["Y"])),
            m_("MULTIPLY", seam(sep.outputs["Y"], TD / 2), dash(sep.outputs["X"])))
mixc = tn.nodes.new("ShaderNodeMix"); mixc.data_type = "RGBA"
mixc.inputs[6].default_value = hexc(TRAY_COL)
mixc.inputs[7].default_value = hexc(THREAD_COL)
tn.links.new(stitch, mixc.inputs["Factor"])
# 接触阴影：每个字母一个随高度变化的椭圆软影（强度/大小由关键帧驱动）
SHADOW_VALS = []
shade_total = None
for idx in range(2):
    vk = tn.nodes.new("ShaderNodeValue"); vk.name = f"shk{idx}"
    vs = tn.nodes.new("ShaderNodeValue"); vs.name = f"shs{idx}"
    vx = tn.nodes.new("ShaderNodeValue"); vx.name = f"shx{idx}"
    dx = m_("DIVIDE", m_("SUBTRACT", sep.outputs["X"], vx.outputs[0]), vs.outputs[0])
    dy = m_("DIVIDE", m_("DIVIDE", sep.outputs["Y"], 0.62), vs.outputs[0])
    r2 = m_("ADD", m_("MULTIPLY", dx, dx), m_("MULTIPLY", dy, dy))
    g = m_("MULTIPLY", m_("EXPONENT", m_("MULTIPLY", r2, -1.0)), vk.outputs[0])
    shade_total = g if shade_total is None else m_("MAXIMUM", shade_total, g)
    SHADOW_VALS.append((vk.outputs[0], vs.outputs[0], vx.outputs[0]))
darken = tn.nodes.new("ShaderNodeMix"); darken.data_type = "RGBA"; darken.blend_type = "MULTIPLY"
tn.links.new(shade_total, darken.inputs["Factor"])
tn.links.new(mixc.outputs[2], darken.inputs[6])
darken.inputs[7].default_value = hexc("#8a6a3e")
tn.links.new(darken.outputs[2], tb.inputs["Base Color"])
tray_me.materials.append(tm)

piping_m = bpy.data.materials.new("piping")
piping_m.use_nodes = True
pb = piping_m.node_tree.nodes["Principled BSDF"]
pb.inputs["Base Color"].default_value = hexc("#efd2a6")
pb.inputs["Roughness"].default_value = 0.3
pc = bpy.data.curves.new("piping", "CURVE")
pc.dimensions = "3D"
pc.bevel_depth, pc.bevel_resolution = 0.05, 4
spl = pc.splines.new("POLY")
pts = [(-TW / 2, -TD / 2), (TW / 2, -TD / 2), (TW / 2, TD / 2), (-TW / 2, TD / 2), (-TW / 2, -TD / 2)]
spl.points.add(len(pts) - 1)
for p, (x, y) in zip(spl.points, pts):
    p.co = (x, y, 0.06, 1)
pipe = bpy.data.objects.new("piping", pc)
sc.collection.objects.link(pipe)
pc.materials.append(piping_m)

# ---------- 充气字母 G / O（薄荷玉绿） ----------
LET_COL, SEAM_COL = "#12c98b", "#078a5d"
font = bpy.data.fonts.load(FONT)
let_m = bpy.data.materials.new("balloon")
let_m.use_nodes = True
ln = let_m.node_tree
lb = ln.nodes["Principled BSDF"]
lb.inputs["Roughness"].default_value = 0.2
lb.inputs["Coat Weight"].default_value = 1.0
lb.inputs["Coat Roughness"].default_value = 0.04
lb.inputs["Subsurface Weight"].default_value = 0.25
lb.inputs["Subsurface Radius"].default_value = (0.35, 1.0, 0.6)
lb.inputs["Subsurface Scale"].default_value = 0.15
lb.inputs["Sheen Weight"].default_value = 0.2
ltc = ln.nodes.new("ShaderNodeTexCoord")
lsp = ln.nodes.new("ShaderNodeSeparateXYZ")
ln.links.new(ltc.outputs["Object"], lsp.inputs[0])
lab = ln.nodes.new("ShaderNodeMath"); lab.operation = "ABSOLUTE"
ln.links.new(lsp.outputs["Y"], lab.inputs[0])
lse = ln.nodes.new("ShaderNodeMapRange")
lse.inputs["From Min"].default_value, lse.inputs["From Max"].default_value = 0.012, 0.03
lse.inputs["To Min"].default_value, lse.inputs["To Max"].default_value = 1.0, 0.0
ln.links.new(lab.outputs[0], lse.inputs["Value"])
lmix = ln.nodes.new("ShaderNodeMix"); lmix.data_type = "RGBA"
lmix.inputs[6].default_value = hexc(LET_COL)
lmix.inputs[7].default_value = hexc(SEAM_COL)
ln.links.new(lse.outputs[0], lmix.inputs["Factor"])
ln.links.new(lmix.outputs[2], lb.inputs["Base Color"])
lr = ln.nodes.new("ShaderNodeMath"); lr.operation = "MULTIPLY_ADD"
lr.inputs[1].default_value = 0.25; lr.inputs[2].default_value = 0.2
ln.links.new(lse.outputs[0], lr.inputs[0])
ln.links.new(lr.outputs[0], lb.inputs["Roughness"])
bump = ln.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.6
bump.inputs["Distance"].default_value = 0.02
inv = ln.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
ln.links.new(lse.outputs[0], inv.inputs[1])
ln.links.new(inv.outputs[0], bump.inputs["Height"])
ln.links.new(bump.outputs[0], lb.inputs["Normal"])


def balloon_letter(ch, cap_h=2.3):
    cu = bpy.data.curves.new("t_" + ch, "FONT")
    cu.body = ch
    cu.font = font
    cu.align_x, cu.align_y = "CENTER", "BOTTOM_BASELINE"
    cu.size = cap_h / 0.72
    cu.extrude = 0.2
    cu.bevel_depth = 0.24
    cu.bevel_resolution = 8
    tmp = bpy.data.objects.new("tmp", cu)
    sc.collection.objects.link(tmp)
    rm = tmp.modifiers.new("rm", "REMESH")
    rm.mode, rm.voxel_size = "VOXEL", 0.03
    sm = tmp.modifiers.new("sm", "SMOOTH")
    sm.factor, sm.iterations = 0.9, 14
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    new = np.stack([co[:, 0], -co[:, 2], co[:, 1]], 1)
    new[:, 0] -= (new[:, 0].max() + new[:, 0].min()) / 2
    new[:, 1] -= (new[:, 1].max() + new[:, 1].min()) / 2
    new[:, 2] -= new[:, 2].min()
    me.vertices.foreach_set("co", new.ravel())
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    ob = bpy.data.objects.new("L_" + ch, me)
    sc.collection.objects.link(ob)
    me.materials.append(let_m)
    return ob, new[:, 0].max() - new[:, 0].min()


LG, wg = balloon_letter("G")
LO, wo = balloon_letter("O")
GAP = 0.25
XG = -(wo + GAP) / 2
XO = (wg + GAP) / 2


def rest_surface(x, y):
    ix = int(round((x + TW / 2) / TW * (NX - 1)))
    iy = int(round((y + TD / 2) / TD * (NY - 1)))
    return float(REST_Z[ix, iy])


# ---------- 一维接触物理 ----------
G_ACC = 40.0                     # 重力（场景单位/秒²）：H0=2.45 下落约 0.35 s
H0 = 2.45
K_C, C_C = 965.0, 13.7           # 接触弹簧/阻尼（每单位质量）：压陷约 0.45，恢复系数约 0.5
SIM_HZ = 1200
T_SIM = np.arange(-0.5, 8.6, 1.0 / SIM_HZ)
W_SQ, Z_SQ = 2 * math.pi * 8.5, 0.28   # 压扁/拉伸跟随弹簧（产生二次晃动）


def simulate(t_drop, jumps):
    """jumps: [(t_jump, v_jump)]，起跳前 0.12 s 下蹲（向下附加力 + 预压扁）"""
    n = len(T_SIM)
    h = np.zeros(n); v = np.zeros(n); sz = np.ones(n)
    hh, vv, s, sv = H0, 0.0, 1.0, 0.0
    impacts = []
    in_contact = False
    dt = 1.0 / SIM_HZ
    for i, t in enumerate(T_SIM):
        if t < t_drop:
            hh, vv = H0, 0.0
        else:
            a = -G_ACC
            if hh < 0:
                a += max(0.0, -K_C * hh - C_C * vv)
            for tj, vj in jumps:
                if tj - 0.12 <= t < tj:
                    a -= 140.0
            vv += a * dt
            hh += vv * dt
            for tj, vj in jumps:
                if abs(t - tj) < 0.5 / SIM_HZ:
                    vv = vj
        now_contact = hh < 0
        if now_contact and not in_contact:
            impacts.append((t, abs(vv)))
        in_contact = now_contact
        if hh < 0:
            target = max(0.58, 1 - 0.85 * (-hh))
        else:
            target = min(1.16, 1 + 0.011 * abs(vv))
        for tj, vj in jumps:
            if tj - 0.12 <= t < tj:
                target = min(target, 0.8)
        acc = W_SQ * W_SQ * (target - s) - 2 * Z_SQ * W_SQ * sv
        sv += acc * dt
        s += sv * dt
        h[i], v[i], sz[i] = hh, vv, s
    return h, v, sz, impacts


SIM = {
    "G": simulate(0.55, [(4.05, 8.4), (6.05, 4.6)]),
    "O": simulate(0.78, [(4.18, 8.4), (6.22, 3.8)]),
}

# 托盘中心位移 = 接触压陷 + 离开后的自由振荡（向上鼓、快速衰减）
W_FREE, L_FREE = 2 * math.pi * 6.0, 8.0


def tray_center_series(h, v):
    d = np.minimum(h, 0.0)
    free = np.zeros_like(h)
    contact = h < 0
    rel_idx = np.where(contact[:-1] & ~contact[1:])[0]
    for i in rel_idx:
        tau = T_SIM[i:] - T_SIM[i]
        vr = max(0.0, v[i])
        free[i:] += (vr * 0.5 / W_FREE) * np.exp(-L_FREE * tau) * np.sin(W_FREE * tau)
    return d + free


D_TAB = {k: tray_center_series(SIM[k][0], SIM[k][1]) for k in SIM}
LETTERS = [("G", LG, XG), ("O", LO, XO)]
C_WAVE = 6.0


def sample(arr, t):
    return float(np.interp(t, T_SIM, arr))


def tray_field(t):
    disp = np.zeros_like(GX)
    for key, L, x0 in LETTERS:
        dx = (GX - x0) / 0.95
        dy = GY / 0.62
        r = np.sqrt(dx * dx + dy * dy)
        rd = np.sqrt((GX - x0) ** 2 + GY ** 2)
        resp = np.interp(t - rd / C_WAVE, T_SIM, D_TAB[key])
        core = np.exp(-r * r)
        ring = 0.22 * np.exp(-((r - 1.7) ** 2) / 0.5)
        disp += resp * (core - ring)
    return disp * EP


def tilt(key, t):
    s = 0.0
    sign = 1 if key == "G" else -1
    for ti, vi in SIM[key][3]:
        if t > ti:
            tau = t - ti
            s += sign * 0.06 * min(1.0, vi / 14) * math.exp(-5 * tau) * math.sin(2 * math.pi * 3.6 * tau)
    return s


# ---------- 灯光与相机 ----------
def area(name, loc, rot, size, power, color="#ffffff"):
    ld = bpy.data.lights.new(name, "AREA")
    ld.size, ld.energy, ld.color = size, power, hexc(color)[:3]
    ob = bpy.data.objects.new(name, ld)
    ob.location, ob.rotation_euler = loc, rot
    sc.collection.objects.link(ob)
    return ob


area("key", (-5, -6, 8), (math.radians(45), 0, math.radians(-38)), 7, 900, "#fffaf0")
area("fill", (7, -5, 3), (math.radians(70), 0, math.radians(55)), 8, 380, "#f3fff6")
area("rim", (1, 7, 6), (math.radians(-55), 0, math.radians(180)), 8, 900, "#fff2cf")

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 40
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = 3.2
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
tgt = bpy.data.objects.new("tgt", None)
sc.collection.objects.link(tgt)
con = cam.constraints.new("TRACK_TO")
con.target, con.track_axis, con.up_axis = tgt, "TRACK_NEGATIVE_Z", "UP_Y"
focus = bpy.data.objects.new("focus", None)
sc.collection.objects.link(focus)
focus.location = (0, -0.3, 1.5)
cam_d.dof.focus_object = focus
track(cam, "location"); track(tgt, "location")


def camera(t):
    # 低机位绕行 + 推近：方位角 -24°→+12°，高度 2.75→1.95（略高于软垫，能看到压陷）
    u = ease(t / 8.0)
    az = math.radians(-24 + 36 * u)
    R = 11.6 - 2.0 * u
    z = 2.75 - 0.8 * ease(t / 3.0)
    tg = Vector((0.1 * u, 0.0, 2.95 - 1.2 * ease(t / 3.0)))
    return Vector((R * math.sin(az), -R * math.cos(az), z)), tg


for key, L, x0 in LETTERS:
    track(L, "location"); track(L, "scale"); track(L, "rotation_euler")
for vk, vs, vx in SHADOW_VALS:
    track(vk, "default_value"); track(vs, "default_value")
SHADOW_VALS[0][2].default_value = XG
SHADOW_VALS[1][2].default_value = XO


def apply(t):
    for idx, (key, L, x0) in enumerate(LETTERS):
        h, v, sz_arr, imp = SIM[key]
        hb = sample(h, t)
        sz = min(1.25, max(0.55, sample(sz_arr, t)))
        sxy = 1 / math.sqrt(sz)
        base = rest_surface(x0, 0.0)
        L.location = (x0, 0.0, base + hb - 0.05)
        L.scale = (sxy, sxy, sz)
        L.rotation_euler = (tilt(key, t), 0.0, 0.02 * math.sin(1.1 * t + idx))
        hp = max(0.0, hb)
        vk, vs, vx = SHADOW_VALS[idx]
        vk.default_value = 0.8 / (1 + 0.5 * hp)
        vs.default_value = 1.0 + 0.2 * hp
    p, tg = camera(t)
    cam.location, tgt.location = p, tg


for f in range(0, 242):
    apply((f - 1) / FPS)
    for db, path in KEYED:
        db.keyframe_insert(path, frame=f)


def linearize(idb):
    ad = getattr(idb, "animation_data", None)
    if not ad or not ad.action:
        return
    act = ad.action
    curves = list(act.fcurves) if hasattr(act, "fcurves") else []
    if not curves:
        for layer in act.layers:
            for strip in layer.strips:
                for cb_ in strip.channelbags:
                    curves += list(cb_.fcurves)
    for fc in curves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


for coll in (bpy.data.objects, bpy.data.materials):
    for idb in coll:
        linearize(idb)
        if getattr(idb, "node_tree", None):
            linearize(idb.node_tree)

for f in FRAMES:
    t = (f - 1) / FPS
    disp = tray_field(t)
    co = np.stack([GX.ravel(), GY.ravel(), (REST_Z + disp).ravel()], 1)
    tray_me.vertices.foreach_set("co", co.ravel())
    tray_me.update()
    sc.frame_set(f)
    sc.render.filepath = os.path.join(OUT, f"{f:04d}.png")
    bpy.ops.render.render(write_still=True)
    print("FRAME", f, flush=True)
print("DONE")
