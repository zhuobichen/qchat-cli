# S29 产品爆炸拆解 B v2：无品牌旁轴数码相机，精细建模版（Blender 5.2 EEVEE）
# 模型单位 = 毫米，根节点缩放 0.01（机身 132 mm 在世界里是 1.32 单位），便于微距推近与景深。
# 零件：镁合金机芯；镀铬顶/底盖（滚花速度盘、快门钮、回卷钮、热靴、取景窗、目镜）；皮纹前壳；后壳（屏幕/按键/拨轮）；
#      十组镜头（五枚带镀膜色的镜片与涂黑边、卡口与螺丝、九片可开合光圈叶片、滚花光圈环、橡胶对焦环）；
#      纵走焦平面快门（四片叶片开合）；感光元件（陶瓷封装、晶片、金焊盘、键合线、盖玻璃）；
#      主板与感光板（pcb_tex.py 生成的 8K/4K 版图 + 贴片元件、QFP 鸥翼引脚、BGA 焊球、焊锡角）；软排线逐帧弯折；十字螺丝。
# 运动全部是确定性函数（无物理缓存）。逐帧输出 PNG 与标注锚点 meta。
# 用法: blender -b -P scene.py -- <raw_dir> <tex_dir> [start end step] [res_percent] [samples]
import bpy, bmesh, sys, os, math, json, random
from mathutils import Vector, Matrix
from bpy_extras.object_utils import world_to_camera_view

argv = sys.argv[sys.argv.index('--') + 1:]
OUT, TEX = argv[0], argv[1]
F0, F1, FSTEP = (int(argv[2]), int(argv[3]), int(argv[4])) if len(argv) >= 5 else (0, 239, 1)
RES = int(argv[5]) if len(argv) >= 6 else 100
SPP = int(argv[6]) if len(argv) >= 7 else 48
os.makedirs(OUT, exist_ok=True)
FPS = 30
U = 0.01                       # mm → 世界单位
AX, AZ = 10.0, -2.0            # 光轴位置（模型 x,z），光轴沿 -Y 指向前方
rng = random.Random(29)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.eevee.taa_render_samples = SPP
for k, v in [('use_raytracing', True), ('ray_tracing_method', 'SCREEN'), ('use_shadows', True), ('shadow_ray_count', 2),
             ('shadow_step_count', 10), ('shadow_resolution_scale', 1.0), ('use_fast_gi', True)]:
    try:
        setattr(sc.eevee, k, v)
    except Exception as e:
        print('skip', k, e)
try:
    sc.eevee.ray_tracing_options.resolution_scale = '1'
except Exception as e:
    print('skip rt opts', e)
sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
sc.render.resolution_percentage = RES
sc.view_settings.view_transform = 'AgX'
try:
    sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'


def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def ease3(x):
    x = min(max(x, 0.0), 1.0)
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def ease(x):
    x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)


# ======================= 材质 =======================
def P(name, col, rough=0.4, metal=0.0, **kw):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*srgb(col), 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    for k, v in kw.items():
        try:
            b.inputs[k].default_value = v
        except Exception as e:
            print('mat input skip', name, k, e)
    return m


def add_noise_rough(m, scale, lo, hi, stretch=(1, 1, 1)):
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = stretch
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 8
    mr = N.new('ShaderNodeMapRange'); mr.inputs[3].default_value = lo; mr.inputs[4].default_value = hi
    L.new(tc.outputs['Object'], mp.inputs[0]); L.new(mp.outputs[0], nz.inputs[0]); L.new(nz.outputs['Fac'], mr.inputs[0])
    L.new(mr.outputs[0], b.inputs['Roughness'])


def add_bump(m, kind, scale, strength, dist=0.02):
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    tx = N.new('ShaderNodeTexVoronoi' if kind == 'voronoi' else 'ShaderNodeTexNoise')
    tx.inputs['Scale'].default_value = scale
    L.new(tc.outputs['Object'], tx.inputs['Vector'])
    bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = strength; bp.inputs['Distance'].default_value = dist
    L.new(tx.outputs['Distance' if kind == 'voronoi' else 'Fac'], bp.inputs['Height']); L.new(bp.outputs[0], b.inputs['Normal'])


M_CHROME = P('chrome', '#D9DADC', 0.2, 1.0, **{'Anisotropic': 0.55})
add_noise_rough(M_CHROME, 0.6, 0.14, 0.28, (1, 1, 80))
M_MAG = P('magnesium', '#5E6166', 0.45, 0.75); add_noise_rough(M_MAG, 2.0, 0.38, 0.55)
M_LEATHER = P('leather', '#161616', 0.72); add_bump(M_LEATHER, 'voronoi', 1.6, 0.55, 0.15)
M_BLACK = P('blackpaint', '#0E0E0F', 0.38, 0.0, **{'Coat Weight': 0.25, 'Coat Roughness': 0.2})
M_RUBBER = P('rubber', '#121212', 0.86)
M_BLADE = P('blade', '#26282C', 0.3, 0.55)
M_LCD = P('lcd', '#030405', 0.05, 0.0, **{'Coat Weight': 1.0, 'Coat Roughness': 0.01})
M_GOLD = P('gold', '#D8A84E', 0.28, 1.0)
M_TIN = P('tin', '#C9CACB', 0.22, 1.0)
M_SOLDER = P('solder', '#D5D6D2', 0.12, 1.0)
M_EPOXY = P('epoxy', '#171718', 0.5, 0.0, **{'Coat Weight': 0.15, 'Coat Roughness': 0.4})
add_bump(M_EPOXY, 'noise', 6.0, 0.08, 0.01)
M_CAP = P('ceramic_cap', '#8C6F4C', 0.55)
M_RES = P('resistor', '#1D1D1D', 0.45)
M_RESTOP = P('resistor_top', '#DADAD2', 0.5)
M_FERRITE = P('ferrite', '#3A3B3E', 0.55, 0.2)
M_CAN = P('xtal_can', '#B9BBBE', 0.18, 1.0)
M_CONN = P('conn_plastic', '#D9CBA4', 0.5)
M_CONNBLK = P('conn_black', '#18181A', 0.45)
M_FR4 = P('fr4_edge', '#9C9A63', 0.6)
M_SUBSTRATE = P('bga_substrate', '#3C4A2C', 0.45)
M_CERAMIC = P('ceramic_pkg', '#3A3431', 0.6)
M_SCREW = P('screw', '#2B2C2E', 0.32, 1.0)
M_SCREW_C = P('screw_chrome', '#BFC1C4', 0.2, 1.0)
M_RECESS = P('recess', '#050505', 0.6)
M_ACCENT = P('accent', '#FF6B3D', 0.35)
M_STANDOFF = P('standoff', '#B49A62', 0.3, 1.0)
M_COIL = P('coil', '#B8692E', 0.3, 1.0)


def glass(name, tint, coat):
    m = P(name, tint, 0.0, 0.0, **{'Transmission Weight': 1.0, 'IOR': 1.56, 'Specular Tint': (*srgb(coat), 1),
                                    'Coat Weight': 0.35, 'Coat IOR': 1.38, 'Coat Roughness': 0.0})
    for k, v in [('Thin Film Thickness', 420.0), ('Thin Film IOR', 1.38)]:
        try:
            m.node_tree.nodes['Principled BSDF'].inputs[k].default_value = v
        except Exception:
            pass
    for attr, v in (('use_raytrace_refraction', True), ('surface_render_method', 'DITHERED')):
        try:
            setattr(m, attr, v)
        except Exception:
            pass
    return m


M_GLASS = [glass('glass_e1', '#F4FBF8', '#B48CFF'), glass('glass_e2', '#F5FAFF', '#7CFFB0'),
           glass('glass_e3', '#FBF7FF', '#FFB46B'), glass('glass_e4', '#F6FFF9', '#8FA8FF'),
           glass('glass_e5', '#FFFDF6', '#C6FF7A')]
M_LID = glass('sensor_lid', '#F8FFFB', '#7CF0FF')
M_WINDOW = glass('vf_window', '#EEF3F6', '#9FD0FF')
M_FROST = P('frosted', '#E8EAEC', 0.45)

# 感光晶片：随视角变化的衍射彩光 + 微透镜栅格
M_DIE = P('die', '#3A2E4A', 0.16, 0.7)
_nt = M_DIE.node_tree; _N = _nt.nodes; _L = _nt.links; _b = _N['Principled BSDF']
_lw = _N.new('ShaderNodeLayerWeight'); _lw.inputs['Blend'].default_value = 0.35
_cr = _N.new('ShaderNodeValToRGB')
_cr.color_ramp.elements[0].color = (*srgb('#3B2A6E'), 1); _cr.color_ramp.elements[1].color = (*srgb('#C8A04A'), 1)
for pos, h in [(0.3, '#2E8A6A'), (0.55, '#7A3E9C'), (0.78, '#2F6FB8')]:
    e = _cr.color_ramp.elements.new(pos); e.color = (*srgb(h), 1)
