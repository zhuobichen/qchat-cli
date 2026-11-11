# S28 实体白模投影 B —— 老工厂 → 公共图书馆。白模哑光全白，颜色只来自投影机。
# EEVEE 两遍：base=房间灯下白模；proj=仅投影机聚光灯照明（阴影贴图遮挡），表面反照率=投影图按投影机视锥采样。
# 合成：线性相加（overlay.py）。
# 用法: blender -b -P scene.py -- <raw_dir> <proj_dir> [start end step] [res_percent] [taa_samples]
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout import *

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, PROJ = argv[0], argv[1]
F0, F1, FS = (int(argv[2]), int(argv[3]), int(argv[4])) if len(argv) >= 5 else (0, 239, 1)
RES = int(argv[5]) if len(argv) >= 6 else 100
SPP = int(argv[6]) if len(argv) >= 7 else 40
os.makedirs(OUT, exist_ok=True)
FPS = 30


def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def ease(x):
    x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)


bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.eevee.taa_render_samples = SPP
for k, v in [('use_shadows', True), ('use_raytracing', False), ('shadow_resolution_scale', 1.0), ('shadow_ray_count', 2), ('shadow_step_count', 12), ('shadow_pool_size', '1024')]:
    try:
        setattr(sc.eevee, k, v)
    except Exception as e:
        print('skip', k, e)
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = RES
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'

world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (*srgb('#06080A'), 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 1.0


def mat(name, hexc, rough, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(hexc), 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = spec
    return m


WHITE = mat('white', '#F3F3F1', 0.9, 0.3)
PLINTH = mat('plinth', '#16181B', 0.32, 0.5)
FLOOR = mat('floor', '#060708', 0.7, 0.3)

bm = bmesh.new()


def box(x0, x1, y0, y1, z0, z1):
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
                          @ Matrix.Diagonal((x1 - x0, y1 - y0, z1 - z0, 1)))


def prism_x(x0, x1, y0, y1, prof):
    """沿 y 拉伸的 xz 剖面多边形（prof: [(x,z),...] 逆时针）"""
    f = [bm.verts.new((x, y0, z)) for x, z in prof]
    b = [bm.verts.new((x, y1, z)) for x, z in prof]
    bm.faces.new(f[::-1]); bm.faces.new(b)
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([f[i], f[j], b[j], b[i]])


def prism_y(x0, x1, y0, y1, prof):
    """沿 x 拉伸的 yz 剖面"""
    f = [bm.verts.new((x0, y, z)) for y, z in prof]
    b = [bm.verts.new((x1, y, z)) for y, z in prof]
    bm.faces.new(f); bm.faces.new(b[::-1])
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([f[j], f[i], b[i], b[j]])


for name, x0, x1, y0, y1, h, kind, prm in BUILDINGS:
    box(x0, x1, y0, y1, 0.0, h)
    if kind == 'saw':
        n, rise = prm['n'], prm['rise']
        xs = [x0 + (x1 - x0) * i / n for i in range(n + 1)]
        for a, b in zip(xs[:-1], xs[1:]):
            prism_x(a, b, y0, y1, [(a, h), (b, h), (a + 0.004, h + rise), (a, h + rise)])
    elif kind == 'gable':
        rise = prm['rise']
        if (x1 - x0) >= (y1 - y0):
            ym = (y0 + y1) / 2
            prism_y(x0, x1, y0, y1, [(y0, h), (y1, h), (ym, h + rise)])
        else:
            xm = (x0 + x1) / 2
            prism_x(x0, x1, y0, y1, [(x0, h), (x1, h), (xm, h + rise)])
    elif prm.get('parapet', 0) > 0:
        p, w = prm['parapet'], 0.005
        box(x0, x1, y0, y0 + w, h, h + p); box(x0, x1, y1 - w, y1, h, h + p)
        box(x0, x0 + w, y0, y1, h, h + p); box(x1 - w, x1, y0, y1, h, h + p)
c = CHIMNEY
bmesh.ops.create_cone(bm, cap_ends=True, segments=36, radius1=c['r0'], radius2=c['r1'], depth=c['h'],
                      matrix=Matrix.Translation((c['x'], c['y'], c['h'] / 2)))
box(*YARD, 0.0, 0.003)
# ---- 周边城区：近千栋，平顶/坡顶/塔楼 + 屋顶小构件 ----
for x0, x1, y0, y1, h, roof, extra in DISTRICT:
    box(x0, x1, y0, y1, 0.0, h)
    top = h
    if roof == 'gable':
        rise = min(x1 - x0, y1 - y0) * 0.32
        if (x1 - x0) >= (y1 - y0):
            prism_y(x0, x1, y0, y1, [(y0, h), (y1, h), ((y0 + y1) / 2, h + rise)])
        else:
            prism_x(x0, x1, y0, y1, [(x0, h), (x1, h), ((x0 + x1) / 2, h + rise)])
    elif roof == 'tower':
        box(x0 + 0.004, x1 - 0.004, y0 + 0.004, y1 - 0.004, h, h + 0.014); top = h + 0.014
    for ex0, ex1, ey0, ey1, eh in extra:
        box(ex0, ex1, ey0, ey1, top, top + eh)
# 桥
for bx, bw in BRIDGES:
    ry = river_y(bx)
    box(bx - bw, bx + bw, ry - RIVER_HALF - 0.012, ry + RIVER_HALF + 0.012, -0.0005, 0.004)
    for py in (ry - 0.03, ry + 0.03):
        box(bx - bw * 0.7, bx + bw * 0.7, py - 0.004, py + 0.004, -0.008, 0.0)
# 树（球冠 + 细干）
for x, y, r in TREES:
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r, matrix=Matrix.Translation((x, y, 0.004 + r * 0.95)))
    bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=0.0011, radius2=0.0011, depth=0.006,
                          matrix=Matrix.Translation((x, y, 0.003)))
