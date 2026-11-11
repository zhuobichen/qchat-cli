# S08 后期：轻扫描线 + 1px RGB 偏移 + 副标题线（6.0 s 起淡入）
# 用法: python3 post.py <in_frames_dir> <out_frames_dir>
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
FONT = ImageFont.truetype("/System/Library/Fonts/Avenir Next.ttc", 38, index=2)
TEXT = "SIDE A   ·   PLAY IT LOUD"
W, H = 1920, 1080
scan = np.ones((H, 1, 1), np.float32)
scan[::3] = 0.86


def caption_layer(alpha, y):
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    # 手动字距
    track = 9
    widths = [d.textlength(c, font=FONT) for c in TEXT]
    total = sum(widths) + track * (len(TEXT) - 1)
    x = (W - total) / 2
    a = int(255 * alpha)
    for c, w in zip(TEXT, widths):
        d.text((x, y), c, font=FONT, fill=(214, 246, 255, a))
        x += w + track
    lw = 150 * alpha
    cy = y + 24
    d.line([((W - total) / 2 - 40 - lw, cy), ((W - total) / 2 - 40, cy)], fill=(80, 230, 255, a), width=3)
    d.line([((W + total) / 2 + 40, cy), ((W + total) / 2 + 40 + lw, cy)], fill=(80, 230, 255, a), width=3)
    glow = lay.filter(ImageFilter.GaussianBlur(8))
    return Image.alpha_composite(glow, lay)


for f in range(1, 241):
    t = (f - 1) / 30
    im = Image.open(os.path.join(src, f"{f:04d}.png")).convert("RGB")
    if t >= 6.0:
        u = min(1.0, (t - 6.0) / 0.6)
        u = u * u * (3 - 2 * u)
        im = Image.alpha_composite(im.convert("RGBA"), caption_layer(u, 66 + 10 * (1 - u))).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    out = a.copy()
    out[:, 1:, 0] = a[:, :-1, 0]
    out[:, :-1, 2] = a[:, 1:, 2]
    out *= scan
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(os.path.join(dst, f"{f:04d}.png"), compress_level=1)
print("POST DONE")
