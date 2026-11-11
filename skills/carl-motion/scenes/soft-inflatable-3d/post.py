# S34 后期：结尾字幕（6.6 s 起淡入），A 的细字距说明字样式
# 用法: python3 post.py <in_frames_dir> <out_frames_dir>
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
EN = ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", 46, index=2)
ZH = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 42, index=2)
W, H = 1920, 1080


def spaced(d, text, font, y, track, alpha):
    ws = [d.textlength(c, font=font) for c in text]
    total = sum(ws) + track * (len(text) - 1)
    x = (W - total) / 2
    for c, w in zip(text, ws):
        d.text((x, y), c, font=font, fill=(10, 92, 64, alpha))
        x += w + track


for f in range(1, 241):
    t = (f - 1) / 30
    im = Image.open(os.path.join(src, f"{f:04d}.png")).convert("RGBA")
    if t >= 6.6:
        u = min(1.0, (t - 6.6) / 0.5)
        u = u * u * (3 - 2 * u)
        a = int(255 * u)
        lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        spaced(d, "BOUNCE BACK", EN, 880 + 8 * (1 - u), 14, a)
        spaced(d, "弹 回 来", ZH, 940 + 8 * (1 - u), 10, a)
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        sh.paste((255, 250, 228, int(170 * u)), mask=lay.split()[3])
        sh = sh.filter(ImageFilter.GaussianBlur(6))
        im = Image.alpha_composite(Image.alpha_composite(im, sh), lay)
    im.convert("RGB").save(os.path.join(dst, f"{f:04d}.png"), compress_level=1)
print("POST DONE")