# 陆地板（河道切开，两岸即驳岸）
XS = [PLATE[0] + (PLATE[1] - PLATE[0]) * i / 120 for i in range(121)]


def slab(poly, z0, z1):
    top = [bm.verts.new((x, y, z1)) for x, y in poly]
    bot = [bm.verts.new((x, y, z0)) for x, y in poly]
    bm.faces.new(top); bm.faces.new(bot[::-1])
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bot[i], bot[j], top[j], top[i]])


slab([(x, river_y(x) + RIVER_HALF) for x in XS] + [(PLATE[1], PLATE[3]), (PLATE[0], PLATE[3])], -0.008, 0.0)
slab([(x, river_y(x) - RIVER_HALF) for x in XS][::-1] + [(PLATE[0], PLATE[2]), (PLATE[1], PLATE[2])], -0.008, 0.0)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('model'); bm.to_mesh(me); bm.free()
model = bpy.data.objects.new('model', me); sc.collection.objects.link(model)
me.materials.append(WHITE)
bev = model.modifiers.new('bev', 'BEVEL'); bev.width = 0.0006; bev.segments = 1; bev.limit_method = 'ANGLE'
print('model faces', len(me.polygons))

WATER = mat('water', '#2A3036', 0.22, 0.6)
bm = bmesh.new(); box(PLATE[0], PLATE[1], PLATE[2], PLATE[3], -0.02, -0.008)
wme = bpy.data.meshes.new('water'); bm.to_mesh(wme); bm.free()
water = bpy.data.objects.new('water', wme); sc.collection.objects.link(water); wme.materials.append(WATER)

bpy.ops.mesh.primitive_cube_add(size=1)
plinth = bpy.context.active_object
plinth.scale = ((PLATE[1] - PLATE[0]) + 0.14, (PLATE[3] - PLATE[2]) + 0.14, 0.58)
plinth.location = (0, 0, -0.02 - 0.29)
plinth.data.materials.append(PLINTH)
pb = plinth.modifiers.new('bev', 'BEVEL'); pb.width = 0.004; pb.segments = 2
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.6))
bpy.context.active_object.data.materials.append(FLOOR)