_L.new(_lw.outputs['Facing'], _cr.inputs[0]); _L.new(_cr.outputs[0], _b.inputs['Base Color'])
_tc = _N.new('ShaderNodeTexCoord'); _wv = _N.new('ShaderNodeTexWave'); _wv.inputs['Scale'].default_value = 3.0
_wv.inputs['Distortion'].default_value = 0.0
_L.new(_tc.outputs['Object'], _wv.inputs['Vector'])
_bp = _N.new('ShaderNodeBump'); _bp.inputs['Strength'].default_value = 0.25; _bp.inputs['Distance'].default_value = 0.01
_L.new(_wv.outputs['Fac'], _bp.inputs['Height']); _L.new(_bp.outputs[0], _b.inputs['Normal'])

# 软排线：聚酰亚胺 + 铜线条纹（UV u 跨宽度）
M_FLEX = P('flex', '#C0701E', 0.3, 0.0, **{'Coat Weight': 0.6, 'Coat Roughness': 0.08})
_nt = M_FLEX.node_tree; _N = _nt.nodes; _L = _nt.links; _b = _N['Principled BSDF']
_uv = _N.new('ShaderNodeUVMap'); _sx = _N.new('ShaderNodeSeparateXYZ'); _L.new(_uv.outputs[0], _sx.inputs[0])
_m1 = _N.new('ShaderNodeMath'); _m1.operation = 'MULTIPLY'; _m1.inputs[1].default_value = 16.0; _L.new(_sx.outputs[0], _m1.inputs[0])
_m2 = _N.new('ShaderNodeMath'); _m2.operation = 'PINGPONG'; _m2.inputs[1].default_value = 0.5; _L.new(_m1.outputs[0], _m2.inputs[0])
_m3 = _N.new('ShaderNodeMath'); _m3.operation = 'GREATER_THAN'; _m3.inputs[1].default_value = 0.32; _L.new(_m2.outputs[0], _m3.inputs[0])
_mx = _N.new('ShaderNodeMix'); _mx.data_type = 'RGBA'
_mx.inputs[6].default_value = (*srgb('#B5621A'), 1); _mx.inputs[7].default_value = (*srgb('#E3A35A'), 1)
_L.new(_m3.outputs[0], _mx.inputs['Factor']); _L.new(_mx.outputs[2], _b.inputs['Base Color'])


def pcb_material(name, tex):
    m = P(name, '#2B6A3A', 0.35, 0.0, **{'Coat Weight': 0.35, 'Coat Roughness': 0.12})
    nt = m.node_tree; N = nt.nodes; L = nt.links; b = N['Principled BSDF']
    uv = N.new('ShaderNodeUVMap')
    ic = N.new('ShaderNodeTexImage'); ic.image = bpy.data.images.load(os.path.join(TEX, f'{tex}_color.png')); ic.interpolation = 'Cubic'
    ir = N.new('ShaderNodeTexImage'); ir.image = bpy.data.images.load(os.path.join(TEX, f'{tex}_rmh.png'))
    ir.image.colorspace_settings.name = 'Non-Color'; ir.interpolation = 'Cubic'
    L.new(uv.outputs[0], ic.inputs[0]); L.new(uv.outputs[0], ir.inputs[0])
    sp = N.new('ShaderNodeSeparateColor'); L.new(ir.outputs[0], sp.inputs[0])
    L.new(ic.outputs[0], b.inputs['Base Color'])
    rr = N.new('ShaderNodeMapRange'); rr.inputs[3].default_value = 0.08; rr.inputs[4].default_value = 0.9
    L.new(sp.outputs[0], rr.inputs[0]); L.new(rr.outputs[0], b.inputs['Roughness'])
    L.new(sp.outputs[1], b.inputs['Metallic'])
    inv = N.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 0.4; L.new(sp.outputs[1], inv.inputs[1])
    L.new(inv.outputs[0], b.inputs['Coat Weight'])
    bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35; bp.inputs['Distance'].default_value = 0.04
    L.new(sp.outputs[2], bp.inputs['Height']); L.new(bp.outputs[0], b.inputs['Normal'])
    return m


M_PCB = pcb_material('pcb_main', 'main')
M_PCBS = pcb_material('pcb_sensor', 'sensor')

# ======================= 建模工具 =======================
col = sc.collection
ROOT = bpy.data.objects.new('ROOT', None); col.objects.link(ROOT); ROOT.scale = (U, U, U)


def empty(name, parent=ROOT, loc=(0, 0, 0), rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None); col.objects.link(e); e.parent = parent
    e.location = loc; e.rotation_euler = rot
    return e


def mesh_obj(name, bm, mats, parent, smooth=False, bevel=0.0, seg=2):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5) if bevel > 0 else None
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new(name, me); col.objects.link(ob); ob.parent = parent
    if bevel > 0:
        md = ob.modifiers.new('bev', 'BEVEL'); md.width = bevel; md.segments = seg; md.limit_method = 'ANGLE'
        md.angle_limit = math.radians(35)
        try:
            md.harden_normals = True
        except Exception:
            pass
    return ob


def faces_of(verts):
    return {f for v in verts for f in v.link_faces}


def box(bm, x0, x1, y0, y1, z0, z1, mi=0):
    x0, x1 = min(x0, x1), max(x0, x1); y0, y1 = min(y0, y1), max(y0, y1); z0, z1 = min(z0, z1), max(z0, z1)
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
                              @ Matrix.Diagonal((max(x1 - x0, 1e-4), max(y1 - y0, 1e-4), max(z1 - z0, 1e-4), 1)))
    for f in faces_of(r['verts']):
        f.material_index = mi
    return r['verts']


def obox(bm, cx, cy, cz, sx, sy, sz, rz=0.0, mi=0):
    """绕 z 旋转的盒子（中心 + 尺寸）"""
    r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation((cx, cy, cz)) @ Matrix.Rotation(rz, 4, 'Z')
                              @ Matrix.Diagonal((sx, sy, sz, 1)))
    for f in faces_of(r['verts']):
        f.material_index = mi
    return r['verts']


def lathe(bm, segs, n=96, mi=0, rmod=None, cx=0.0, cy=0.0):
    """绕局部 z 轴（平移到 cx,cy）的旋转体。segs: 轮廓折线列表 [(r,z),...]；rmod(i, k_seg, r) 按角度改半径（滚花）。"""
    for si, seg in enumerate(segs):
        rows = []
        for (r, z) in seg:
            row = []
            for i in range(n):
                a = 2 * math.pi * i / n
                rr = rmod(i, si, r) if rmod else r
                row.append(bm.verts.new((cx + rr * math.cos(a), cy + rr * math.sin(a), z)))
            rows.append(row)
        for k in range(len(rows) - 1):
            for i in range(n):
                j = (i + 1) % n
                vs = [rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]]
                if len({v.co.to_tuple(6) for v in vs}) < 3:
                    continue
                try:
                    f = bm.faces.new(vs); f.material_index = mi
                except ValueError:
                    pass


def ring_segs(r_in, r_out, z0, z1):
    return [[(r_in, z0), (r_out, z0)], [(r_out, z0), (r_out, z1)], [(r_out, z1), (r_in, z1)], [(r_in, z1), (r_in, z0)]]


def disc_segs(r, z0, z1):
    return [[(0, z0), (r, z0)], [(r, z0), (r, z1)], [(r, z1), (0, z1)]]


def knurl_on(seg_ids, depth, period=2):
    return lambda i, k, r: r - depth * (1 if (i % period) else 0) if k in seg_ids else r


def boolean_cut(ob, cutter):
    md = ob.modifiers.new('cut', 'BOOLEAN'); md.operation = 'DIFFERENCE'; md.object = cutter
    try:
        md.solver = 'EXACT'
    except Exception:
        pass
    cutter.hide_render = True; cutter.display_type = 'WIRE'
    bev = ob.modifiers.get('bev')                       # 倒角挪到布尔之后
    if bev:
        w, s = bev.width, bev.segments
        ob.modifiers.remove(bev)
        md = ob.modifiers.new('bev', 'BEVEL'); md.width = w; md.segments = s; md.limit_method = 'ANGLE'
        md.angle_limit = math.radians(35)


