# S28 后期：投影高光辉光 + 暗角 + 轻颗粒 + 身份标签/左侧读数/两枚图钉/居中双语字幕
# 用法: python3 overlay.py <raw_dir> <out_dir>
import sys, os, json, glob, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout import PUBLIC, REACH

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
W, H, FPS = 1920, 1080, 30
meta = {}
for p in glob.glob(os.path.join(RAW, 'meta_*.json')):
    meta.update({int(k): v for k, v in json.load(open(p)).items()})

HIRA = '/System/Library/Fonts/Hiragino Sans GB.ttc'
HELV = '/System/Library/Fonts/HelveticaNeue.ttc'
F = lambda p, s, i=0: ImageFont.truetype(p, s, index=i)
F_ID = F(HIRA, 36, 2); F_ID2 = F(HIRA, 23, 0); F_ID3 = F(HELV, 22, 0)
F_IDX = F(HELV, 26, 10); F_IDXCN = F(HIRA, 28, 2)
F_BIG = F(HELV, 128, 5); F_BIGCN = F(HIRA, 34, 2)
F_LEG = F(HIRA, 25, 0); F_LEGEN = F(HELV, 20, 0)
F_PIN = F(HIRA, 30, 2); F_PINEN = F(HELV, 21, 0)
F_SUB = F(HIRA, 44, 2); F_SUBEN = F(HELV, 27, 0)


def ease(x):
    x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)


def fade(t, a, b, d=0.3):
    return ease((t - a) / d) * (1 - ease((t - (b - d)) / d))


def hexrgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def t_on(trig):
    return next(3.0 + k / 3000 * 2.6 for k in range(3001) if ease(k / 3000) >= trig)


TON = {p[0]: t_on(p[1]) for p in PUBLIC}
STEPS = [(1.1, 3.05, '01', '旧厂区', 'Factory', '老厂房的轮廓投在白模上'),
         (3.05, 5.75, '02', '改造路径', 'Route', '一条路线穿过厂区'),
         (5.75, 8.4, '03', '公共空间', 'Library', '厂房变成公共图书馆')]
SUBS = [(0.2, 2.95, '这里曾是一座老工厂。', 'This was an old factory.'),
        (3.15, 5.75, '一条路线，把厂房还给公众。', 'One route gives its halls back to the public.'),
        (5.95, 8.4, '现在，它是一座公共图书馆。', 'Now it is a public library.')]
PINS = [('hallA', '阅览室', 'Reading room', (-60, -150)), ('ware2', '屋顶花园', 'Roof garden', (-40, -150))]