# 房间灯（开场亮，0.85s 继电器切暗）
house = bpy.data.lights.new('house', 'AREA'); house.size = 3.6; house.color = (1.0, 0.97, 0.93)
ho = bpy.data.objects.new('house', house); sc.collection.objects.link(ho)
ho.location = (-2.3, -2.5, 3.4); ho.rotation_euler = (-ho.location).to_track_quat('-Z', 'Y').to_euler()
HOUSE_E = 230.0
amb = bpy.data.lights.new('amb', 'AREA'); amb.size = 4.0; amb.energy = 9; amb.color = (0.85, 0.9, 1.0)
ao_ = bpy.data.objects.new('amb', amb); sc.collection.objects.link(ao_); ao_.location = (2.6, 1.9, 3.1)
ao_.rotation_euler = (-ao_.location).to_track_quat('-Z', 'Y').to_euler()

# 投影机：带逐帧贴图的聚光灯
pj = bpy.data.lights.new('projector', 'SPOT')
pj.energy = 500.0
pj.spot_size = 2 * math.atan(math.sqrt(2) * math.tan(PROJ_HALF)) + 0.02
pj.spot_blend = 0.0; pj.shadow_soft_size = 0.002
try:
    pj.shadow_maximum_resolution = 0.00012
except Exception as e:
    print('skip shadow res', e)
proj_img = bpy.data.images.load(os.path.join(PROJ, '0001.png'))
k = 1 / math.tan(PROJ_HALF)
pframe = bpy.data.objects.new('proj_frame', None); sc.collection.objects.link(pframe)


def proj_material(name, gain):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; Lk = nt.links
    b = N['Principled BSDF']; b.inputs['Roughness'].default_value = 0.9; b.inputs['Specular IOR Level'].default_value = 0.25
    tc = N.new('ShaderNodeTexCoord'); tc.object = pframe
    sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(tc.outputs['Object'], sep.inputs[0])
    nz = N.new('ShaderNodeMath'); nz.operation = 'MULTIPLY'; nz.inputs[1].default_value = -1.0; Lk.new(sep.outputs[2], nz.inputs[0])
    uv = []
    for comp in (0, 1):
        dv = N.new('ShaderNodeMath'); dv.operation = 'DIVIDE'; Lk.new(sep.outputs[comp], dv.inputs[0]); Lk.new(nz.outputs[0], dv.inputs[1])
        ma = N.new('ShaderNodeMath'); ma.operation = 'MULTIPLY_ADD'; ma.inputs[1].default_value = 0.5 * k; ma.inputs[2].default_value = 0.5
        Lk.new(dv.outputs[0], ma.inputs[0]); uv.append(ma)
    cmb = N.new('ShaderNodeCombineXYZ'); Lk.new(uv[0].outputs[0], cmb.inputs[0]); Lk.new(uv[1].outputs[0], cmb.inputs[1])
    ti = N.new('ShaderNodeTexImage'); ti.image = proj_img; ti.extension = 'CLIP'; ti.interpolation = 'Linear'
    Lk.new(cmb.outputs[0], ti.inputs[0])
    g = N.new('ShaderNodeMix'); g.data_type = 'RGBA'; g.blend_type = 'MULTIPLY'; g.inputs['Factor'].default_value = 1
    g.inputs[7].default_value = (gain, gain, gain, 1)
    Lk.new(ti.outputs[0], g.inputs[6]); Lk.new(g.outputs[2], b.inputs['Base Color'])
    return m


PROJ_WHITE = proj_material('proj_white', 0.9)
PROJ_DARK = proj_material('proj_plinth', 0.07)
PROJ_WATER = proj_material('proj_water', 0.32)
po = bpy.data.objects.new('projector', pj); sc.collection.objects.link(po)
bx, by_, bz = proj_basis()
po.matrix_world = Matrix(((bx[0], by_[0], bz[0], PROJ_POS[0]), (bx[1], by_[1], bz[1], PROJ_POS[1]),
                          (bx[2], by_[2], bz[2], PROJ_POS[2]), (0, 0, 0, 1)))
