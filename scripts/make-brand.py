#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 MiniMax 生成的吉祥物 + 文字，合成一张品牌图（README 头部用）。

为什么不用 AI 直接出带字的图：中文文字在文生图模型里几乎必崩（偏旁错位、多字少字），
而 README 头部的品牌名一个字都不能错。所以拆成两步：
  1) AI 只出图形（no text）
  2) 文字用 PIL 精确排版 —— 字体、字距、对齐都可控，还能自动缩到不出界

产物：
  docs/images/brand.png      1600x520 横版（含 logo + 文字）
  logo.png                   512x512 方形图标（README <img> 用）
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "output", "gen", "logo-mascot.jpg")

FONT_BD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_RG = r"C:\Windows\Fonts\msyh.ttc"

NAVY = (11, 18, 32)
TEAL = (64, 224, 208)


def load_mark(size=512):
    """裁出中间那块圆角方图，并给自己套一个圆角遮罩。

    不遮的话会留一圈 AI 图自带的浅色边，贴在渐变底上像一块补丁。
    """
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    side = int(min(w, h) * 0.47)
    cx, cy = w // 2, h // 2
    crop = im.crop((cx - side // 2, cy - side // 2, cx + side // 2, cy + side // 2))
    crop = crop.resize((size, size), Image.LANCZOS)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(crop, (0, 0), mask)
    return out


def fit_font(draw, text, font_path, start_size, max_width, min_size=18):
    """字号自动缩到放得下为止——中文文案一改，硬编码字号就会出界。"""
    size = start_size
    while size > min_size:
        f = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=f) <= max_width:
            return f
        size -= 2
    return ImageFont.truetype(font_path, min_size)


def main():
    mark = load_mark(512)
    os.makedirs(os.path.join(ROOT, "docs", "images"), exist_ok=True)
    logo_path = os.path.join(ROOT, "logo.png")
    mark.save(logo_path, "PNG")

    W, H = 1600, 520
    canvas = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(canvas)
    for x in range(W):
        t = x / W
        d.line([(x, 0), (x, H)], fill=(
            int(NAVY[0] + 14 * t),
            int(NAVY[1] + 22 * t),
            int(NAVY[2] + 34 * t),
        ))

    icon_size = 296
    icon = mark.resize((icon_size, icon_size), Image.LANCZOS)
    icon_x, icon_y = 92, (H - icon_size) // 2
    canvas.paste(icon, (icon_x, icon_y), icon)

    tx = icon_x + icon_size + 72
    avail = W - tx - 64

    f_title = ImageFont.truetype(FONT_BD, 118)
    d.text((tx, 108), "qchat-cli", font=f_title, fill=(255, 255, 255))

    sub = "把 QQ 里发生过的事，变成可导出、可监听、可派活的数据"
    f_sub = fit_font(d, sub, FONT_RG, 40, avail)
    d.text((tx + 4, 268), sub, font=f_sub, fill=(212, 224, 238))

    d.line([(tx + 4, 348), (tx + 4 + avail, 348)], fill=(38, 56, 82), width=3)

    meta = "OneBot 11  ·  NapCat  ·  TypeScript  ·  local-first"
    f_meta = fit_font(d, meta, FONT_RG, 30, avail)
    d.text((tx + 4, 380), meta, font=f_meta, fill=TEAL)

    brand = os.path.join(ROOT, "docs", "images", "brand.png")
    canvas.save(brand, "PNG", optimize=True)
    print("BRAND=" + brand)
    print("LOGO=" + logo_path)


if __name__ == "__main__":
    main()
