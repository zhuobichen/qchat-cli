#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
像素风架构图（第二轮）。

第一轮的两个问题：标题叠了两遍、框子大而空、边框只有 1 逻辑像素所以不像 8-bit。
这一轮：
  · 所有方块留 2 逻辑像素粗边 + 左上高光 + 右下暗边（像素画的经典 bevel）
  · 布局按内容收紧，不留大片空白
  · 文字只在放大后写一遍，绝不和低分辨率层重复

产物：docs/images/architecture.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images", "architecture.png")

SCALE = 3
LW, LH = 560, 420
W, H = LW * SCALE, LH * SCALE

F_BD = r"C:\Windows\Fonts\msyhbd.ttc"
F_MONO = r"C:\Windows\Fonts\consolab.ttf"

NAVY = (10, 14, 34)
PANEL = (18, 26, 56)
INK = (6, 9, 22)
CYAN = (53, 226, 208)
MAGENTA = (255, 61, 129)
CREAM = (255, 219, 130)
GRAY = (120, 132, 164)
LIME = (168, 255, 96)
VIOLET = (166, 140, 255)
WHITE = (240, 246, 255)


def bevel_box(d, x, y, w, h, fill, edge):
    """像素方块：2px 外框 + 内侧高光/暗边，做出凸起的块感。"""
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=fill)
    d.rectangle([x, y, x + w - 1, y + h - 1], outline=edge, width=2)
    d.line([(x + 2, y + 2), (x + w - 3, y + 2)], fill=_light(edge, 0.55))
    d.line([(x + 2, y + 2), (x + 2, y + h - 3)], fill=_light(edge, 0.55))
    d.line([(x + 2, y + h - 3), (x + w - 3, y + h - 3)], fill=_dark(edge, 0.45))
    d.line([(x + w - 3, y + 2), (x + w - 3, y + h - 3)], fill=_dark(edge, 0.45))


def _light(c, t):
    return tuple(min(255, int(v + (255 - v) * t)) for v in c)


def _dark(c, t):
    return tuple(max(0, int(v * (1 - t))) for v in c)


def px_arrow(d, x1, y1, x2, y2, color):
    d.line([(x1, y1), (x2, y2)], fill=color, width=3)
    if y1 == y2:
        s = 1 if x2 > x1 else -1
        d.polygon([(x2, y2), (x2 - 7 * s, y2 - 5), (x2 - 7 * s, y2 + 5)], fill=color)
    else:
        s = 1 if y2 > y1 else -1
        d.polygon([(x2, y2), (x2 - 5, y2 - 7 * s), (x2 + 5, y2 - 7 * s)], fill=color)


def dither(d):
    """棋盘抖动底：像素游戏里处理深色大面积的标准手法。"""
    for y in range(0, LH, 6):
        for x in range(0, LW, 6):
            if (x // 6 + y // 6) % 2 == 0:
                d.rectangle([x, y, x + 2, y + 2], fill=(15, 21, 46))


def main():
    small = Image.new("RGB", (LW, LH), NAVY)
    d = ImageDraw.Draw(small)
    dither(d)

    # ── 标题条 ──
    bevel_box(d, 14, 10, 210, 26, PANEL, CYAN)

    # ── 1. QQ 客户端 ──
    bevel_box(d, 200, 52, 160, 28, PANEL, VIOLET)
    px_arrow(d, 280, 80, 280, 92, GRAY)

    # ── 2. NapCat ──
    bevel_box(d, 150, 92, 260, 34, PANEL, CYAN)
    px_arrow(d, 226, 126, 198, 142, GRAY)
    px_arrow(d, 334, 126, 362, 142, GRAY)

    # ── 3. 两条通道 ──
    bevel_box(d, 134, 142, 128, 26, PANEL, CREAM)
    bevel_box(d, 298, 142, 128, 26, PANEL, MAGENTA)
    px_arrow(d, 198, 168, 198, 182, GRAY)
    px_arrow(d, 362, 168, 362, 182, GRAY)

    # ── 4. qce 工具层 ──
    bevel_box(d, 30, 182, 500, 108, PANEL, CYAN)
    chips = [
        ("export", CYAN), ("digest", CYAN), ("index", CREAM), ("search", CREAM),
        ("say·pic", MAGENTA), ("poke", MAGENTA), ("draw", VIOLET), ("dispatch", LIME),
    ]
    for i, (name, col) in enumerate(chips):
        cx = 44 + (i % 4) * 120
        cy = 214 + (i // 4) * 30
        bevel_box(d, cx, cy, 108, 22, INK, col)

    # ── 5. 存储 ──
    for i, col in enumerate([CYAN, MAGENTA, CREAM]):
        bx = 30 + i * 168
        px_arrow(d, bx + 62, 290, bx + 62, 302, GRAY)
        bevel_box(d, bx, 302, 148, 28, PANEL, col)

    # ── 6. 常驻旁路 ──
    for i, col in enumerate([CYAN, CREAM, VIOLET, MAGENTA]):
        bevel_box(d, 30 + i * 126, 348, 114, 24, INK, col)

    big = small.resize((W, H), Image.NEAREST)

    # ── 放大后统一写字 ──
    dt = ImageDraw.Draw(big)
    f_title = ImageFont.truetype(F_BD, 30)
    f_sub = ImageFont.truetype(F_BD, 20)
    f_box = ImageFont.truetype(F_BD, 26)
    f_mono = ImageFont.truetype(F_MONO, 21)
    f_small = ImageFont.truetype(F_BD, 17)

    def center(text, x, y, w, h, font, fill):
        tw = dt.textlength(text, font=font)
        dt.text((x * SCALE + (w * SCALE - tw) / 2, y * SCALE + (h * SCALE - font.size) / 2 - font.size * 0.10),
                text, font=font, fill=fill)

    dt.text((22 * SCALE, 15 * SCALE), "qchat-cli 架构", font=f_title, fill=CREAM)
    dt.text((236 * SCALE, 18 * SCALE), "一条 QQ 消息 → 本地数据", font=f_sub, fill=GRAY)

    center("手机 QQ / QQNT", 200, 52, 160, 28, f_box, WHITE)
    center("NapCat · OneBot 11", 150, 92, 260, 34, f_box, CYAN)

    center("HTTP :3000", 134, 142, 128, 26, f_mono, CREAM)
    center("WebSocket", 298, 142, 128, 26, f_mono, MAGENTA)

    dt.text((44 * SCALE, 190 * SCALE), "qce · 工具层", font=f_sub, fill=CYAN)

    for i, (name, col) in enumerate(chips):
        center(name, 44 + (i % 4) * 120, 214 + (i // 4) * 30, 108, 22, f_mono, col)

    for i, (name, col) in enumerate([(".qce-index", CYAN), ("private", MAGENTA), ("output", CREAM)]):
        center(name, 30 + i * 168, 302, 148, 28, f_mono, col)

    for i, (name, col) in enumerate([("watch", CYAN), ("watchdog", CREAM), ("poke-watch", VIOLET), ("lanes", MAGENTA)]):
        center(name, 30 + i * 126, 348, 114, 24, f_mono, col)

    dt.text((30 * SCALE, 380 * SCALE), "常驻旁路：脱离主会话，各管一段", font=f_small, fill=GRAY)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    big.save(OUT, "PNG", optimize=True)
    print("ARCH=" + OUT)


if __name__ == "__main__":
    main()