pframe.matrix_world = po.matrix_world.copy()

# 投影遍用的同网格副本（对象级材质）
def twin(ob, m):
    o2 = bpy.data.objects.new(ob.name + '_proj', ob.data); sc.collection.objects.link(o2)
    o2.matrix_world = ob.matrix_world.copy()
    for md in ob.modifiers:
        n2 = o2.modifiers.new(md.name, md.type); n2.width = md.width; n2.segments = md.segments
        if hasattr(md, 'limit_method'): n2.limit_method = md.limit_method
    o2.material_slots[0].link = 'OBJECT'; o2.material_slots[0].material = m
    return o2


floor_ob = [o for o in sc.objects if o.type == 'MESH' and o.data.materials and o.data.materials[0] == FLOOR][0]
model_p = twin(model, PROJ_WHITE); plinth_p = twin(plinth, PROJ_DARK); water_p = twin(water, PROJ_WATER)
BASE_SET = [model, water, plinth, floor_ob, ho, ao_]
PROJ_SET = [model_p, water_p, plinth_p, po]

# 相机：浅角度连续绕行
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 50; cam_d.clip_start = 0.05
cam_d.dof.use_dof = True; cam_d.dof.aperture_fstop = 5.6
cam = bpy.data.objects.new('cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam
def place_camera(t):
    """缓慢推近 + 绕行：全城区 → 厂区与周边街区"""
    u = t / 8.0
    s_ = 0.55 * u + 0.45 * ease(u)
    tgt = Vector((0.0 + 0.03 * s_, -0.04 + 0.05 * s_, 0.015))
    hd = math.radians(-30 + 40 * s_)
    pt = math.radians(41 - 9 * s_)
    dist = 3.25 - 1.6 * s_
    pos = tgt + dist * Vector((math.cos(pt) * math.sin(hd), -math.cos(pt) * math.cos(hd), math.sin(pt)))
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    cam_d.dof.focus_distance = (tgt - pos).length


def roof_center(name):
    b = building(name)
    return Vector(((b[1] + b[2]) / 2, (b[3] + b[4]) / 2, roof_top(b)))


PINS = {'hallA': roof_center('hallA'), 'ware2': roof_center('ware2'), 'yard': Vector(((YARD[0] + YARD[1]) / 2, (YARD[2] + YARD[3]) / 2, 0.004)),
        'hallB': roof_center('hallB'), 'chimney': Vector((CHIMNEY['x'], CHIMNEY['y'], CHIMNEY['h']))}
meta = {}
for f in range(F0, F1 + 1, FS):
    t = f / FPS
    place_camera(t)
    cut = ease((t - 0.85) / 0.25)
    house.energy = HOUSE_E * (1 - 0.76 * cut)
    proj_img.filepath = os.path.join(PROJ, f'{f + 1:04d}.png'); proj_img.reload()
    sc.frame_set(f + 1)
    meta[f + 1] = {k: list(world_to_camera_view(sc, cam, v)) for k, v in PINS.items()}
    for pass_name, on, off, wstr in (('base', BASE_SET, PROJ_SET, 1.0), ('proj', PROJ_SET, BASE_SET, 0.0)):
        for o in on: o.hide_render = False
        for o in off: o.hide_render = True
        world.node_tree.nodes['Background'].inputs[1].default_value = wstr
        os.makedirs(os.path.join(OUT, pass_name), exist_ok=True)
        sc.render.filepath = os.path.join(OUT, pass_name, f'{f + 1:04d}.png')
        bpy.ops.render.render(write_still=True)
    print('FRAME', f + 1, flush=True)
json.dump(meta, open(os.path.join(OUT, f'meta_{F0}_{F1}_{FS}.json'), 'w'))
print('DONE')