def cyl_cutter(name, parent, cx, cy, cz, r, depth):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=128, radius1=r, radius2=r, depth=depth)
    ob = mesh_obj(name, bm, [M_BLACK], parent)
    ob.location = (cx, cy, cz); ob.rotation_euler = (math.radians(90), 0, 0)
    return ob


def box_cutter(name, parent, x0, x1, y0, y1, z0, z1):
    bm = bmesh.new(); box(bm, x0, x1, y0, y1, z0, z1)
    return mesh_obj(name, bm, [M_BLACK], parent)


def screw(name, parent, loc, rot, head_r=2.1, length=6.0, mat=M_SCREW):
    """十字盘头螺丝：局部 +z 为头部朝向，螺纹沿 -z。"""
    bm = bmesh.new()
    dome = [(head_r, 0.55)] + [(head_r * math.cos(a), 0.55 + 0.75 * math.sin(a)) for a in [k * math.pi / 20 for k in range(1, 11)]]
    lathe(bm, [[(0.0, 0.0), (head_r * 0.98, 0.0)], [(head_r * 0.98, 0.0), (head_r, 0.15), (head_r, 0.55)], dome], n=40)
    thread = [(1.0 + 0.16 * math.cos(2 * math.pi * z / 0.4), -z) for z in [k * 0.05 for k in range(int(length / 0.05) + 1)]]
    lathe(bm, [thread, [(1.0, -length), (0.0, -length - 0.3)]], n=24)
    for rz in (0.0, math.pi / 2):
        obox(bm, 0, 0, 1.2, head_r * 1.15, 0.42, 0.5, rz, mi=1)
    ob = mesh_obj(name, bm, [mat, M_RECESS], parent, smooth=True)
    ob.location = loc; ob.rotation_euler = rot
    return ob


# ======================= 机身 =======================
G = {name: empty('G_' + name) for name in ['top', 'bottom', 'front', 'rear', 'shutter', 'sensor', 'pcb']}

# 1) 机芯（不动）：前隔板（镜头孔）、两侧片仓、上下导轨、后框（感光窗）、主板铜柱
bm = bmesh.new(); box(bm, -60, 60, -14, -11, -34, 34)
chassis_front = mesh_obj('chassis_front', bm, [M_MAG], ROOT, bevel=0.4)
boolean_cut(chassis_front, cyl_cutter('cut_front', ROOT, AX, -12.5, AZ, 22.0, 6))
bm = bmesh.new()
box(bm, -60, 60, -11, 8, 31.5, 34); box(bm, -60, 60, -11, 7.6, -34, -31.5)
for sx in (-1, 1):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=72, radius1=11.5, radius2=11.5, depth=63,
                          matrix=Matrix.Translation((sx * 49.5, -1.5, 0)))
mesh_obj('chassis_body', bm, [M_MAG], ROOT, bevel=0.3)
bm = bmesh.new(); box(bm, -36, 36, 7.7, 8.5, -26, 31.5)
chassis_rear = mesh_obj('chassis_rear', bm, [M_MAG], ROOT, bevel=0.2)
boolean_cut(chassis_rear, box_cutter('cut_rear', ROOT, AX - 19, AX + 19, 6, 12, AZ - 14, AZ + 12))
for hx, hy in [(-51, -24), (51, -24), (-51, 24), (51, 24)]:
    b2 = bmesh.new(); lathe(b2, ring_segs(1.1, 2.5, 0.0, 9.0), n=32)
    s = mesh_obj('standoff', b2, [M_STANDOFF], ROOT, smooth=True); s.location = (hx, 11.0, AZ + hy); s.rotation_euler = (math.radians(90), 0, 0)

# 2) 顶盖（镀铬，+Z）
bm = bmesh.new(); box(bm, -66, 66, -17, 16, 34, 46)
mesh_obj('top_shell', bm, [M_CHROME], G['top'], bevel=1.6, seg=4)
bm = bmesh.new()
box(bm, -49, -35, -17.6, -16.9, 37.5, 43.5, 0)            # 测距窗
box(bm, 37, 53, -17.6, -16.9, 37.0, 43.8, 0)              # 取景窗
box(bm, 26, 33, -17.6, -16.9, 38.5, 42.5, 1)              # 框线采光窗（磨砂）
box(bm, -50, -34, -17.3, -16.95, 36.6, 44.4, 2); box(bm, 36, 54, -17.3, -16.95, 36.1, 44.7, 2)
mesh_obj('top_windows', bm, [M_WINDOW, M_FROST, M_BLACK], G['top'])
bm = bmesh.new()                                          # 快门速度盘（滚花，顶面刻度点，无数字）
lathe(bm, [[(0, 46), (11.0, 46)], [(11.0, 46), (11.0, 51.5)], [(11.0, 51.5), (9.6, 52.2)], [(9.6, 52.2), (0, 52.2)]],
      n=144, rmod=knurl_on({1}, 0.45), cx=34, cy=0)
for k in range(12):
    a = 2 * math.pi * k / 12
    obox(bm, 34 + 7.6 * math.cos(a), 7.6 * math.sin(a), 52.25, 1.4 if k % 3 == 0 else 0.7, 0.35, 0.12, a, mi=1)
mesh_obj('speed_dial', bm, [M_CHROME, M_BLACK], G['top'], smooth=True)
bm = bmesh.new()                                          # 快门钮 + 护圈
lathe(bm, [[(0, 46), (6.0, 46)], [(6.0, 46), (6.0, 48.0)], [(6.0, 48.0), (4.6, 48.0)], [(4.6, 48.0), (4.6, 49.8)],
           [(4.6, 49.8), (4.2, 50.3)], [(4.2, 50.3), (0, 50.5)]], n=96, rmod=knurl_on({1}, 0.25), cx=52, cy=3)
lathe(bm, [[(0, 50.52), (1.2, 50.52)]], n=24, mi=1, cx=52, cy=3)
mesh_obj('shutter_button', bm, [M_CHROME, M_RECESS], G['top'], smooth=True)
bm = bmesh.new()                                          # 回卷钮 + 折叠摇把
lathe(bm, [[(0, 46), (8.5, 46)], [(8.5, 46), (8.5, 52)], [(8.5, 52), (7.8, 52.6)], [(7.8, 52.6), (0, 52.6)]],
      n=120, rmod=knurl_on({1}, 0.5), cx=-46, cy=0)
obox(bm, -46, 3.5, 52.9, 2.2, 9.0, 0.6, 0.0)
mesh_obj('rewind_knob', bm, [M_CHROME], G['top'], smooth=True)
bm = bmesh.new()                                          # 热靴
box(bm, -9, 9, -10, 10, 46, 46.8)
for sx in (-1, 1):
    box(bm, sx * 9, sx * 7.8, -10, 10, 46.8, 48.6)
    box(bm, sx * 9, sx * 7.0, -10, 10, 48.6, 49.2)
lathe(bm, [[(0, 46.85), (1.6, 46.85)]], n=32, mi=1)
mesh_obj('hot_shoe', bm, [M_CHROME, M_GOLD], G['top'], bevel=0.15)
bm = bmesh.new(); lathe(bm, ring_segs(6.0, 8.6, 0, 4.0), n=64, mi=0); lathe(bm, disc_segs(6.0, 0.2, 0.6), n=64, mi=1)
ep = mesh_obj('eyepiece', bm, [M_RUBBER, M_WINDOW], G['top'], smooth=True); ep.location = (45, 16, 40.5); ep.rotation_euler = (math.radians(-90), 0, 0)
for sx in (-1, 1):
    screw('top_screw', G['top'], (sx * 66.05, 0, 40), (0, math.radians(90 * sx), 0), head_r=1.5, length=3, mat=M_SCREW_C)

# 3) 底盖（镀铬，−Z）+ 三脚架孔 + 四颗螺丝
bm = bmesh.new(); box(bm, -66, 66, -17, 16, -46, -36)
mesh_obj('bottom_shell', bm, [M_CHROME], G['bottom'], bevel=1.6, seg=4)
bm = bmesh.new()
lathe(bm, ring_segs(3.2, 5.6, -46.4, -45.9), n=64)
lathe(bm, [[(3.2, -45.95), (3.2, -42)]], n=64, mi=1, rmod=knurl_on({0}, 0.18))
mesh_obj('tripod_socket', bm, [M_CHROME, M_BLACK], G['bottom'], smooth=True)
BOTTOM_SCREWS = []
for sx in (-1, 1):
    for sy in (-1, 1):
        s = screw('bottom_screw', G['bottom'], (sx * 57, sy * 9, -46.05), (math.radians(180), 0, 0), head_r=1.9, length=8, mat=M_SCREW_C)
        BOTTOM_SCREWS.append((s, Vector(s.location), Vector((0, 0, -1))))

