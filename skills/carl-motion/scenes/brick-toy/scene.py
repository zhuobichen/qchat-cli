# S33 积木玩具 B — 积木机器人搭桥，小车通过。Blender 5.2, EEVEE。
# 用法: blender -b --factory-startup -P scene.py -- <帧目录> [起始帧 结束帧 步长 分辨率百分比]
import bpy, bmesh, math, sys, os, random
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "/tmp/S33_frames"
F0 = int(argv[1]) if len(argv) > 1 else 1
F1 = int(argv[2]) if len(argv) > 2 else 240
STEP = int(argv[3]) if len(argv) > 3 else 1
PCT = int(argv[4]) if len(argv) > 4 else 100
os.makedirs(OUT, exist_ok=True)

U = 0.008  # 1 stud pitch = 8 mm, true scale
BH, PH = 1.2, 0.4
FPS = 30

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene

# ---------------- materials ----------------
def hexrgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1,)

_mats = {}
def plastic(name, col, coat=0.8, rough=0.17, trans=0.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexrgb(col)
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.07
    b.inputs["Specular IOR Level"].default_value = 0.5
    if trans > 0:
        b.inputs["Transmission Weight"].default_value = trans
        b.inputs["Roughness"].default_value = 0.05
    else:
        # fingerprints / handling scratches on the roughness channel
        tc = nt.nodes.new("ShaderNodeTexCoord")
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = 260.0
        n.inputs["Detail"].default_value = 6.0
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.45
        mr.inputs["From Max"].default_value = 0.75
        mr.inputs["To Min"].default_value = rough
        mr.inputs["To Max"].default_value = rough + 0.28
        nt.links.new(tc.outputs["Object"], n.inputs["Vector"])
        nt.links.new(n.outputs["Fac"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], b.inputs["Roughness"])
    _mats[name] = m
    return m

RED, BLUE, YEL, ORG = "#c91a09", "#0055bf", "#f2cd37", "#fe8a18"
WHITE, LBG, DBG, BLK, TAN, GRN = "#f2f2ee", "#a0a5a9", "#5b6770", "#1b2a34", "#e4cd9e", "#4b9f4a"

# ---------------- geometry ----------------
_meshes = {}
def brick_mesh(nx, ny, h, studs=True, round_=False):
    key = (nx, ny, h, studs, round_)
    if key in _meshes:
        return _meshes[key]
    bm = bmesh.new()
    g = 0.02  # seam gap each side
    if round_:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=(nx / 2 - g) * U, radius2=(nx / 2 - g) * U,
                              depth=h * U, matrix=Matrix.Translation((0, 0, h * U / 2)))
    else:
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r["verts"]:
            v.co.x *= (nx - 2 * g) * U
            v.co.y *= (ny - 2 * g) * U
            v.co.z = (v.co.z + 0.5) * h * U
    if studs:
        for i in range(nx):
            for j in range(ny):
                x = (i - (nx - 1) / 2) * U
                y = (j - (ny - 1) / 2) * U
                bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=0.3 * U, radius2=0.3 * U,
                                      depth=0.2 * U, matrix=Matrix.Translation((x, y, h * U + 0.1 * U)))
    me = bpy.data.meshes.new(f"brick_{nx}x{ny}x{h}")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    _meshes[key] = me
    return me

def add_obj(name, me, mat, loc=(0, 0, 0), parent=None, bevel=True):
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o.data.materials.clear() if o.data.users == 1 else None
    if not o.data.materials:
        o.data.materials.append(mat)
    else:
        o.material_slots[0].link = 'OBJECT'
        o.material_slots[0].material = mat
    if bevel:
        bv = o.modifiers.new("bev", "BEVEL")
        bv.width = 0.045 * U
        bv.segments = 2
        bv.limit_method = 'ANGLE'
        bv.harden_normals = True
    o.location = Vector(loc) * U
    if parent:
        o.parent = parent
    return o

def brick(name, nx, ny, h, col, loc, parent=None, studs=True, round_=False, coat=0.8, trans=0.0):
    me = brick_mesh(nx, ny, h, studs, round_)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    if not me.materials:
        me.materials.append(plastic(col + str(trans), col, coat, trans=trans))
    o.material_slots[0].link = 'OBJECT'
    o.material_slots[0].material = plastic(col + str(trans), col, coat, trans=trans)
    bv = o.modifiers.new("bev", "BEVEL")
    bv.width = 0.045 * U
    bv.segments = 2
    bv.limit_method = 'ANGLE'
    bv.harden_normals = True
    o.location = Vector(loc) * U
    if parent:
        o.parent = parent
    return o