yy, xx = np.mgrid[0:H, 0:W]
r2 = ((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2
VIG = (1 - 0.32 * np.clip(r2 / 2, 0, 1) ** 1.1)[..., None].astype(np.float32)
LEFT_GRAD = (np.clip(1 - (np.arange(W) - 120) / 820, 0, 1) ** 1.1 * 0.86)[None, :] * np.ones((H, 1), np.float32)
LEFT_GRAD[:300] *= np.clip((np.arange(300) - 200) / 100, 0, 1)[:, None]
sub_grad = np.zeros((H, W), np.float32)
# 左上身份标签的背板：椭圆形压暗，保证英文小字在亮楼群上可读
ID_GRAD = (np.clip(1 - np.sqrt(((xx - 90) / 640.0) ** 2 + ((yy - 70) / 170.0) ** 2), 0, 1) ** 0.6 * 0.72).astype(np.float32)
sub_grad[820:, :] = np.clip((np.arange(820, H) - 820) / 200, 0, 1)[:, None] ** 1.2 * 0.62


def T(d, xy, s, f, col, a, anchor='la'):
    d.text(xy, s, font=f, fill=(*col, int(255 * max(0, min(a, 1)))), anchor=anchor)


def load_lin(path):
    im = Image.open(path).convert('RGB')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    c = np.asarray(im, np.float32) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


for fp in sorted(glob.glob(os.path.join(RAW, 'base', '[0-9][0-9][0-9][0-9].png'))):
    n = int(os.path.basename(fp)[:4]); t = (n - 1) / FPS
    lin = load_lin(fp) + load_lin(os.path.join(RAW, 'proj', os.path.basename(fp)))
    lin = np.clip(lin, 0, 1)
    img = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055).astype(np.float32)
    lum = img.max(axis=2, keepdims=True)
    hi = Image.fromarray((img * np.clip((lum - 0.88) / 0.12, 0, 1) * 255).astype(np.uint8))
    img = img + np.asarray(hi.filter(ImageFilter.GaussianBlur(12)), np.float32) / 255 * 0.55 \
              + np.asarray(hi.filter(ImageFilter.GaussianBlur(36)), np.float32) / 255 * 0.35
    g = np.random.default_rng(n).normal(0, 0.012, (H, W, 1)).astype(np.float32)
    img = np.clip(img * VIG + g, 0, 1)
    la_ = max(fade(t, a, b, 0.3) for a, b, *_ in STEPS)
    img = img * (1 - LEFT_GRAD[..., None] * la_)
    img = img * (1 - ID_GRAD[..., None])
    sa = max(fade(t, a, b) for a, b, _, _ in SUBS)
    img = img * (1 - sub_grad[..., None] * sa)
    base = Image.fromarray((img * 255 + 0.5).astype(np.uint8)).convert('RGBA')
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)

    a0 = ease(t / 0.4)
    T(d, (96, 64), '老工厂 → 公共图书馆', F_ID, (242, 242, 240), a0)
    T(d, (96, 114), '实体白模投影 · 示意方案', F_ID2, (170, 176, 182), a0 * 0.95)
    T(d, (96, 146), 'White model, projected light · illustrative', F_ID3, (178, 184, 190), a0 * 0.9)

    for a, b, idx, cn, big, line in STEPS:
        s = fade(t, a, b, 0.3)
        if s <= 0:
            continue
        y0 = 430
        T(d, (96, y0), idx, F_IDX, (170, 176, 182), s)
        T(d, (140, y0 - 2), cn, F_IDXCN, (236, 236, 234), s)
        d.line([(96, y0 + 40), (96 + 64 * ease((t - a) / 0.4), y0 + 40)], fill=(*hexrgb('#4FD3EA'), int(220 * s)), width=2)
        T(d, (88, y0 + 52), big, F_BIG, (244, 244, 242), s)
        T(d, (96, y0 + 196), line, F_BIGCN, (236, 236, 234), s)
        ly = y0 + 252
        if idx == '03':
            T(d, (96, ly), '步行可达（示意）', F_LEG, (226, 226, 224), s)
            T(d, (96 + d.textlength('步行可达（示意）', font=F_LEG) + 12, ly + 4), 'Walking reach, illustrative', F_LEGEN, (160, 166, 172), s)
            for k, (col, lcn, len_) in enumerate(zip(REACH, ['近', '中', '远'], ['Near', 'Mid', 'Far'])):
                y = ly + 40 + 36 * k
                d.rectangle([96, y + 6, 132, y + 22], fill=(*hexrgb(col), int(255 * s)))
                T(d, (146, y), lcn, F_LEG, (226, 226, 224), s); T(d, (182, y + 4), len_, F_LEGEN, (160, 166, 172), s)
        elif idx == '01':
            d.rectangle([96, ly + 6, 132, ly + 22], fill=(*hexrgb('#E0853A'), int(255 * s)))
            T(d, (146, ly), '旧厂房', F_LEG, (226, 226, 224), s); T(d, (236, ly + 4), 'Old buildings', F_LEGEN, (160, 166, 172), s)
        else:
            k = 0
            for name, trig, col, lcn, len_ in PUBLIC:
                la = ease((t - TON[name]) / 0.3) * s
                if la <= 0:
                    continue
                y = ly + 38 * k; k += 1
                d.rectangle([96, y + 6, 132, y + 22], fill=(*hexrgb(col), int(255 * la)))
                T(d, (146, y), lcn, F_LEG, (226, 226, 224), la)
                T(d, (146 + d.textlength(lcn, font=F_LEG) + 12, y + 4), len_, F_LEGEN, (160, 166, 172), la)

    m = meta.get(n)
    if m:
        for name, cn, en, (dx, dy) in PINS:
            pa = ease((t - TON[name] - 0.15) / 0.35)
            if pa <= 0 or m[name][2] <= 0:
                continue
            px, py = m[name][0] * W, (1 - m[name][1]) * H
            g2 = ease((t - TON[name] - 0.15) / 0.4)
            qx, qy = px + dx * 0.15, py + dy * g2
            d.line([(px, py), (qx, qy)], fill=(240, 240, 240, int(220 * pa)), width=2)
            d.ellipse([px - 4, py - 4, px + 4, py + 4], fill=(240, 240, 240, int(240 * pa)))
            tw = max(d.textlength(cn, font=F_PIN), d.textlength(en, font=F_PINEN))
            if qx + tw + 22 > W - 96:
                qx = W - 96 - tw - 22
                d.line([(px, py), (qx + tw + 22, qy)], fill=(240, 240, 240, int(220 * pa)), width=2)
            d.rectangle([qx - 2, qy - 78, qx + tw + 22, qy - 4], fill=(10, 12, 15, int(185 * pa)))
            T(d, (qx + 10, qy - 72), cn, F_PIN, (246, 246, 244), pa)
            T(d, (qx + 10, qy - 32), en, F_PINEN, (200, 204, 208), pa)

    for a, b, cn, en in SUBS:
        s = fade(t, a, b, 0.3)
        if s > 0:
            T(d, (W / 2, 936), cn, F_SUB, (248, 248, 246), s, 'ma')
            T(d, (W / 2, 994), en, F_SUBEN, (210, 212, 214), s, 'ma')
    Image.alpha_composite(base, ov).convert('RGB').save(os.path.join(OUT, f'{n:04d}.png'), compress_level=1)
    if n % 30 == 0:
        print('overlay', n, flush=True)
print('OVERLAY DONE')