# 4) 前壳（皮纹，−Y）
bm = bmesh.new(); box(bm, -62, 62, -19, -14, -34, 34)
front = mesh_obj('front_shell', bm, [M_LEATHER], G['front'], bevel=0.8, seg=3)
boolean_cut(front, cyl_cutter('cut_shell', G['front'], AX, -16.5, AZ, 25.0, 8))
bm = bmesh.new(); lathe(bm, ring_segs(25.0, 27.0, 0, 1.2), n=128)
fr = mesh_obj('front_bezel', bm, [M_CHROME], G['front'], smooth=True); fr.location = (AX, -19.0, AZ); fr.rotation_euler = (math.radians(90), 0, 0)
bm = bmesh.new(); lathe(bm, [[(0, 0), (3.0, 0)], [(3.0, 0), (3.0, 1.6)], [(3.0, 1.6), (0, 2.0)]], n=48)
lr = mesh_obj('release_button', bm, [M_CHROME], G['front'], smooth=True); lr.location = (AX + 31, -19.0, AZ + 6); lr.rotation_euler = (math.radians(90), 0, 0)
bm = bmesh.new(); obox(bm, -40, -19.6, 22, 7, 1.2, 3, 0.3)
mesh_obj('selftimer_lever', bm, [M_CHROME], G['front'], bevel=0.3)

# 5) 后壳（+Y）：屏幕、按键、拨轮
bm = bmesh.new(); box(bm, -64, 64, 15, 20, -34, 34)
mesh_obj('rear_shell', bm, [M_BLACK], G['rear'], bevel=1.0, seg=3)
bm = bmesh.new(); box(bm, -44, 20, 20.0, 20.4, -26, 18, 0); box(bm, -45.5, 21.5, 19.9, 20.25, -27.5, 19.5, 1)
mesh_obj('rear_lcd', bm, [M_LCD, M_BLACK], G['rear'], bevel=0.25)
for bx, bz in [(36, 8), (36, -2), (36, -12), (48, -2), (30, 22)]:
    bm = bmesh.new(); lathe(bm, [[(0, 0), (3.1, 0)], [(3.1, 0), (3.1, 1.6)], [(3.1, 1.6), (2.6, 2.0)], [(2.6, 2.0), (0, 2.0)]], n=40)
    b_ = mesh_obj('rear_button', bm, [M_CHROME], G['rear'], smooth=True); b_.location = (bx, 20.0, bz); b_.rotation_euler = (math.radians(-90), 0, 0)
bm = bmesh.new(); lathe(bm, [[(0, 0), (7.0, 0)], [(7.0, 0), (7.0, 4)], [(7.0, 4), (0, 4)]], n=120, rmod=knurl_on({1}, 0.35))
wh = mesh_obj('rear_dial', bm, [M_CHROME], G['rear'], smooth=True); wh.location = (52, 20.0, 22); wh.rotation_euler = (math.radians(-90), 0, 0)

# ======================= 镜头（10 组，沿光轴向前拆） =======================
LENS = empty('LENS', ROOT, (AX, 0, AZ), (math.radians(90), 0, 0))   # 局部 +z = 世界 −Y（向前）
LG, LENS_SPEC = {}, []


def lens_group(key, dist, t0):
    LG[key] = empty('LG_' + key, LENS); LENS_SPEC.append((key, dist, t0)); return LG[key]


def element(parent, name, r, zc, e, b1, b2, mat):
    """抛物面近似的单透镜：b1 前表面拱高（+ 凸），b2 后表面拱高（+ 凸）"""
    bm = bmesh.new(); n = 18
    back = [(r * k / n, zc - e / 2 - b2 * (1 - (k / n) ** 2)) for k in range(n + 1)]
    frontp = [(r * k / n, zc + e / 2 + b1 * (1 - (k / n) ** 2)) for k in range(n, -1, -1)]
    lathe(bm, [back, [(r, back[-1][1]), (r, frontp[0][1])], frontp], n=96)
    ob = mesh_obj(name, bm, [mat], parent, smooth=True)
    bm = bmesh.new(); lathe(bm, [[(r + 0.02, back[-1][1] + 0.1), (r + 0.02, frontp[0][1] - 0.1)]], n=96)
    mesh_obj(name + '_edge', bm, [M_BLACK], parent, smooth=True)    # 镜片边缘涂黑
    return ob


def cell(parent, name, r0, r1, z0, z1):
    bm = bmesh.new(); lathe(bm, ring_segs(r0, r1, z0, z1), n=96)
    # 压圈上的两道细槽
    lathe(bm, [[(r1 + 0.01, z1 - 0.9), (r1 + 0.01, z1 - 0.6)]], n=96, mi=1)
    return mesh_obj(name, bm, [M_BLACK, M_RECESS], parent, smooth=True, bevel=0.15)


# 卡口环（镀铬 + 三个卡爪 + 四颗螺丝）
g = lens_group('mount', 10, 1.85)
bm = bmesh.new(); lathe(bm, ring_segs(19.5, 24.0, 19.0, 23.0), n=128)
for k in range(3):
    a = 2 * math.pi * k / 3 + 0.4
    obox(bm, 20.4 * math.cos(a), 20.4 * math.sin(a), 18.6, 2.2, 7.0, 0.9, a + math.pi / 2)
mesh_obj('mount_ring', bm, [M_CHROME], g, smooth=True)
MOUNT_SCREWS = []
for k in range(4):
    a = math.pi / 4 + k * math.pi / 2
    s = screw('mount_screw', g, (22.0 * math.cos(a), 22.0 * math.sin(a), 23.05), (0, 0, 0), head_r=1.1, length=3.5, mat=M_SCREW_C)
    MOUNT_SCREWS.append((s, Vector(s.location), Vector((0, 0, 1))))
# E5 后组
g = lens_group('e5', 24, 1.77)
element(g, 'E5', 12.0, 26.0, 2.0, -0.8, 1.6, M_GLASS[4]); cell(g, 'E5_cell', 12.05, 14.5, 24.0, 28.2)
# 光圈组：外壳（后板/外墙/前盖板）+ 九片叶片 + 支点销
g = lens_group('iris', 50, 1.69)
bm = bmesh.new()
lathe(bm, ring_segs(19.2, 19.8, 31.0, 33.9), n=128)
lathe(bm, ring_segs(19.2, 21.0, 33.6, 33.9), n=128)
lathe(bm, ring_segs(11.9, 19.8, 31.0, 31.35), n=128)
mesh_obj('iris_housing', bm, [M_BLACK], g, smooth=True)
IK = 0.78                                                 # 叶片整体缩放（原型 Rp=17 → 13.3 mm）
BLADE_ROT = []


def blade_mesh(name, parent):
    Rb, S, w, n = 15.5, 1.45, 8.5, 28
    left, right = [], []
    for k in range(n):
        s = S * k / (n - 1)
        x, y = Rb * math.sin(s), -Rb * (1 - math.cos(s))
        tx, ty = math.cos(s), -math.sin(s); nx, ny = -ty, tx
        ww = 1.6 + w * math.sin(math.pi * s / S) ** 0.7
        left.append((x + nx * ww * 0.7, y + ny * ww * 0.7)); right.append((x - nx * ww * 0.3, y - ny * ww * 0.3))
    poly = [(IK * x, IK * y) for x, y in left + right[::-1]]
    bm = bmesh.new(); th = 0.1
    top = [bm.verts.new((x, y, th)) for x, y in poly]
    bot = [bm.verts.new((x, y, 0)) for x, y in poly]
    bm.faces.new(top); bm.faces.new(bot[::-1])
    for i in range(len(poly)):
        j = (i + 1) % len(poly)
        bm.faces.new([bot[i], bot[j], top[j], top[i]])
    lathe(bm, [[(0, th), (0.5, th)], [(0.5, th), (0.5, 0.5)], [(0.5, 0.5), (0, 0.5)]], n=16, mi=1)
    return mesh_obj(name, bm, [M_BLADE, M_CHROME], parent)


for i in range(9):
    ph = 2 * math.pi * i / 9
    Rp = 17.0 * IK
    piv = empty(f'blade_pivot_{i}', g, (Rp * math.cos(ph + math.pi / 2), Rp * math.sin(ph + math.pi / 2), 31.5 + 0.2 * i), (0, 0, ph))
    BLADE_ROT.append(blade_mesh(f'blade_{i}', piv))