def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = Vector(loc) * U
    if parent:
        e.parent = parent
    return e

def cyl(name, r, depth, col, loc, rot=(0, 0, 0), parent=None, seg=28, coat=0.8):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r * U, radius2=r * U, depth=depth * U)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    me.materials.append(plastic(col, col, coat))
    bv = o.modifiers.new("bev", "BEVEL")
    bv.width = 0.04 * U
    bv.segments = 2
    bv.limit_method = 'ANGLE'
    bv.harden_normals = True
    o.location = Vector(loc) * U
    o.rotation_euler = rot
    if parent:
        o.parent = parent
    return o

# ---------------- set: table, wall, props ----------------
def plane(name, size, loc, rot, mat):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    return o

wood = bpy.data.materials.new("wood")
wood.use_nodes = True
nt = wood.node_tree
b = nt.nodes["Principled BSDF"]
tc = nt.nodes.new("ShaderNodeTexCoord")
mp = nt.nodes.new("ShaderNodeMapping")
mp.inputs["Scale"].default_value = (1.0, 14.0, 1.0)
wv = nt.nodes.new("ShaderNodeTexWave")
wv.inputs["Scale"].default_value = 1.6
wv.inputs["Distortion"].default_value = 6.0
wv.inputs["Detail"].default_value = 4.0
cr = nt.nodes.new("ShaderNodeValToRGB")
cr.color_ramp.elements[0].color = hexrgb("#8d8780")
cr.color_ramp.elements[1].color = hexrgb("#b3aca4")
nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
nt.links.new(wv.outputs["Fac"], cr.inputs["Fac"])
nt.links.new(cr.outputs["Color"], b.inputs["Base Color"])
b.inputs["Roughness"].default_value = 0.55
plane("table", 3.0, (0, 0.6, -0.4 * U - 0.0002), (0, 0, 0), wood)

wallm = bpy.data.materials.new("wall")
wallm.use_nodes = True
nt = wallm.node_tree
b = nt.nodes["Principled BSDF"]
tc = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
cr = nt.nodes.new("ShaderNodeValToRGB")
cr.color_ramp.elements[0].position = 0.35
cr.color_ramp.elements[0].color = hexrgb("#c3c7cc")
cr.color_ramp.elements[1].position = 0.75
cr.color_ramp.elements[1].color = hexrgb("#9fb2c6")
nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
nt.links.new(sep.outputs["X"], cr.inputs["Fac"])
nt.links.new(cr.outputs["Color"], b.inputs["Base Color"])
b.inputs["Roughness"].default_value = 0.9
plane("wall", 3.0, (0, 1.05, 0.5), (math.radians(90), 0, 0), wallm)

# ceramic mug and books, real scale, far behind (bokeh)
mug = cyl("mug", 5.0, 12.0, "#eeeae4", (30, 60, 6.0), coat=0.9)
mug_in = cyl("mug_in", 4.4, 0.4, "#5a3d2b", (30, 60, 11.9), coat=0.9)
bpy.ops.mesh.primitive_torus_add(major_radius=3.0 * U, minor_radius=0.8 * U, location=(35.2 * U, 60 * U, 6.5 * U),
                                 rotation=(math.radians(90), 0, 0))
bpy.context.active_object.data.materials.append(plastic("#eeeae4", "#eeeae4", 0.9))
for i, (c, h) in enumerate([("#2f5d7c", 3.5), ("#b5523b", 3.0), ("#d9cfb8", 3.2)]):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-38 * U, 75 * U, (sum(x[1] for x in [("", 3.5), ("", 3.0), ("", 3.2)][:i]) + h / 2) * U - 0.4 * U))
    bk = bpy.context.active_object
    bk.scale = (30 * U, 22 * U, h * U)
    bk.rotation_euler = (0, 0, math.radians(8 - 6 * i))
    bk.data.materials.append(plastic("book" + c, c, 0.1, rough=0.6))

# ---------------- brick world ----------------
base = brick("baseplate", 40, 26, PH, GRN, (0, 2, -PH), coat=0.25)
base.modifiers["bev"].width = 0.03 * U

