# S29 后期 v2：六处引线标注（锚点来自 scene.py 逐帧 meta，随 3D 零件移动）+ 中英底部说明字 + 轻暗角
# 标注只写零件名（两位编号用强调色 #FF6B3D），不写任何参数数字。
# 用法: python3 post.py <raw_dir(含 meta_*.json)> <out_dir>
import sys, os, json, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
HIRA = '/System/Library/Fonts/Hiragino Sans GB.ttc'
AVN = '/System/Library/Fonts/Avenir Next.ttc'
ZH_B = ImageFont.truetype(HIRA, 40, index=2)
ZH = ImageFont.truetype(HIRA, 32, index=2)
EN = ImageFont.truetype(AVN, 22, index=5)
EN_C = ImageFont.truetype(AVN, 26, index=5)
IDX = ImageFont.truetype(AVN, 22, index=2)
W, H = 1920, 1080
ACC = (255, 107, 61)

meta = {}
for p in glob.glob(os.path.join(src, 'meta_*.json')):
    meta.update(json.load(open(p)))

# (锚点键, 编号, 中文, 英文, 出现, 消失, 偏移方向 dx, dy)
LAB = [('lens', '01', '镜头组', 'Lens group', 2.05, 3.05, 1, -1),
       ('shutter', '02', '快门', 'Shutter', 2.15, 3.05, -1, -1),
       ('sensor', '03', '感光元件', 'Image sensor', 2.25, 3.05, -1, 1),
       ('iris', '04', '光圈叶片', 'Aperture blades', 3.65, 4.4, 1, -1),
       ('soc', '05', '主控芯片', 'Processor', 5.2, 5.95, 1, -1),
       ('dram', '06', '内存', 'Memory', 5.3, 5.95, 1, 1)]
CAPS = [(0.4, 2.95, '拆开一台相机，一层一层。', 'Taking a camera apart, layer by layer.'),
        (3.2, 4.45, '光圈叶片收拢，又张开。', 'The aperture blades close, then open.'),
        (4.75, 6.0, '板上每颗元件，都焊在自己的位置。', 'Every part on the board, soldered in place.'),
        (6.15, 8.01, '再一层一层，装回原位。', 'Then every part clicks back in place.')]

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
VIG = np.clip(1.06 - 0.3 * r ** 2, 0.62, 1.06)[..., None]
SUB = (1 - np.clip((yy - 850) / 230, 0, 1) ** 1.3 * 0.5)[..., None]


def fade(t, a, b, f=0.3):
    return max(0.0, min(1.0, (t - a) / f, (b - t) / f))


def centered(d, y, text, font, fill):
    w = d.textlength(text, font=font)
    d.text(((W - w) / 2, y), text, font=font, fill=fill)


for fp in sorted(glob.glob(os.path.join(src, '[0-9][0-9][0-9][0-9].png'))):
    f = int(os.path.basename(fp)[:4]); t = (f - 1) / 30
    im = Image.open(fp).convert('RGB')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) * VIG
    sa = max(fade(t, a0, a1) for a0, a1, *_ in CAPS)
    a = a * (1 - (1 - SUB) * sa)
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGBA')
    lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    pts = meta.get(str(f), {}).get('anchors', {})
    for key, idx, zh, en, a0, a1, sx, sy in LAB:
        u = fade(t, a0, a1, 0.35)
        if u <= 0 or key not in pts:
            continue
        x, y, z = pts[key][0] * W, pts[key][1] * H, pts[key][2]
        if z <= 0 or not (40 < x < W - 40 and 40 < y < H - 220):
            continue
        al = int(235 * u)
        ex = x + sx * 110 * u
        ey = min(max(y + sy * 110 * u, 150), H - 300)
        tw = max(d.textlength(zh, font=ZH) + 46, d.textlength(en, font=EN))
        hx = ex + sx * (tw + 24) * u
        d.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 255, 255, al), width=2)
        d.ellipse([x - 2.5, y - 2.5, x + 2.5, y + 2.5], fill=(*ACC, al))
        d.line([(x, y), (ex, ey)], fill=(255, 255, 255, al), width=2)
        d.line([(ex, ey), (hx, ey)], fill=(255, 255, 255, al), width=2)
        if u > 0.55:
            ta = int(255 * (u - 0.55) / 0.45)
            bx = ex + 12 if sx > 0 else hx + 12
            bx = min(max(bx, 70), W - 70 - tw)
            d.rectangle([bx - 12, ey - 62, bx + tw + 12, ey + 42], fill=(10, 11, 13, int(165 * ta / 255)))   # 底板保证亮背景上可读
            d.text((bx, ey - 50), idx, font=IDX, fill=(*ACC, ta))
            d.text((bx + 38, ey - 54), zh, font=ZH, fill=(255, 255, 255, ta))
            d.text((bx, ey + 9), en, font=EN, fill=(200, 204, 212, ta))
    for a0, a1, zh, en in CAPS:
        ca = fade(t, a0, a1)
        if ca > 0:
            centered(d, 924, zh, ZH_B, (255, 255, 255, int(255 * ca)))
            centered(d, 978, en, EN_C, (186, 190, 198, int(255 * ca)))
    im = Image.alpha_composite(im, lay)
    im.convert('RGB').save(os.path.join(dst, f'{f:04d}.png'), compress_level=1)
print('POST DONE')