# 光圈环（滚花 + 橙色指示点）
g = lens_group('aring', 100, 1.62)
bm = bmesh.new(); lathe(bm, ring_segs(20.0, 23.2, 30.5, 36.0), n=180, rmod=knurl_on({1}, 0.55))
APER_RING = mesh_obj('aperture_ring', bm, [M_BLACK], g)
bm = bmesh.new(); lathe(bm, disc_segs(0.7, 0, 0.3), n=24)
dot = mesh_obj('aperture_index', bm, [M_ACCENT], APER_RING, smooth=True); dot.location = (0, 23.0, 33.2); dot.rotation_euler = (math.radians(-90), 0, 0)
# E4、E3
g = lens_group('e4', 112, 1.54); element(g, 'E4', 13.5, 40.0, 2.0, 1.8, -0.6, M_GLASS[3]); cell(g, 'E4_cell', 13.55, 16.0, 38.2, 42.6)
g = lens_group('e3', 124, 1.46); element(g, 'E3', 14.5, 45.5, 2.4, -1.0, 2.2, M_GLASS[2]); cell(g, 'E3_cell', 14.55, 17.0, 42.4, 48.0)
# 对焦环（橡胶细棱）+ 镀铬内筒 + 对焦拨片
g = lens_group('focus', 140, 1.38)
bm = bmesh.new(); lathe(bm, ring_segs(20.0, 24.0, 47.0, 56.5), n=240, rmod=knurl_on({1}, 0.7))
mesh_obj('focus_ring', bm, [M_RUBBER], g)
bm = bmesh.new(); lathe(bm, ring_segs(18.0, 20.0, 45.0, 57.5), n=96); mesh_obj('focus_sleeve', bm, [M_CHROME], g, smooth=True)
bm = bmesh.new(); obox(bm, 0, -25.2, 51.5, 5.0, 3.0, 4.0, 0)
mesh_obj('focus_tab', bm, [M_BLACK], g, bevel=0.6, seg=3)
# E2、E1
g = lens_group('e2', 156, 1.31); element(g, 'E2', 16.0, 58.5, 2.2, 2.5, -1.2, M_GLASS[1]); cell(g, 'E2_cell', 16.05, 18.2, 56.0, 61.5)
g = lens_group('e1', 170, 1.23); element(g, 'E1', 17.5, 63.5, 2.6, 3.2, 0.6, M_GLASS[0]); cell(g, 'E1_cell', 17.55, 19.6, 61.5, 66.0)
# 前压圈（内侧滤镜螺纹细纹）
g = lens_group('front', 184, 1.15)
bm = bmesh.new()
lathe(bm, ring_segs(18.0, 22.4, 66.0, 70.0), n=120)
lathe(bm, [[(17.95, 66.2), (17.95, 69.8)]], n=240, mi=1, rmod=lambda i, k, r: r + 0.12 * (i % 2))
mesh_obj('front_ring', bm, [M_BLACK, M_CHROME], g)

# ======================= 快门（纵走焦平面，+Y） =======================
SH = G['shutter']
bm = bmesh.new(); box(bm, AX - 24, AX + 24, -1.0, 2.5, AZ - 18, AZ + 24)
shf = mesh_obj('shutter_frame', bm, [M_BLACK], SH, bevel=0.5)
boolean_cut(shf, box_cutter('cut_shutter', SH, AX - 18, AX + 18, -3, 5, AZ - 12, AZ + 12))
LAMELLAE = []
for i in range(4):
    bm = bmesh.new(); box(bm, -19.5, 19.5, -0.09, 0.09, -4.2, 4.2)
    lam = mesh_obj(f'lamella_{i}', bm, [M_BLADE], SH, bevel=0.2)
    LAMELLAE.append((lam, i))
bm = bmesh.new()                                          # 快门电磁铁线圈 + 定位销
lathe(bm, [[(2.6, 0), (2.6, 9)]], n=48, rmod=lambda i, k, r: r, cx=0, cy=0)
lathe(bm, disc_segs(2.6, 0, 0.01) + [[(2.7, -0.3), (2.7, 0.0)], [(2.7, 9.0), (2.7, 9.3)]], n=48, mi=1)
coil = mesh_obj('shutter_coil', bm, [M_COIL, M_BLACK], SH, smooth=True); coil.location = (AX + 19, -1.0, AZ + 13); coil.rotation_euler = (0, math.radians(90), 0)
coil.location = (AX + 12, -3.8, AZ + 18); coil.rotation_euler = (0, math.radians(-90), 0)
for sx, sz in [(-21.5, -15.5), (21.5, -15.5), (-21.5, 21.5), (21.5, 21.5)]:
    screw('shutter_screw', SH, (AX + sx, -1.05, AZ + sz), (math.radians(90), 0, 0), head_r=1.1, length=2.5)

# ======================= 电路板 =======================
def board(parent, w, h, mat, name):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new((x, y, 0.0)) for x, y in [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]]
    f = bm.faces.new(vs)
    for lp in f.loops:
        x, y, _ = lp.vert.co
        lp[uvl].uv = ((x + w / 2) / w, (y + h / 2) / h)
    box(bm, -w / 2, w / 2, -h / 2, h / 2, -1.6, -0.01, 1)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(mat); me.materials.append(M_FR4)
    ob = bpy.data.objects.new(name, me); col.objects.link(ob); ob.parent = parent
    return ob


MI = dict(epoxy=0, tin=1, cap=2, res=3, restop=4, ferrite=5, can=6, conn=7, connblk=8, gold=9, substrate=10, solder=11)
PART_MATS = [M_EPOXY, M_TIN, M_CAP, M_RES, M_RESTOP, M_FERRITE, M_CAN, M_CONN, M_CONNBLK, M_GOLD, M_SUBSTRATE, M_SOLDER]