def abutment(x0, x1, top_col, side):
    objs = []
    patterns = [[4, 4, 2], [2, 4, 4], [4, 2, 4]]
    cols = [LBG, WHITE, top_col]
    for layer in range(3):
        x = x0
        for n in patterns[layer if side < 0 else 2 - layer]:
            objs.append(brick(f"ab{side}_{layer}_{x}", n, 4, BH, cols[layer], (x + n / 2, 0, layer * BH)))
            x += n
    return objs

abutment(-16, -6, DBG, -1)
abutment(6, 16, DBG, 1)
for px in (-4, 0, 4):
    for layer in range(2):
        brick(f"pillar{px}_{layer}", 2, 4, BH, LBG if layer == 0 else WHITE, (px, 0, layer * BH))
# supply box + stacked deck bricks
for layer in range(2):
    brick(f"supply{layer}", 4, 4, BH, "#7d6a52" if layer == 0 else TAN, (8, 4.3, layer * BH))
TARGETS = [4.0, 0.0, -4.0]
DECK_COLS = [BLUE, RED, BLUE]
SUPPLY_Z = [2.4 + 2 * BH, 2.4 + BH, 2.4]  # bottoms; brick 0 on top
deck = [brick(f"deck{i}", 4, 4, BH, DECK_COLS[i], (8, 4.3, SUPPLY_Z[i])) for i in range(3)]
# foreground loose bricks (bokeh) and set dressing
brick("fg1", 2, 2, BH, TAN, (-11, -9, 0)).rotation_euler.z = 0.3
brick("fg2", 1, 2, BH, RED, (-8.5, -10, 0)).rotation_euler.z = -0.2
brick("fg3", 2, 4, PH, YEL, (12.5, -9, 0)).rotation_euler.z = 0.15
brick("bg1", 1, 1, BH, BLUE, (-13, 9, 0), round_=True)
brick("bg2", 2, 2, BH, WHITE, (15, 10, 0)).rotation_euler.z = 0.4
brick("bg3", 1, 1, BH, ORG, (16.5, 8.3, 0), round_=True)

# ---------------- robot (yellow/orange, blue visor) ----------------
robot = empty("robot_root")
legs = []
for sx in (-1, 1):
    hip = empty(f"hip{sx}", (sx * 0.9, 0, 2.4), robot)
    brick(f"leg{sx}a", 1, 2, BH, ORG, (0, 0, -2.4), hip, studs=False)
    brick(f"leg{sx}b", 1, 2, BH, ORG, (0, 0, -1.2), hip, studs=False)
    brick(f"foot{sx}", 1, 2, PH, BLK, (0, -0.25, -2.4), hip, studs=False)
    legs.append(hip)
torso = empty("torso", (0, 0, 2.4), robot)
brick("torso1", 3, 2, BH, YEL, (0, 0, 0), torso, studs=False)
brick("torso2", 3, 2, BH, YEL, (0, 0, BH), torso, studs=True)
cyl("chest_light", 0.38, 0.12, RED, (0.6, -1.03, 1.55), (math.radians(90), 0, 0), torso)
bpy_tile = brick("chest_tile", 1, 2, PH, ORG, (-0.5, -1.0, 1.35), torso, studs=False)
bpy_tile.rotation_euler = (math.radians(90), 0, 0)
neck = empty("neck", (0, 0, 2.4 + 2.4 - 2.4), torso)  # at torso top (local z = 2.4)
neck.location = Vector((0, 0, 2.4)) * U
cyl("neck_plate", 0.5, 0.4, LBG, (0, 0, 0.2), parent=neck)
headb = brick("head", 2, 2, BH, YEL, (0, 0, 0.4), neck, studs=False)
brick("head_top", 2, 2, PH, YEL, (0, 0, 0.4 + BH), neck)
visor = brick("visor", 2, 1, PH, "#0a2a55", (0, -0.98, 1.0), neck, studs=False, coat=1.0)
visor.rotation_euler = (math.radians(90), 0, 0)
visor.scale = (0.92, 1.0, 0.85)
for ex in (-0.42, 0.42):
    cyl(f"eye{ex}", 0.17, 0.08, "#e8f6ff", (ex, -1.22, 1.05), (math.radians(90), 0, 0), neck)
for ex in (-1.08, 1.08):
    cyl(f"ear{ex}", 0.42, 0.35, LBG, (ex, 0, 1.0), (0, math.radians(90), 0), neck)
