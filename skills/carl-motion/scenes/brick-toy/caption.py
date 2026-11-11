"""在渲染帧上叠加 A 同款字幕胶囊（深色圆角 + 小积木图标 + 白字）。
用法: python3 caption.py <输入帧目录> <输出帧目录>"""
import os, sys, math
from PIL import Image, ImageDraw, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
os.makedirs(DST, exist_ok=True)
TEXT = "Click. Click. Done."
T_IN, T_OUT = 4.2, 8.1
FONT = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
font = ImageFont.truetype(FONT, 50)


def draw_caption(img, scale):
    W, H = img.size
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    tw = d.textlength(TEXT, font=font)
    ph, icon = 84, 46
    pw = tw + icon + 24 + 64
    cx, cy = W / 2, H - 150
    pw, ph = pw * scale, ph * scale
    x0, y0 = cx - pw / 2, cy - ph / 2
    d.rounded_rectangle([x0, y0, x0 + pw, y0 + ph], radius=ph / 2, fill=(20, 22, 26, 205))
    # brick icon: a yellow 2-stud brick
    ix, iy = x0 + 32 * scale, cy - 10 * scale
    bw, bh = icon * scale, 24 * scale
    d.rounded_rectangle([ix, iy, ix + bw, iy + bh], radius=4 * scale, fill=(242, 205, 55, 255))
    for k in (0.27, 0.73):
        sx = ix + bw * k
        d.rounded_rectangle([sx - 7 * scale, iy - 9 * scale, sx + 7 * scale, iy + 1], radius=3 * scale,
                            fill=(242, 205, 55, 255))
    f = ImageFont.truetype(FONT, max(10, int(50 * scale)))
    d.text((ix + bw + 22 * scale, cy), TEXT, font=f, fill=(255, 255, 255, 255), anchor="lm")
    return Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")


for name in sorted(os.listdir(SRC)):
    if not name.endswith(".png"):
        continue
    fr = int(name[:4])
    t = (fr - 1) / 30
    img = Image.open(os.path.join(SRC, name))
    if T_IN <= t < T_OUT:
        # pops in on 12 fps steps, like a piece being placed
        k = math.floor((t - T_IN) * 12)
        scale = [0.8, 0.94, 1.03, 1.0][min(k, 3)]
        img = draw_caption(img, scale)
    img.save(os.path.join(DST, name))
print("CAPTIONED", DST)