def build_parts(parent, parts, name):
    """按版图摆放表建元件（板局部坐标 mm，z 向上为元件面）"""
    bm = bmesh.new()

    def fillet(cx, cy, ax, ay, w, h, length):
        """焊锡角：沿 (ax,ay) 方向外伸的三角棱柱"""
        prof = [(0, 0), (length, 0), (0, h)]
        if ax:
            p0 = [bm.verts.new((cx + ax * px, cy - w / 2, pz)) for px, pz in prof]
            p1 = [bm.verts.new((cx + ax * px, cy + w / 2, pz)) for px, pz in prof]
        else:
            p0 = [bm.verts.new((cx - w / 2, cy + ay * px, pz)) for px, pz in prof]
            p1 = [bm.verts.new((cx + w / 2, cy + ay * px, pz)) for px, pz in prof]
        for fs in ([p0[0], p0[1], p0[2]], [p1[2], p1[1], p1[0]], [p0[0], p1[0], p1[1], p0[1]],
                   [p0[1], p1[1], p1[2], p0[2]], [p0[2], p1[2], p1[0], p0[0]]):
            bm.faces.new(fs).material_index = MI['solder']

    for p in parts:
        t = p['type']
        if t == 'passive':
            L, W = p['L'], p['W']; H = 0.5 if p['size'] == '0402' else 0.8
            x, y = p['x'], p['y']; tl = 0.22 * L
            body = MI['cap'] if p['kind'] == 'cap' else MI['res']
            top = MI['restop'] if rng.random() < 0.3 else MI['res']
            if p['rot'] != 90:
                box(bm, x - L / 2 + tl, x + L / 2 - tl, y - W / 2, y + W / 2, 0.02, H, body)
                if p['kind'] == 'res':
                    box(bm, x - L / 2 + tl, x + L / 2 - tl, y - W / 2 + 0.03, y + W / 2 - 0.03, H, H + 0.015, top)
                for s in (-1, 1):
                    box(bm, x + s * (L / 2 - tl), x + s * L / 2, y - W / 2, y + W / 2, 0.02, H * 1.02, MI['tin'])
                    fillet(x + s * L / 2, y, s, 0, W * 0.92, H * 0.6, 0.28)
            else:
                box(bm, x - W / 2, x + W / 2, y - L / 2 + tl, y + L / 2 - tl, 0.02, H, body)
                if p['kind'] == 'res':
                    box(bm, x - W / 2 + 0.03, x + W / 2 - 0.03, y - L / 2 + tl, y + L / 2 - tl, H, H + 0.015, top)
                for s in (-1, 1):
                    box(bm, x - W / 2, x + W / 2, y + s * (L / 2 - tl), y + s * L / 2, 0.02, H * 1.02, MI['tin'])
                    fillet(x, y + s * L / 2, 0, s, W * 0.92, H * 0.6, 0.28)
        elif t in ('qfp', 'qfn'):
            x, y, w, h = p['x'], p['y'], p['w'], p['h']
            H = 1.4 if t == 'qfp' else 0.85
            box(bm, x - w / 2, x + w / 2, y - h / 2, y + h / 2, 0.05, H, MI['epoxy'])
            d1 = 1.2 if t == 'qfp' else 0.5
            lathe(bm, [[(0, H + 0.004), (0.5 if t == 'qfp' else 0.25, H + 0.004)]], n=20, mi=MI['tin'], cx=x - w / 2 + d1, cy=y + h / 2 - d1)
            n, pitch, lead = p['pins'], p['pitch'], p['lead']
            span = (n - 1) * pitch; pw = pitch * 0.45
            segs = [(0.0, 0.32, 0.62, 0.78), (0.32, 0.5, 0.12, 0.78), (0.5, lead, 0.0, 0.16)] if t == 'qfp' else [(-0.35, 0.05, 0.0, 0.2)]
            end = lead if t == 'qfp' else 0.05
            fl = 0.22 if t == 'qfp' else 0.18
            for side in range(4):
                for k in range(n):
                    o = -span / 2 + k * pitch
                    for a0, a1, z0, z1 in segs:          # 鸥翼引脚：水平段 → 下弯段 → 焊脚
                        if side == 0: box(bm, x + o - pw / 2, x + o + pw / 2, y - h / 2 - a1, y - h / 2 - a0, z0, z1, MI['tin'])
                        elif side == 1: box(bm, x + w / 2 + a0, x + w / 2 + a1, y + o - pw / 2, y + o + pw / 2, z0, z1, MI['tin'])
                        elif side == 2: box(bm, x - o - pw / 2, x - o + pw / 2, y + h / 2 + a0, y + h / 2 + a1, z0, z1, MI['tin'])
                        else: box(bm, x - w / 2 - a1, x - w / 2 - a0, y - o - pw / 2, y - o + pw / 2, z0, z1, MI['tin'])
                    if side == 0: fillet(x + o, y - h / 2 - end, 0, -1, pw, 0.14, fl)
                    elif side == 1: fillet(x + w / 2 + end, y + o, 1, 0, pw, 0.14, fl)
                    elif side == 2: fillet(x - o, y + h / 2 + end, 0, 1, pw, 0.14, fl)
                    else: fillet(x - w / 2 - end, y - o, -1, 0, pw, 0.14, fl)
        elif t == 'bga':
            x, y, w, h = p['x'], p['y'], p['w'], p['h']
            box(bm, x - w / 2, x + w / 2, y - h / 2, y + h / 2, 0.32, 0.62, MI['substrate'])
            box(bm, x - w / 2 + 0.35, x + w / 2 - 0.35, y - h / 2 + 0.35, y + h / 2 - 0.35, 0.62, 1.55, MI['epoxy'])
            pitch = 0.8                                   # 外圈两排焊球（侧面可见）
            for ring in (0, 1):
                e = 0.6 + ring * pitch
                for bx in [x - w / 2 + e + k * pitch for k in range(int((w - 2 * e) / pitch) + 1)]:
                    for by in (y - h / 2 + e, y + h / 2 - e):
                        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.2, matrix=Matrix.Translation((bx, by, 0.18)))
                for by in [y - h / 2 + e + k * pitch for k in range(1, int((h - 2 * e) / pitch))]:
                    for bx in (x - w / 2 + e, x + w / 2 - e):
                        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.2, matrix=Matrix.Translation((bx, by, 0.18)))
            for f in bm.faces:
                if f.material_index == 0 and len(f.verts) == 3:
                    f.material_index = MI['solder']
        elif t == 'inductor':
            s = p['s']; x, y = p['x'], p['y']
            box(bm, x - s / 2, x + s / 2, y - s / 2, y + s / 2, 0.05, 2.1, MI['ferrite'])
            lathe(bm, [[(0, 2.104), (s * 0.3, 2.104)]], n=24, mi=MI['connblk'], cx=x, cy=y)
            for sx in (-1, 1):
                box(bm, x + sx * s / 2, x + sx * (s / 2 + 0.12), y - s / 2 + 0.4, y + s / 2 - 0.4, 0.0, 0.9, MI['tin'])
                fillet(x + sx * (s / 2 + 0.12), y, sx, 0, s - 0.8, 0.5, 0.35)
        elif t == 'crystal':
            x, y, w, h = p['x'], p['y'], p['w'], p['h']
            box(bm, x - w / 2, x + w / 2, y - h / 2, y + h / 2, 0.05, 0.75, MI['can'])
            box(bm, x - w / 2 - 0.08, x + w / 2 + 0.08, y - h / 2 - 0.08, y + h / 2 + 0.08, 0.05, 0.2, MI['epoxy'])
        elif t == 'sot23':
            x, y = p['x'], p['y']
            box(bm, x - 1.45, x + 1.45, y - 0.65, y + 0.65, 0.1, 1.05, MI['epoxy'])
            for px, py in [(-0.95, -1.0), (0.95, -1.0), (0, 1.0)]:
                sg = 1 if py > 0 else -1
                box(bm, x + px - 0.2, x + px + 0.2, y + sg * 0.65, y + sg * 0.85, 0.35, 0.5, MI['tin'])
                box(bm, x + px - 0.2, x + px + 0.2, y + sg * 0.8, y + sg * 1.25, 0.0, 0.14, MI['tin'])
                fillet(x + px, y + sg * 1.25, 0, sg, 0.4, 0.12, 0.18)
        elif t == 'fpc':
            x, y, w, h = p['x'], p['y'], p['w'], p['h']
            box(bm, x - w / 2, x + w / 2, y - h / 2 + 1.2, y + h / 2, 0.0, 1.0, MI['conn'])
            box(bm, x - w / 2 + 0.3, x + w / 2 - 0.3, y + h / 2 - 1.6, y + h / 2 - 0.2, 1.0, 1.35, MI['connblk'])
            for k in range(p['n']):
                px = x - (p['n'] - 1) * 0.4 + k * 0.8
                box(bm, px - 0.15, px + 0.15, y - h / 2 + 0.4, y - h / 2 + 1.25, 0.0, 0.18, MI['gold'])
        elif t == 'b2b':
            x, y, w, h = p['x'], p['y'], p['w'], p['h']
            box(bm, x - w / 2, x + w / 2, y - h / 2 + 0.8, y + h / 2 - 0.8, 0.0, 1.6, MI['conn'])
            box(bm, x - w / 2 + 1.0, x + w / 2 - 1.0, y - 0.5, y + 0.5, 1.2, 1.62, MI['connblk'])
            for k in range(30):
                px = x - w / 2 + 1.8 + k * 0.62
                for py in (y - h / 2 + 0.3, y + h / 2 - 0.3):
                    box(bm, px - 0.12, px + 0.12, py - 0.35, py + 0.35, 0.0, 0.25, MI['gold'])
    nf = len(bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in PART_MATS:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me); col.objects.link(ob); ob.parent = parent
    print('parts', name, len(parts), 'faces', nf)
    return ob


# ---- 感光板 ----
SB = empty('SB', G['sensor'], (AX, 6.0, AZ - 1.0), (math.radians(90), 0, 0))   # 局部 +z → 世界 −Y，局部 y → 世界 +Z
sparts = json.load(open(os.path.join(TEX, 'sensor_parts.json')))
board(SB, sparts['w'], sparts['h'], M_PCBS, 'sensor_board')
build_parts(SB, [p for p in sparts['parts'] if p['type'] not in ('sensor', 'hole')], 'sensor_parts')
SENSOR_SCREWS = []
for p in sparts['parts']:
    if p['type'] == 'hole':
        s = screw('sensor_screw', SB, (p['x'], p['y'], 0.0), (0, 0, 0), head_r=1.6, length=4.0)
        SENSOR_SCREWS.append((s, Vector(s.location), Vector((0, 0, 1))))
SP = empty('sensor_pkg', SB, (0, 1.0, 0))
bm = bmesh.new()
box(bm, -18, 18, -15, 15, 0.0, 1.2, 0)
for x0, x1, y0, y1 in [(-18, 18, -15, -12.5), (-18, 18, 12.5, 15), (-18, -15.5, -12.5, 12.5), (15.5, 18, -12.5, 12.5)]:
    box(bm, x0, x1, y0, y1, 1.2, 2.1, 0)
