# S27 后期：高阈值辉光 + 暗角 + 仪器信息/切割平面标尺/双语字幕/唯一一条示意标注
# 用法: python3 overlay.py <raw_dir> <out_dir>
import sys, os, json, glob
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
FPS = 30
meta = {}
for p in glob.glob(os.path.join(RAW, 'meta_*.json')):
    meta.update({int(k): v for k, v in json.load(open(p)).items()})

HIRA = '/System/Library/Fonts/Hiragino Sans GB.ttc'
HELV = '/System/Library/Fonts/HelveticaNeue.ttc'
MENLO = '/System/Library/Fonts/Menlo.ttc'


def font(path, size, idx=0):
    return ImageFont.truetype(path, size, index=idx)


F_TITLE = font(HIRA, 34, 2)
F_INFO = font(HIRA, 23, 0)
F_MONO = font(MENLO, 22)
F_CAP_CN = font(HIRA, 46, 2)
F_CAP_EN = font(HELV, 28, 0)
F_TAG_CN = font(HIRA, 34, 2)
F_TAG_EN = font(HELV, 23, 0)
F_RUL = font(HIRA, 25, 2)
F_RUL_S = font(HIRA, 21, 0)

AMBER = (255, 179, 71)
FRONT = (212, 255, 240)

yy, xx = np.mgrid[0:H, 0:W]
r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
VIG = (1 - 0.26 * np.clip(r2 / 2, 0, 1) ** 1.2)[..., None].astype(np.float32)


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def fade(t, a, b, d=0.25):
    return ease((t - a) / d) * (1 - ease((t - (b - d)) / d))


CAPS = [(0.3, 3.95, '剥去每一层打在树冠上的回波。', 'Peel away every return that hit a tree.'),
        (4.2, 8.2, '树下，是墙基和一座拱门。', 'Under the trees: wall footings, and an arch.')]


def zcut(t):
    steps = [(1.0, 1.55, 30.0, 17.0), (1.75, 2.35, 17.0, 11.5), (2.55, 3.15, 11.5, 6.0), (3.3, 3.9, 6.0, 0.4)]
    z = 30.0
    for a, b, z0, z1 in steps:
        if t >= a:
            z = z0 + (z1 - z0) * ease((t - a) / (b - a))
    return z


def text(d, xy, s, f, fill, alpha):
    d.text(xy, s, font=f, fill=(*fill, int(255 * alpha)))