L_ARM = 2.6
arms = []
for sx in (-1, 1):
    sh = empty(f"shoulder{sx}", (sx * 1.9, 0, 2.0), torso)  # local z 2.0 on torso => world z 4.4
    cyl(f"sjoint{sx}", 0.48, 0.5, ORG, (0, 0, 0), (0, math.radians(90), 0), sh)
    cyl(f"arm{sx}", 0.34, 2.2, YEL, (0, 0, -1.2), parent=sh)
    cyl(f"hand{sx}", 0.36, 0.42, LBG, (0, 0, -L_ARM), (0, math.radians(90), 0), sh)
    arms.append(sh)

# ---------------- car ----------------
car = empty("car_root")
brick("chassis", 4, 2, PH, BLK, (0, 0, 0.5), car, studs=False)
brick("car_body", 4, 2, PH, RED, (0, 0, 0.9), car, studs=True)
cab = brick("cabin", 2, 2, BH, RED, (-0.9, 0, 1.3), car)
ws = brick("windscreen", 1, 2, BH * 0.85, "#cfe3ee", (0.35, 0, 1.3), car, studs=False, trans=0.85)
ws.scale = (0.25, 1, 1)
for hy in (-0.55, 0.55):
    cyl(f"lamp{hy}", 0.22, 0.12, "#fff3b0", (2.02, hy, 1.1), (0, math.radians(90), 0), car)
wheels = []
for wx in (-1.3, 1.3):
    for wy in (-1.18, 1.18):
        w = empty(f"wheel{wx}{wy}", (wx, wy, 0.75), car)
        cyl(f"tire{wx}{wy}", 0.75, 0.55, "#202020", (0, 0, 0), (math.radians(90), 0, 0), w, coat=0.1)
        cyl(f"hub{wx}{wy}", 0.42, 0.6, LBG, (0, 0, 0), (math.radians(90), 0, 0), w)
        cyl(f"spoke{wx}{wy}", 0.12, 0.62, BLK, (0.22, 0, 0), (math.radians(90), 0, 0), w)
        wheels.append(w)

# ---------------- camera & lights ----------------
cam_d = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam
cam_d.lens = 50
cam_d.clip_start = 0.005
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = 8.0
focus = empty("focus")
cam_d.dof.focus_object = focus
aim = empty("aim")
tr = cam.constraints.new("TRACK_TO")
tr.target = aim
tr.track_axis = 'TRACK_NEGATIVE_Z'
tr.up_axis = 'UP_Y'

def area(name, loc, rot, size, power, col):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.size = size
    ld.energy = power
    ld.color = col
    o = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    return ld

sun_d = bpy.data.lights.new("key_sun", 'SUN')
sun_d.energy = 2.6
sun_d.angle = math.radians(4)
sun_d.color = (1.0, 0.93, 0.84)
sun = bpy.data.objects.new("key_sun", sun_d)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
soft_key = area("soft_front", (-0.25, -0.45, 0.35), (math.radians(60), 0, math.radians(-30)), 0.35, 14.0, (1.0, 0.95, 0.88))
rim = area("rim", (0.15, 0.5, 0.25), (math.radians(-70), 0, math.radians(165)), 0.3, 9.0, (0.8, 0.88, 1.0))
area("top", (0, 0.05, 0.6), (0, 0, 0), 0.4, 6.0, (1, 1, 1))

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.66, 0.72, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.32

r = scene.render
r.engine = 'BLENDER_EEVEE'
r.resolution_x, r.resolution_y, r.resolution_percentage = 1920, 1080, PCT
r.fps = FPS
r.image_settings.file_format = 'PNG'
r.film_transparent = False
ee = scene.eevee
ee.taa_render_samples = 32
ee.use_raytracing = False  # screen-space traced coat reflections ghost the robot through bricks
ee.use_shadows = True
ee.shadow_resolution_scale = 1.0
ee.use_fast_gi = True
ee.use_bokeh_jittered = True  # avoids post-process DOF halos / foreground see-through
ee.bokeh_overblur = 0.0
ee.fast_gi_distance = 0.05
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Punchy'
scene.view_settings.exposure = -0.35

# ---------------- animation ----------------
def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)

def lerp(a, b, t):
    return a + (b - a) * t

def vlerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)

def q12(t):  # stop-motion: characters & bricks step at 12 fps
    return math.floor(t * 12 + 1e-6) / 12

C_OFF = 1.7      # hand grips 0.3 in from the brick's back edge
Z_OFF = 0.95     # hand sits on top of the brick
SH_Z = 4.4