mesh_obj('sensor_ceramic', bm, [M_CERAMIC], SP, bevel=0.15)
bm = bmesh.new(); box(bm, -12.5, 12.5, -9.5, 9.5, 1.2, 1.45, 0)
mesh_obj('sensor_die', bm, [M_DIE], SP)
bm = bmesh.new()
for side in range(4):
    nside = 34 if side % 2 == 0 else 26
    for k in range(nside):
        if side % 2 == 0:
            px = -11.5 + 23.0 * k / (nside - 1); py = -11.2 if side == 0 else 11.2; dpx, dpy = px, (-9.2 if side == 0 else 9.2)
            box(bm, px - 0.18, px + 0.18, py - 0.35, py + 0.35, 1.2, 1.24, 0)
        else:
            py = -8.5 + 17.0 * k / (nside - 1); px = -14.2 if side == 3 else 14.2; dpx, dpy = (-12.2 if side == 3 else 12.2), py
            box(bm, px - 0.35, px + 0.35, py - 0.18, py + 0.18, 1.2, 1.24, 0)
        pts = [(dpx, dpy, 1.46), ((dpx * 2 + px) / 3, (dpy * 2 + py) / 3, 1.85), ((dpx + 2 * px) / 3, (dpy + 2 * py) / 3, 1.7), (px, py, 1.25)]
        for a, b in zip(pts[:-1], pts[1:]):                # 键合线：三段弧
            av, bv = Vector(a), Vector(b); d = bv - av; c = (av + bv) / 2
            rz = math.atan2(d.y, d.x); ry = -math.atan2(d.z, math.hypot(d.x, d.y))
            r = bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Translation(c) @ Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y')
                                      @ Matrix.Diagonal((d.length, 0.035, 0.035, 1)))
mesh_obj('sensor_bond', bm, [M_GOLD], SP)
bm = bmesh.new(); box(bm, -17.2, 17.2, -14.2, 14.2, 2.1, 2.65, 0)
mesh_obj('sensor_lid', bm, [M_LID], SP, bevel=0.1)

# ---- 主板 ----
PB = empty('PB', G['pcb'], (0, 11.0, AZ), (math.radians(90), 0, 0))
mparts = json.load(open(os.path.join(TEX, 'main_parts.json')))
board(PB, mparts['w'], mparts['h'], M_PCB, 'main_board')
build_parts(PB, [p for p in mparts['parts'] if p['type'] != 'hole'], 'main_parts')
PCB_SCREWS = []
for p in mparts['parts']:
    if p['type'] == 'hole':
        s = screw('pcb_screw', PB, (p['x'], p['y'], -1.6), (math.radians(180), 0, 0), head_r=2.2, length=8.5)
        PCB_SCREWS.append((s, Vector(s.location), Vector((0, 0, -1))))      # 板局部 −z = 世界 +Y（向后旋出）

# ======================= 软排线（逐帧弯折） =======================
FLEX_N = 56
flex_me = bpy.data.meshes.new('flex')
flex_ob = bpy.data.objects.new('flex', flex_me); col.objects.link(flex_ob); flex_ob.parent = ROOT
flex_me.materials.append(M_FLEX)
_bm = bmesh.new(); _uvl = _bm.loops.layers.uv.new('UVMap')
_vs = [[_bm.verts.new((0, 0, 0)) for _ in range(2)] for _ in range(FLEX_N)]
for k in range(FLEX_N - 1):
    f = _bm.faces.new([_vs[k][0], _vs[k][1], _vs[k + 1][1], _vs[k + 1][0]])
    for lp, (u, v) in zip(f.loops, [(0, k), (1, k), (1, k + 1), (0, k + 1)]):
        lp[_uvl].uv = (u, v / (FLEX_N - 1))
_bm.to_mesh(flex_me); _bm.free()
sol = flex_ob.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.14
flex_me.polygons.foreach_set('use_smooth', [True] * len(flex_me.polygons))
FLEX_W = 12.0
SENSOR_FPC = Vector((AX, 6.0 - 1.0, AZ - 1.0 - 19.0))     # 感光板正面底缘 FPC 座
PCB_FPC = Vector((-30.0, 11.0 - 1.2, AZ - 23.0))          # 主板正面 FPC 座


def update_flex(off_s, off_p):
    p0 = SENSOR_FPC + Vector((0, off_s, 0)); p3 = PCB_FPC + Vector((0, off_p, 0))
    gap = max(p3.y - p0.y, 1.0)
    p1 = p0 + Vector((0, -1.0, -9.0 - 0.25 * gap)); p2 = p3 + Vector((0, -4.0 - 0.3 * gap, -9.0 - 0.25 * gap))
    co = []
    for k in range(FLEX_N):
        t = k / (FLEX_N - 1)
        pt = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3
        tg = 3 * (1 - t) ** 2 * (p1 - p0) + 6 * (1 - t) * t * (p2 - p1) + 3 * t ** 2 * (p3 - p2)
        tg.normalize()
        wv = Vector((1, 0, 0)) - Vector((1, 0, 0)).dot(tg) * tg; wv.normalize()
        co += list(pt - wv * FLEX_W / 2) + list(pt + wv * FLEX_W / 2)
    flex_me.vertices.foreach_set('co', co); flex_me.update()


# ======================= 拆解时间线 =======================
# 组: (方向, 距离 mm, 打开开始, 关闭开始, 打开时长, 关闭时长)
SPEC = {
    'top': (Vector((0, 0, 1)), 40.0, 1.00, 7.08, 0.85, 0.52),
    'bottom': (Vector((0, 0, -1)), 36.0, 1.05, 6.98, 0.85, 0.5),
    'rear': (Vector((0, 1, 0)), 74.0, 0.95, 6.45, 0.85, 0.5),
    'front': (Vector((0, -1, 0)), 26.0, 1.35, 6.62, 0.85, 0.5),
    'pcb': (Vector((0, 1, 0)), 48.0, 1.60, 6.18, 0.85, 0.45),
    'sensor': (Vector((0, 1, 0)), 30.0, 1.75, 6.05, 0.85, 0.45),
    'shutter': (Vector((0, 1, 0)), 15.0, 1.90, 5.95, 0.85, 0.45),
}
LENS_CLOSE = {k: 6.0 + 0.06 * i for i, k in enumerate(['mount', 'e5', 'iris', 'aring', 'e4', 'e3', 'focus', 'e2', 'e1', 'front'])}


def amount(t, t_open, t_close, d_open, d_close):
    if t < t_close:
        return ease3((t - t_open) / d_open)
    return 1 - ease3((t - t_close) / d_close)


def settle(t, t_land):
    """落位后毫米级的机械回弹"""
    d = t - t_land
    return 0.35 * math.sin(d / 0.25 * math.pi) * (1 - d / 0.25) if 0 <= d < 0.25 else 0.0


def backout(t, a0, a1, c0, c1):
    return ease((t - a0) / (a1 - a0)) if t < c0 else 1 - ease((t - c0) / (c1 - c0))


def iris_alpha(t):
    """叶片转角：+0.12 全开，-0.5 收到最小光孔"""
    if t < 3.55:
        return 0.12
    if t < 4.0:
        return 0.12 + (-0.5 - 0.12) * ease((t - 3.55) / 0.45)
    if t < 4.4:
        return -0.5 + (-0.22 + 0.5) * ease((t - 4.0) / 0.4)
    if t < 6.0:
        return -0.22
    return -0.22 + (0.12 + 0.22) * ease((t - 6.0) / 0.4)


def shutter_open(t):
    return ease((t - 2.7) / 0.35) * (1 - ease((t - 5.9) / 0.25))


def apply(t):
    for key, (axis, dist, to, tc, do, dc) in SPEC.items():
        a = amount(t, to, tc, do, dc)
        G[key].location = axis * (dist * a + (settle(t, tc + dc) if t >= tc + dc else 0.0))
    for key, dist, t0 in LENS_SPEC:
        LG[key].location = (0, 0, dist * amount(t, t0, LENS_CLOSE[key], 0.85, 0.55))
    for s, base, ax in BOTTOM_SCREWS:
        b = backout(t, 0.55, 0.95, 7.48, 7.78)
        s.location = base + ax * 8.0 * b; s.rotation_euler = (math.radians(180), 0, 8 * math.pi * b)
    for s, base, ax in MOUNT_SCREWS:
        b = backout(t, 1.5, 1.8, 6.62, 6.82)
        s.location = base + ax * 4.0 * b; s.rotation_euler = (0, 0, 6 * math.pi * b)
    for s, base, ax in PCB_SCREWS:
        b = backout(t, 1.25, 1.55, 6.66, 6.9)
        s.location = base + ax * 6.0 * b; s.rotation_euler = (math.radians(180), 0, 6 * math.pi * b)
    for s, base, ax in SENSOR_SCREWS:
        b = backout(t, 1.45, 1.72, 6.52, 6.72)
        s.location = base + ax * 4.0 * b; s.rotation_euler = (0, 0, 6 * math.pi * b)
    al = iris_alpha(t)
    for bl in BLADE_ROT:
        bl.rotation_euler = (0, 0, al)
    APER_RING.rotation_euler = (0, 0, 0.55 * (al - 0.12))
    so = shutter_open(t)
    for lam, i in LAMELLAE:
        z_closed = AZ - 10.5 + 7.0 * i
        z_open = AZ + 14.5 + 1.2 * i
        lam.location = (AX, 0.4 + 0.22 * i, z_closed + (z_open - z_closed) * so)
    update_flex(G['sensor'].location.y, G['pcb'].location.y)


