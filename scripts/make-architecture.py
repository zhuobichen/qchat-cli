#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
画 qchat-cli 的架构图（README 用）。

为什么手绘而不是 AI 生图：架构图里的组件名、端口号、数据目录一个字都不能错，
文生图模型只会把文字画成鬼画符。这里用 PIL 精确排版，改一个名字就重跑一次。

产物：docs/images/architecture.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images", "architecture.png")

F_BD = r"C:\Windows\Fonts\msyhbd.ttc"
F_RG = r"C:\Windows\Fonts\msyh.ttc"
F_MONO = r"C:\Windows\Fonts\consola.ttf"

W, H = 1680, 1220
BG = (11, 18, 32)
PANEL = (20, 30, 48)
PANEL2 = (24, 36, 58)
BORDER = (44, 62, 90)
WHITE = (238, 244, 252)
MUTED = (150, 170, 196)
TEAL = (64, 224, 208)
AMBER = (255, 196, 96)
VIOLET = (166, 148, 255)
PINK = (255, 128, 168)


def font(path, size):
    return ImageFont.truetype(path, size)


def center_text(d, box, text, f, fill):
    x0, y0, x1, y1 = box
    tw = d.textlength(text, font=f)
    th = f.size
    d.text(((x0 + x1 - tw) / 2, (y0 + y1 - th) / 2 - th * 0.08), text, font=f, fill=fill)


def box(d, rect, title, subtitle=None, accent=TEAL, f_title=None, f_sub=None, fill=PANEL):
    x0, y0, x1, y1 = rect
    d.rounded_rectangle(rect, radius=18, fill=fill, outline=accent, width=2)
    if subtitle:
        center_text(d, (x0, y0 + 10, x1, y0 + (y1 - y0) * 0.55), title, f_title, WHITE)
        center_text(d, (x0, y0 + (y1 - y0) * 0.52, x1, y1 - 8), subtitle, f_sub, MUTED)
    else:
        center_text(d, rect, title, f_title, WHITE)


def arrow(d, p0, p1, color=BORDER, width=3, dash=False):
    d.line([p0, p1], fill=color, width=width)
    # 箭头
    import math
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    L = 14
    for da in (2.6, -2.6):
        d.line([p1, (p1[0] + L * math.cos(ang + da), p1[1] + L * math.sin(ang + da))], fill=color, width=width)


def background():
    """底图用 MiniMax 生成的科技背景（无文字），再压暗一层保证叠字可读。

    为什么不直接让生图模型把整张图连字一起画：实测它把组件名画成
    「ФС Sole 1」这种鬼画符——架构图里一个名字错了就是误导。
    所以分工是：模型负责氛围和质感，文字和框线由代码叠上去。
    """
    src = os.path.join(ROOT, "output", "gen", "arch-bg.jpg")
    if not os.path.exists(src):
        return Image.new("RGB", (W, H), BG)
    bg = Image.open(src).convert("RGB").resize((W, H), Image.LANCZOS)
    veil = Image.new("RGB", (W, H), BG)
    return Image.blend(bg, veil, 0.72)


