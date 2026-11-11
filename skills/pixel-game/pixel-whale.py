#!/usr/bin/env python3
"""
像素游戏风：320×180 内部分辨率，最近邻放大 6 倍到 1920×1080。

这是 carl-motion 第 18 号风格「Pixel Game」的引擎实现（上游只有提示词，没有源码）。
按它的规格写：
  - 内部 320×180，最近邻整数放大 6 倍
  - 16 色有限调色板（不是 32，肉眼更"老机器"）
  - 精灵 8fps 阶梯帧，背景视差卷轴
  - 所有坐标取整，一用插值/缓动就糊
  - dithering（棋盘网点）做渐变
  - HUD 字用像素字体

题材：吃白饭的大肥鱼。一条像素鲸鱼悬在半空，
下面一碗饭，星星视差滚动，右下角 HUD 显示状态条。

用法：
  python3 pixel-whale.py <帧目录>
  ONLY=30,90,150,210 python3 pixel-whale.py <帧目录>   # 只出几帧看效果
"""
import os
import sys

import numpy as np
from PIL import Image

# ── 规格 ────────────────────────────────────────────────
IW, IH = 320, 180          # 内部像素分辨率
SCALE = 6                  # 整数倍放大 → 1920×1080
W, H = IW * SCALE, IH * SCALE
FPS, N = 30, 240           # 30fps 8 秒
SPRITE_FPS = 8             # 精灵阶梯帧率（不是 30）

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

# ── 16 色调色板 ────────────────────────────────────────
# 深紫夜色 + 暖白 + 一档青 + 一点橙，够用了。
PALETTE = [
    (0x0d, 0x0b, 0x1f),   # 0  夜底
    (0x1a, 0x16, 0x33),   # 1  暗紫
    (0x2a, 0x22, 0x4d),   # 2  紫
    (0x4e, 0x3e, 0xb8),   # 3  主紫（上游给的 palette）
    (0x6a, 0x5a, 0xd6),   # 4  亮紫
    (0x9a, 0x8d, 0xf0),   # 5  紫高光
    (0x14, 0x2a, 0x3a),   # 6  青暗
    (0x1f, 0x5a, 0x5c),   # 7  青
    (0x35, 0x8a, 0x76),   # 8  青亮
    (0x7c, 0xd6, 0xa1),   # 9  青高光
    (0x2a, 0x1a, 0x10),   # 10 褐暗
    (0x5c, 0x3a, 0x1c),   # 11 褐
    (0xa8, 0x7a, 0x3c),   # 12 金
    (0xf0, 0xd8, 0x9a),   # 13 米白（饭）
    (0xf5, 0xf0, 0xe0),   # 14 白
    (0xe8, 0x74, 0x44),   # 15 橙（HUD 警示）
]

# ── 像素字体（3×5，够真像素）───────────────────────────
FONT = {
    'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011',
    'D': '110101101101110', 'E': '111100110100111', 'F': '111100110100100',
    'G': '011100101101011', 'H': '101101111101101', 'I': '111010010010111',
    'J': '001001001101010', 'K': '101101110101101', 'L': '100100100100111',
    'M': '101111111101101', 'N': '101111111111101', 'O': '010101101101010',
    'P': '110101110100100', 'Q': '010101101110011', 'R': '110101110101101',
    'S': '011100010001110', 'T': '111010010010010', 'U': '101101101101111',
    'V': '101101101101010', 'W': '101101111111101', 'X': '101101010101101',
    'Y': '101101010010010', 'Z': '111001010100111',
    '0': '111101101101111', '1': '010110010010111', '2': '110001010100111',
    '3': '110001010001110', '4': '101101111001001', '5': '111100110001110',
    '6': '011100110101010', '7': '111001010010010', '8': '010101010101010',
    '9': '010101011001110',
    ' ': '000000000000000', '.': '000000000000010', ':': '000010000010000',
    '/': '001001010100100', '-': '000000111000000', '%': '101001010100101',
    '!': '010010010000010', '+': '000010111010000', '>': '100010001010100',
}