def fwd(psi):
    return Vector((math.sin(psi), -math.cos(psi), 0))

def solve(P, psi):
    """Given carried brick centre P (stud units) and yaw, return robot root and arm pitch."""
    c = (SH_Z - Z_OFF - P.z) / L_ARM
    c = max(-0.99, min(0.99, c))
    th = math.acos(c)
    d = L_ARM * math.sin(th) + C_OFF
    root = Vector((P.x, P.y, 0)) - fwd(psi) * d
    return root, th

CYCLE, S0 = 1.2, 0.6
def brick_center(i, t):
    """World centre of deck brick i (stud units) at time t."""
    S = S0 + CYCLE * i
    start = Vector((8, 4.3, SUPPLY_Z[i] + 0.6))
    lifted = start + Vector((0, 0, 0.6))
    above = Vector((TARGETS[i], 0, 4.4))
    final = Vector((TARGETS[i], 0, 3.0))
    if t < S + 0.2:
        return start, False
    if t < S + 0.35:
        return vlerp(start, lifted, ease((t - S - 0.2) / 0.15)), True
    if t < S + 0.8:
        u = ease((t - S - 0.35) / 0.45)
        p = vlerp(lifted, above, u)
        p.z = lerp(lifted.z, above.z, u) + 1.4 * math.sin(math.pi * u)
        return p, True
    if t < S + 0.95:
        u = (t - S - 0.8) / 0.15
        return vlerp(above, final, u * u), True
    if t < S + 1.05:  # snap: tiny overshoot rebound
        u = (t - S - 0.95) / 0.1
        return final + Vector((0, 0, 0.12 * math.sin(math.pi * u))), True
    return final, False

def psi_for(i, t):
    S = S0 + CYCLE * i
    u = ease((t - S - 0.35) / 0.4)
    return lerp(math.radians(90), 0.0, u)

REST_TH = math.radians(12)

def robot_state(t):
    """root(Vector), yaw, arm pitch L/R, arm roll R, head yaw, carry flag."""
    tq = q12(t)
    # find active cycle
    for i in range(3):
        S = S0 + CYCLE * i
        if S <= tq < S + 1.05 and tq >= S + 0.2:
            P, carry = brick_center(i, tq)
            psi = psi_for(i, tq)
            root, th = solve(P, psi)
            return root, psi, th, th, 0.0, 0.0
    # transitions (empty hands): reach toward next pickup / release
    def pick_pose(i):
        P, _ = brick_center(i, S0 + CYCLE * i)
        root, th = solve(P, math.radians(90))
        return root, math.radians(90), th
    def place_pose(i):
        P = Vector((TARGETS[i], 0, 3.0))
        root, th = solve(P, 0.0)
        return root, 0.0, th
    if tq < S0 + 0.2:
        r1, p1, t1 = pick_pose(0)
        r0 = r1 + Vector((-0.6, 0.2, 0))
        u = ease((tq - 0.1) / (S0 + 0.1))
        return vlerp(r0, r1, u), p1, lerp(REST_TH, t1, u), lerp(REST_TH, t1, u), 0.0, 0.0
    for i in range(2):
        a = S0 + CYCLE * i + 1.05
        b_ = S0 + CYCLE * (i + 1) + 0.2
        if a <= tq < b_:
            r0, p0, t0 = place_pose(i)
            r1, p1, t1 = pick_pose(i + 1)
            u = ease((tq - a) / (b_ - a))
            back = r0 + Vector((0, 0.35, 0))
            root = vlerp(r0, r1, u) + Vector((0, 0.5 * math.sin(math.pi * u), 0))
            th_mid = math.radians(55)
            th = lerp(t0, th_mid, min(1, u * 2)) if u < 0.5 else lerp(th_mid, t1, (u - 0.5) * 2)
            return root, lerp(p0, p1, u), th, th, 0.0, 0.0
    # after last placement: step back, rest, then wave
    a = S0 + CYCLE * 2 + 1.05
    r0, _, t0 = place_pose(2)
    rest_root = Vector((-3.0, 4.9, 0))
    u = ease((tq - a) / 0.6)
    root = vlerp(r0, rest_root, u)
    thl = lerp(t0, REST_TH, u)
    thr = thl
    roll = 0.0
    head = 0.0
    # head follows the car
    cx = car_x(t)
    head = max(-0.6, min(0.6, math.atan2(cx - root.x, 4.9) * 0.8)) * ease((t - 4.4) / 0.4)  # +yaw turns toward +x
    if tq >= 5.5:
        w = ease((tq - 5.5) / 0.35)
        thr = lerp(REST_TH, math.radians(155), w)
        roll = w * 0.38 * math.sin((tq - 5.5) * 2 * math.pi * 2.0)
        if tq > 7.4:
            k = ease((tq - 7.4) / 0.5)
            thr = lerp(thr, math.radians(120), k)
            roll *= (1 - k)
    return root, 0.0, thl, thr, roll, head