def main():
    img = background()
    d = ImageDraw.Draw(img)

    f_h1 = font(F_BD, 44)
    f_h2 = font(F_BD, 26)
    f_body = font(F_RG, 22)
    f_small = font(F_RG, 19)
    f_mono = font(F_MONO, 19)
    f_chip = font(F_MONO, 17)

    # 标题
    d.text((70, 44), "qchat-cli 架构", font=f_h1, fill=WHITE)
    d.text((70, 104), "一条 QQ 消息从客户端到本地数据的完整路径；虚线框是常驻旁路", font=f_body, fill=MUTED)

    # ── 1. QQ 客户端 ──
    box(d, (600, 160, 1080, 236), "手机 QQ / QQNT 客户端", None, accent=VIOLET, f_title=f_h2, fill=PANEL2)

    # ── 2. NapCat ──
    box(d, (520, 292, 1160, 386), "NapCat（QQNT 注入 / Shell）",
        "把 QQ 协议翻译成 OneBot 11  ·  HTTP :3000 + WebSocket", accent=TEAL, f_title=f_h2, f_sub=f_small)
    arrow(d, (840, 236), (840, 292))

    # ── 3. 两条通道 ──
    box(d, (520, 440, 820, 512), "HTTP :3000", "api 调用 · 拉历史 · 发送", accent=AMBER, f_title=f_body, f_sub=f_small)
    box(d, (876, 440, 1176, 512), "WebSocket", "事件推送 · 戳一戳 · 新消息", accent=AMBER, f_title=f_body, f_sub=f_small)
    arrow(d, (740, 386), (670, 440))
    arrow(d, (940, 386), (1010, 440))

    # ── 4. qce 核心 ──
    core = (150, 566, 1530, 806)
    d.rounded_rectangle(core, radius=22, fill=PANEL, outline=TEAL, width=3)
    d.text((186, 588), "qce  ·  工具层", font=f_h2, fill=TEAL)
    d.text((186, 628), "所有动作只有一种参数写法、一种返回格式；CLI 与 MCP 共用同一层", font=f_small, fill=MUTED)

    chips_y = 672
    chips = [
        ("export", "导出 md/json/html"),
        ("digest", "群日报"),
        ("index·search", "本地索引 · 秒搜"),
        ("say·pic·media", "发消息"),
        ("poke", "戳一戳"),
        ("draw", "MiniMax 生图"),
        ("dispatch", "派活给子会话"),
        ("mcp", "给 Claude/Codex 用"),
    ]
    cw, gap = 156, 12
    x = 186
    for name, desc in chips:
        r = (x, chips_y, x + cw, chips_y + 96)
        d.rounded_rectangle(r, radius=12, fill=PANEL2, outline=BORDER, width=2)
        center_text(d, (r[0] + 2, r[1] + 6, r[2] - 2, r[1] + 46), name, f_chip, WHITE)
        center_text(d, (r[0] + 4, r[1] + 48, r[2] - 4, r[3] - 8), desc, font(F_RG, 16), MUTED)
        x += cw + gap

    arrow(d, (670, 512), (560, 566))
    arrow(d, (1010, 512), (1120, 566))

    # ── 5. 存储 ──
    stores = [
        (150, ".qce-index/", "群消息本地索引\n（搜索/日报不联网）", TEAL),
        (620, "private/", "表情库 963 · 梗库 4576\n记忆 · 规则 · 人格", PINK),
        (1090, "output/", "导出文件 · 生成图\n日志 · 死信队列", AMBER),
    ]
    for sx, title, desc, accent in stores:
        r = (sx, 856, sx + 440, 986)
        d.rounded_rectangle(r, radius=18, fill=PANEL, outline=accent, width=2)
        d.text((sx + 22, 872), title, font=f_mono, fill=accent)
        d.multiline_text((sx + 22, 906), desc, font=f_small, fill=MUTED, spacing=6)
        arrow(d, (sx + 220, 806), (sx + 220, 856))

    # ── 6. 常驻旁路 ──
    dash = (380, 1052, 1300, 1192)
    # 虚线框
    x0, y0, x1, y1 = dash
    step = 16
    for xx in range(x0, x1, step * 2):
        d.line([(xx, y0), (min(xx + step, x1), y0)], fill=BORDER, width=2)
        d.line([(xx, y1), (min(xx + step, x1), y1)], fill=BORDER, width=2)
    for yy in range(y0, y1, step * 2):
        d.line([(x0, yy), (x0, min(yy + step, y1))], fill=BORDER, width=2)
        d.line([(x1, yy), (x1, min(yy + step, y1))], fill=BORDER, width=2)

    d.text((x0 + 18, y0 + 8), "常驻旁路（脱离主会话跑）", font=font(F_RG, 17), fill=MUTED)
    side = [
        ("qq-watch", "轮询新消息 → 投进会话", TEAL),
        ("qq-watchdog", "体检 · 熔断 · 推二维码", AMBER),
        ("qq-poke-watch", "WS 收戳 · 自动还手", VIOLET),
        ("dispatch 车道", "cli / software / data", PINK),
    ]
    for i, (name, desc, accent) in enumerate(side):
        bx = x0 + 20 + i * 224
        r = (bx, y0 + 44, bx + 208, y1 - 18)
        d.rounded_rectangle(r, radius=14, fill=PANEL2, outline=accent, width=2)
        f_side = font(F_BD, 19) if any("一" <= ch <= "鿿" for ch in name) else f_mono
        center_text(d, (r[0] + 2, r[1] + 8, r[2] - 2, r[1] + 46), name, f_side, accent)
        center_text(d, (r[0] + 6, r[1] + 50, r[2] - 6, r[3] - 10), desc, font(F_RG, 16), MUTED)

    # 外部服务角标
    d.text((70, 1180), "外部 API：千问视觉 · MiniMax image-01 · DeepSeek", font=font(F_RG, 17), fill=MUTED)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print("ARCH=" + OUT)


if __name__ == "__main__":
    main()