def text(buf, s, x, y, color):
    """在像素缓冲上写字，坐标取整。"""
    cx = int(x)
    for ch in s.upper():
        bits = FONT.get(ch, FONT[' '])
        for i, b in enumerate(bits):
            if b == '1':
                px, py = cx + (i % 3), int(y) + (i // 3)
                if 0 <= px < IW and 0 <= py < IH:
                    buf[py, px] = color
        cx += 4
    return buf


def dither_rect(buf, x0, y0, x1, y1, color, density=0.5):
    """棋盘网点填充，做"两级色阶之间的过渡"。"""
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    for y in range(max(0, y0), min(IH, y1)):
        for x in range(max(0, x0), min(IW, x1)):
            if ((x + y) & 1) == 0 and density >= 0.5:
                buf[y, x] = color
            elif density > 0.2 and ((x + y) & 3) == 0:
                buf[y, x] = color
    return buf


# ── 精灵：像素鲸鱼（用整数坐标画，靠 body 宽高做呼吸）────
def draw_whale(buf, cx, cy, body_h, tail_phase):
    """大肥鱼：椭圆身子 + 三角尾鳍 + 一个白点眼 + 头顶喷水。"""
    cx, cy = int(cx), int(cy)
    bw = 46                     # 身长
    bh = int(body_h)            # 身厚（呼吸变化）

    # 身子：逐行填，宽窄按椭圆算，边缘一档高光一档暗边
    for dy in range(-bh, bh + 1):
        t = dy / max(bh, 1)
        half = int(bw / 2 * np.sqrt(max(0.0, 1 - t * t)))
        if half <= 0:
            continue
        y = cy + dy
        if not (0 <= y < IH):
            continue
        x0, x1 = cx - half, cx + half
        for x in range(max(0, x0), min(IW, x1)):
            # 上缘高光、下缘暗
            if dy < -bh * 0.45:
                c = 9 if (x - x0) > half * 0.5 else 8
            elif dy > bh * 0.5:
                c = 6
            else:
                c = 7
            buf[y, x] = c

    # 尾鳍：三角，跟着 tail_phase 上下摆（阶梯，不是平滑）
    kick = int(round((tail_phase - 0.5) * 16))
    for i in range(10):
        y = cy + int(i * 0.8) - 2 + kick // 2
        h = 10 - i
        for x in range(cx + bw // 2 - 2, cx + bw // 2 + h):
            if 0 <= y < IH and 0 <= x < IW:
                buf[y, x] = 8
        y2 = cy - int(i * 0.8) + 2 + kick // 2
        for x in range(cx + bw // 2 - 2, cx + bw // 2 + h):
            if 0 <= y2 < IH and 0 <= x < IW:
                buf[y2, x] = 7

    # 眼睛：一个白点 + 一档高光，不画圈
    ex, ey = cx - bw // 3, cy - bh // 4
    if 0 <= ey < IH and 0 <= ex < IW:
        buf[ey, ex] = 14
        if ey + 1 < IH:
            buf[ey + 1, ex] = 0

    # 头顶喷水：3 个像素点往上，随呼吸升
    top = cy - bh - 2
    for i in range(3):
        py = top - i * 3
        px = cx + (i - 1)
        if 0 <= py < IH and 0 <= px < IW:
            buf[py, px] = 9 if i == 0 else 8


def draw_bowl(buf, cx, cy, fill_h, rice_color=13):
    """一碗白饭：梯形碗 + 上面堆的饭。"""
    cx, cy = int(cx), int(cy)
    # 碗：上宽下窄
    for i in range(10):
        y = cy + i
        half = 18 - i
        for x in range(cx - half, cx + half):
            if 0 <= y < IH and 0 <= x < IW:
                buf[y, x] = 12 if i < 2 else 11
    # 饭堆：高度随 fill_h
    fh = int(fill_h)
    for i in range(max(0, fh)):
        y = cy - 1 - i
        half = max(2, 16 - i * 2)
        for x in range(cx - half, cx + half):
            if 0 <= y < IH and 0 <= x < IW:
                buf[y, x] = rice_color


def draw_stars(buf, t, layers):
    """视差星星：越远的层滚动越慢。"""
    for li, (count, speed, color, yy) in enumerate(layers):
        for i in range(count):
            sx = int((i * 73 + t * speed * 20) % (IW + 20)) - 10
            sy = int(yy + (i * 37) % 40)
            if 0 <= sx < IW and 0 <= sy < IH:
                buf[sy, sx] = color


def render(fi):
    t = fi / FPS
    step = int(t * SPRITE_FPS)          # 精灵阶梯帧序号
    st = step / SPRITE_FPS              # 阶梯时间（不是连续 t）

    buf = np.zeros((IH, IW), np.uint8)

    # 背景：上暗下紫，用 dithering 做过渡（不用插值）
    buf[:, :] = 0
    dither_rect(buf, 0, 0, IW, 70, 1, 0.5)
    dither_rect(buf, 0, 60, IW, 110, 2, 0.5)
    dither_rect(buf, 0, 100, IW, 140, 1, 0.5)

    # 视差星空：三层，速度不同
    draw_stars(buf, st, [
        (26, 0.35, 2, 6),
        (14, 0.9, 5, 26),
        (8, 1.8, 9, 44),
    ])

    # 地平线（一条整数线，不抗锯齿）
    for x in range(IW):
        y = 138 + int(np.sin(x * 0.05) * 2)
        if 0 <= y < IH:
            buf[y, x] = 3

    # 碗：0.5s 起慢慢装满（阶梯，不是平滑上升）
    bowl_prog = max(0.0, min(1.0, (t - 0.5) / 2.0))
    draw_bowl(buf, 80, 132, bowl_prog * 10)

    # 大肥鱼：1.0s 起升起来，之后一直呼吸浮动
    if t > 1.0:
        rise = min(1.0, (t - 1.0) / 0.8)
        base_y = 86 - rise * 34
        # 浮动取整（像素风不能有半像素）
        bob = int(round(np.sin(st * 2.0) * 3))
        body_h = 10 + int(round(np.sin(st * 1.5) * 1.2))   # 呼吸导致身厚变化
        tail_phase = (np.sin(st * 2.6) + 1) / 2
        draw_whale(buf, 200, base_y + bob, body_h, tail_phase)

    # HUD：右上角状态条 + 字
    buf[6:8, IW - 90:IW - 8] = 3
    fillw = int(82 * (0.35 + 0.5 * (np.sin(st * 0.8) + 1) / 2))
    buf[6:8, IW - 90:IW - 90 + fillw] = 15
    text(buf, 'RICE 100%', IW - 90, 11, 13)
    text(buf, 'FISH IDLE', IW - 90, 18, 7)

    # 底部滚动字幕（视差最慢层）
    banner = 'A FISH THAT EATS WHITE RICE AND STILL HAS NOTHING TO DO  //  '
    off = int((st * 22) % len(banner) * 4)
    text(buf, banner, 4 - off, 168, 5)

    # 放大：最近邻，整数倍
    img = Image.fromarray(buf, 'P')
    img.putpalette([v for rgb in PALETTE for v in rgb] + [0] * (768 - 48))
    img = img.resize((W, H), Image.NEAREST)
    img.convert('RGB').save(os.path.join(OUT, f'{fi + 1:04d}.png'))


if __name__ == '__main__':
    only = os.environ.get('ONLY', '').strip()
    if only:
        for s in only.split(','):
            render(int(s))
            print('frame', s)
    else:
        for i in range(N):
            render(i)
        print('frames', N)