# ======================= 灯光 / 世界 / 相机 =======================
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
wn = world.node_tree.nodes; wl = world.node_tree.links; bgn = wn['Background']
lp = wn.new('ShaderNodeLightPath'); tcw = wn.new('ShaderNodeTexCoord'); sz = wn.new('ShaderNodeSeparateXYZ')
wl.new(tcw.outputs['Generated'], sz.inputs[0])
ramp = wn.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.45; ramp.color_ramp.elements[0].color = (*srgb('#24262A'), 1)
ramp.color_ramp.elements[1].position = 0.95; ramp.color_ramp.elements[1].color = (*srgb('#9A9EA6'), 1)
wl.new(sz.outputs[2], ramp.inputs[0])
mixw = wn.new('ShaderNodeMix'); mixw.data_type = 'RGBA'
mixw.inputs[7].default_value = (*srgb('#17181B'), 1)
wl.new(lp.outputs['Is Camera Ray'], mixw.inputs['Factor']); wl.new(ramp.outputs[0], mixw.inputs[6]); wl.new(mixw.outputs[2], bgn.inputs[0])
bgn.inputs[1].default_value = 0.6


def area(name, loc, size, energy, color, tgt=(0.1, 0, 0), sy=None):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.color = srgb(color)
    l.size = size
    if sy:
        l.shape = 'RECTANGLE'; l.size_y = sy
    o = bpy.data.objects.new(name, l); col.objects.link(o); o.location = loc
    o.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


area('top', (0, -1.5, 7), 9, 4200, '#FFF6EA', tgt=(0, -1.0, 0))
area('rimL', (-7, 5, 3), 6, 2000, '#CFE0FF')
area('rimR', (7, 3, 2), 6, 1400, '#FFE2C8')
area('fill', (-5, -9, 2.5), 9, 900, '#FFFFFF')
# 柔光箱：给镀铬、玻璃与焊点提供长条高光，相机不可见
sbm = bpy.data.materials.new('softbox'); sbm.use_nodes = True
sbn = sbm.node_tree; sbn.nodes.clear()
_o = sbn.nodes.new('ShaderNodeOutputMaterial'); _e = sbn.nodes.new('ShaderNodeEmission'); _e.inputs['Strength'].default_value = 5.0
sbn.links.new(_e.outputs[0], _o.inputs[0])
for nm, loc, size, rot in (('sb_top', (0, -1, 9), (10, 4, 0.01), (0, 0, 0)),
                           ('sb_left', (-11, -3, 3), (0.01, 8, 5), (0, 0, math.radians(-20))),
                           ('sb_front', (-3, -12, 4), (8, 0.01, 3), (math.radians(-15), 0, math.radians(-20)))):
    bm = bmesh.new(); box(bm, -size[0] / 2, size[0] / 2, -size[1] / 2, size[1] / 2, -size[2] / 2, size[2] / 2)
    me = bpy.data.meshes.new(nm); bm.to_mesh(me); bm.free(); me.materials.append(sbm)
    ob = bpy.data.objects.new(nm, me); col.objects.link(ob); ob.location, ob.rotation_euler = loc, rot
    ob.visible_camera = False; ob.visible_shadow = False

cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 35; cam_d.clip_start = 0.005; cam_d.clip_end = 100
cam_d.dof.use_dof = True
cam = bpy.data.objects.new('cam', cam_d); col.objects.link(cam); sc.camera = cam
fill = bpy.data.lights.new('macro_fill', 'AREA'); fill.energy = 0; fill.size = 0.25; fill.color = srgb('#FFF6EA')
fill_o = bpy.data.objects.new('macro_fill', fill); col.objects.link(fill_o); fill_o.parent = cam; fill_o.location = (0.12, 0.16, 0.05)

# (t, 目标 mm, 距离 世界单位, 航向°, 俯仰°, 光圈 f)
KEYS = [
    (0.00, (10, 0, 0), 2.7, -38, 16, 16),
    (1.20, (10, -10, 0), 3.0, -50, 18, 16),
    (2.40, (10, -75, 4), 4.5, -68, 14, 16),
    (2.75, (10, -78, 3), 4.3, -64, 13, 16),
    (3.50, (AX, -82, AZ), 0.44, -26, 10, 8.0),
    (4.35, (AX, -82, AZ), 0.38, -16, 7, 8.0),
    (4.62, (0, -40, 0), 1.6, -40, 20, 11),
    (4.90, (-10, 45, 0), 1.25, -62, 24, 11),
    (5.28, (-11, 58, AZ + 6), 0.50, -54, 28, 8.0),
    (5.88, (-9, 58, AZ + 6), 0.45, -50, 27, 8.0),
    (6.18, (-8, 52, 0), 1.1, -78, 22, 11),
    (6.70, (10, 5, 0), 3.0, -58, 19, 16),
    (8.00, (10, 0, 0), 2.8, -36, 16, 16),
]


def cam_state(t):
    ts = [k[0] for k in KEYS]
    vals = [[*k[1], math.log(k[2]), k[3], k[4], math.log(k[5])] for k in KEYS]
    i = max(j for j in range(len(ts) - 1) if ts[j] <= t) if t >= ts[0] else 0
    p1, p2 = vals[i], vals[i + 1]
    p0 = vals[i - 1] if i > 0 else p1
    p3 = vals[i + 2] if i + 2 < len(vals) else p2
    u = min(max((t - ts[i]) / (ts[i + 1] - ts[i]), 0), 1)
    h0 = ts[i] - ts[i - 1] if i > 0 else ts[i + 1] - ts[i]
    h1 = ts[i + 1] - ts[i]
    h2 = ts[i + 2] - ts[i + 1] if i + 2 < len(ts) else h1
    out = []
    for a, b, c, d in zip(p0, p1, p2, p3):   # 非均匀 Catmull-Rom（切线按段长缩放）
        m1 = (c - a) / (h0 + h1) * h1
        m2 = (d - b) / (h1 + h2) * h1
        u2, u3 = u * u, u * u * u
        out.append((2 * u3 - 3 * u2 + 1) * b + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * c + (u3 - u2) * m2)
    tgt = Vector(out[:3]) * U
    return tgt, math.exp(out[3]), math.radians(out[4]), math.radians(out[5]), math.exp(out[6])


def place_camera(t):
    tgt, dist, hd, pt, fs = cam_state(t)
    pos = tgt + dist * Vector((math.cos(pt) * math.sin(hd), -math.cos(pt) * math.cos(hd), math.sin(pt)))
    cam.location = pos
    cam.rotation_euler = (tgt - pos).to_track_quat('-Z', 'Y').to_euler()
    cam_d.dof.focus_distance = dist
    cam_d.dof.aperture_fstop = fs
    fill.energy = 4.0 * max(0.0, min(1.0, (1.0 - dist) / 0.5))
    return dist


def anchor(name, parent, loc):
    return empty('A_' + name, parent, loc)


ANCH = {
    'lens': anchor('lens', LG['e1'], (0, 0, 66.8)),
    'shutter': anchor('shutter', SH, (AX + 18, -1.2, AZ + 12)),
    'sensor': anchor('sensor', SP, (11.0, 8.0, 1.45)),
    'iris': anchor('iris', BLADE_ROT[2], (6.0, -3.0, 0.1)),
    'soc': anchor('soc', PB, (-22 + 3.5, 5 + 3.5, 1.4)),
    'dram': anchor('dram', PB, (2.0 + 2.5, 8.0 - 2.0, 1.55)),
}

meta = {}
for f in range(F0, F1 + 1, FSTEP):
    t = f / FPS
    apply(t)
    dist = place_camera(t)
    sc.frame_set(f + 1)
    bpy.context.view_layer.update()
    pts = {}
    for k, a in ANCH.items():
        c = world_to_camera_view(sc, cam, a.matrix_world.translation)
        pts[k] = [c.x, 1 - c.y, c.z]
    meta[f + 1] = {'t': t, 'dist': dist, 'anchors': pts}
    sc.render.filepath = os.path.join(OUT, f'{f + 1:04d}.png')
    bpy.ops.render.render(write_still=True)
    print('FRAME', f + 1, flush=True)
json.dump(meta, open(os.path.join(OUT, f'meta_{F0}_{F1}_{FSTEP}.json'), 'w'))
print('DONE')