frames = sorted(glob.glob(os.path.join(RAW, '[0-9][0-9][0-9][0-9].png')))
for fp in frames:
    n = int(os.path.basename(fp)[:4])
    t = (n - 1) / FPS
    img = np.asarray(Image.open(fp).convert('RGB'), np.float32) / 255
    if img.shape[1] != W:
        img = np.asarray(Image.open(fp).convert('RGB').resize((W, H), Image.LANCZOS), np.float32) / 255
    lum = img.max(axis=2, keepdims=True)
    hi = img * np.clip((lum - 0.93) / 0.07, 0, 1)
    hi_img = Image.fromarray((hi * 255).astype(np.uint8))
    bloom = (np.asarray(hi_img.filter(ImageFilter.GaussianBlur(14)), np.float32) / 255 * 0.7
             + np.asarray(hi_img.filter(ImageFilter.GaussianBlur(40)), np.float32) / 255 * 0.45)
    img = np.clip((img + bloom) * VIG, 0, 1)
    base = Image.fromarray((img * 255 + 0.5).astype(np.uint8)).convert('RGBA')
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)

    # 仪器信息（左上）
    a0 = ease(t / 0.4)
    text(d, (72, 52), '林下古堡（示意）', F_TITLE, (240, 240, 236), 0.95 * a0)
    text(d, (72, 100), '合成示意点云 · Synthetic illustrative scan', F_INFO, (160, 168, 170), 0.9 * a0)
    text(d, (72, 132), '植被 / 地面 / 结构 · 分类回波', F_INFO, (140, 148, 150), 0.85 * a0)
    a3 = ease((t - 4.4) / 0.4)
    if a3 > 0:
        text(d, (72, 164), '实体地表由地面回波生成', F_INFO, (140, 148, 150), 0.85 * a3)

    # 切割平面标尺（右侧，无数值）
    ar = fade(t, 0.5, 4.75, 0.35)
    if ar > 0:
        x0, ytop, ybot = 1650, 340, 760
        text(d, (x0 - 60, ytop - 118), '切割平面', F_RUL, (235, 240, 238), ar)
        text(d, (x0 - 60, ytop - 82), 'Cutting plane', F_RUL_S, (170, 178, 180), ar)
        d.line([(x0, ytop), (x0, ybot)], fill=(220, 225, 225, int(150 * ar)), width=2)
        for k in range(11):
            y = ytop + (ybot - ytop) * k / 10
            L = 14 if k % 5 == 0 else 7
            d.line([(x0 - L, y), (x0, y)], fill=(220, 225, 225, int(140 * ar)), width=2)
        text(d, (x0 + 16, ytop - 14), '树冠 Canopy', F_RUL_S, (170, 178, 180), ar)
        text(d, (x0 + 16, ybot - 14), '地面 Ground', F_RUL_S, (170, 178, 180), ar)
        z = zcut(t)
        y = ybot - (ybot - ytop) * min(z, 20.0) / 20.0
        if z <= 20.5:
            d.line([(x0 - 34, y), (x0 + 8, y)], fill=(*FRONT, int(255 * ar)), width=3)
            d.polygon([(x0 - 34, y - 8), (x0 - 34, y + 8), (x0 - 22, y)], fill=(*FRONT, int(255 * ar)))

    # 字幕（左下：竖线 + 渐隐底板）
    for a, b, cn, en in CAPS:
        ac = fade(t, a, b, 0.3)
        if ac <= 0:
            continue
        plate = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        pa = np.zeros((H, W), np.float32)
        x_ramp = np.clip(1 - (np.arange(W) - 80) / 900, 0, 1) ** 1.3
        pa[880:1006, 80:] = x_ramp[80:][None, :] * 0.5 * ac
        plate.putalpha(Image.fromarray((pa * 255).astype(np.uint8)))
        ov = Image.alpha_composite(plate, ov)
        d = ImageDraw.Draw(ov)
        d.rectangle([92, 892, 94, 994], fill=(240, 240, 236, int(230 * ac)))
        text(d, (118, 890), cn, F_CAP_CN, (246, 246, 242), ac)
        text(d, (118, 952), en, F_CAP_EN, (200, 204, 204), ac)

    # 唯一一条示意标注：拱门
    m = meta.get(n)
    al = ease((t - 6.25) / 0.3)
    if m and al > 0 and m['arch_top'][2] > 0:
        px, py = m['arch_top'][0] * W, (1 - m['arch_top'][1]) * H
        gl = ease((t - 6.25) / 0.35)
        qx, qy = px + 210 * gl, py + (max(py - 170, 260) - py) * gl
        d.line([(px, py), (qx, qy)], fill=(*AMBER, int(235 * al)), width=2)
        d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=(*AMBER, int(255 * al)))
        ta = ease((t - 6.5) / 0.3)
        if ta > 0:
            tw = max(d.textlength('拱门遗构（示意）', font=F_TAG_CN), d.textlength('Arch remains · illustrative', font=F_TAG_EN))
            pop = 0.92 + 0.08 * ta
            d.line([(qx, qy), (qx + 24, qy)], fill=(*AMBER, int(235 * ta)), width=2)
            bx, by = qx + 30, qy - 50
            d.rectangle([bx - 10, by - 6, bx + tw * pop + 16, by + 92], fill=(8, 10, 12, int(170 * ta)))
            text(d, (bx, by), '拱门遗构（示意）', F_TAG_CN, (246, 246, 242), ta)
            text(d, (bx, by + 50), 'Arch remains · illustrative', F_TAG_EN, (205, 208, 208), ta)

    out = Image.alpha_composite(base, ov).convert('RGB')
    out.save(os.path.join(OUT, f'{n:04d}.png'), compress_level=1)
    if n % 30 == 0:
        print('overlay', n, flush=True)
print('OVERLAY DONE', len(frames))