def car_x(t):
    u = ease((t - 4.3) / 3.2)
    return lerp(-10.0, 12.5, u)

def walk_phase(root_hist):
    return root_hist

rand = random.Random(33)
deck_bounce = [0.0, 0.0, 0.0]

def apply(frame):
    t = (frame - 1) / FPS
    # deck bricks
    for i in range(3):
        P, carry = brick_center(i, q12(t))
        S = S0 + CYCLE * i
        if q12(t) >= S + 1.05:
            # rebound while the car rolls over it
            cx = car_x(t)
            dx = cx - TARGETS[i]
            press = -0.06 * math.exp(-(dx / 1.6) ** 2)
            after = 0.0
            if dx > 0:
                after = 0.07 * math.sin(dx * 2.4) * math.exp(-dx / 3.0)
            P = P + Vector((0, 0, press + after))
        deck[i].location = Vector((P.x, P.y, P.z - 0.6)) * U
        deck[i].rotation_euler = (0, 0, psi_for(i, q12(t)) if (S + 0.2 <= q12(t) < S + 0.8) else 0.0)
    cx = car_x(t)
    root, psi, thl, thr, roll, head = robot_state(t)
    # walking legs: swing proportional to travelled distance (12 fps)
    tq = q12(t)
    rp, *_ = robot_state(max(0, tq - 1 / 12))
    spd = (root - rp).length * 12
    stride = (root.x + root.y) * 1.6
    swing = min(0.55, spd * 0.12) * math.sin(stride)
    bob = abs(math.sin(stride)) * min(0.25, spd * 0.05)
    robot.location = (root + Vector((0, 0, bob))) * U
    robot.rotation_euler = (0, 0, psi)
    legs[0].rotation_euler = (swing, 0, 0)
    legs[1].rotation_euler = (-swing, 0, 0)
    arms[0].rotation_euler = (-thl, 0, 0)
    arms[1].rotation_euler = Euler((-thr, roll, 0), 'XYZ')
    neck.rotation_euler = (0, 0, head)
    # car (moves on ones)
    on_deck_bump = 0.0
    car.location = Vector((cx, 0, 3.8 + on_deck_bump)) * U
    for w in wheels:
        w.rotation_euler = (0, (cx + 10.0) / 0.75, 0)
    # camera on ones: follows the action, slight down angle so deck studs read
    u = t / 8.0
    ax = lerp(-1.0, -0.5, ease(t / 4.0)) if t < 4.3 else lerp(-0.5, 0.35 * cx + 0.5, ease((t - 4.3) / 1.2))
    cam.location = Vector((ax - 4.0 + 2.0 * u, lerp(-33.0, -30.5, u), lerp(10.5, 9.6, u))) * U
    aim.location = Vector((ax, 2.0, 3.4)) * U
    # rack focus: brick being placed -> car
    if t < 4.3:
        idx = min(2, max(0, int((t - S0) // CYCLE)))
        fx = lerp(8.0, TARGETS[idx], ease(((t - S0) % CYCLE) / 0.8)) if t >= S0 else 6.0
        fpos = Vector((fx, 1.6, 4.0))
    else:
        k = ease((t - 4.3) / 0.6)
        fpos = vlerp(Vector((-4.0, 1.6, 4.0)), Vector((cx, 0.0, 4.4)), k)
    focus.location = fpos * U
    # stop-motion light flicker per pose (tiny)
    rnd = random.Random(int(q12(t) * 12) + 1000)
    sun_d.energy = 2.6 * (1 + rnd.uniform(-0.015, 0.015))

for f in range(F0, F1 + 1, STEP):
    scene.frame_set(f)
    apply(f)
    r.filepath = os.path.join(OUT, f"{f:04d}.png")
    bpy.ops.render.render(write_still=True)
    print("FRAME", f, flush=True)
