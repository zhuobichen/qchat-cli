#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
qchat-cli 技术架构图（横向色带版）。

风格参考 weflow-cli 的架构图：
  · 若干条通栏色带，自上而下＝从入口到产物
  · 每条色带：一行粗体标题（分层名 + 冒号 + 并列条目，用 | 分隔）
  · 标题下面一排「图标 + 两行标签」的小格，格与格之间竖细线分隔
  · 中间一层如果是边界，用虚线框圈起来并标注边界名
  · 纯色、无渐变、无阴影、白色文字；整体克制

为什么不用生图模型：这张图有二十多个词，模型到这个密度必然画成鬼画符。
风格靠版式复制，事实靠代码写字。

产物：docs/images/architecture.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images", "architecture.png")

S = 2                       # 超采样：先画 2 倍再缩，边缘才干净
W, H = 1536 * S, 1330 * S

F_BD = r"C:\Windows\Fonts\msyhbd.ttc"
F_RG = r"C:\Windows\Fonts\msyh.ttc"

# 配色（取自 weflow 那套：深海军蓝 / 青绿 / 石板灰 / 琥珀）
NAVY = (27, 58, 87)
TEAL = (46, 158, 143)
SLATE = (79, 100, 120)
AMBER = (240, 166, 43)
WHITE = (255, 255, 255)
PAPER = (255, 255, 255)
MUTED = (214, 226, 235)


def band(d, y, h, color, title, cells, radius=14):
    """一条通栏色带：标题一行 + 一排「图标 + 两行标签」的格子。"""
    x0, x1 = 80 * S, (W // S - 80) * S
    d.rounded_rectangle([x0, y, x1, y + h], radius=radius * S, fill=color)

    f_l = ImageFont.truetype(F_BD, 18 * S)

    # 标题：长标题按可用宽度自动缩字号，别撑出色带
    size = 24
    while size > 12:
        f_t = ImageFont.truetype(F_BD, size * S)
        if d.textlength(title, font=f_t) <= (x1 - x0) - 80 * S:
            break
        size -= 1
    f_t = ImageFont.truetype(F_BD, size * S)
    tw = d.textlength(title, font=f_t)
    d.text(((x0 + x1 - tw) / 2, y + 16 * S), title, font=f_t, fill=WHITE)

    n = len(cells)
    cell_w = (x1 - x0 - 40 * S) / n
    top = y + 68 * S                    # 格子区从标题下方开始
    for i, (icon, l1, l2) in enumerate(cells):
        cx = x0 + 20 * S + i * cell_w
        if i:
            d.line([(cx, top + 6 * S), (cx, y + h - 20 * S)], fill=(255, 255, 255), width=1 * S)
        icon(cx + 16 * S, top + 34 * S, 15 * S)
        d.text((cx + 44 * S, top + 14 * S), l1, font=f_l, fill=WHITE)
        if l2:
            d.text((cx + 44 * S, top + 42 * S), l2, font=f_l, fill=MUTED)


def arrow(d, x, y0, y1):
    d.line([(x, y0), (x, y1 - 14 * S)], fill=(52, 73, 94), width=4 * S)
    d.polygon([(x, y1), (x - 12 * S, y1 - 20 * S), (x + 12 * S, y1 - 20 * S)], fill=(52, 73, 94))


# ── 线性图标（纯白，无填充，跟 weflow 那套同款语法） ──
def ic_terminal(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.rectangle([x, y - s * 0.6, x + s * 1.6, y + s * 0.7], outline=WHITE, width=int(2 * S))
    d.line([(x + s * 0.25, y - s * 0.2), (x + s * 0.6, y + s * 0.1)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 0.6, y + s * 0.1), (x + s * 0.25, y + s * 0.4)], fill=WHITE, width=int(2 * S))


def ic_server(x, y, s):
    d = ImageDraw.Draw(CUR)
    for i in range(3):
        yy = y - s * 0.7 + i * s * 0.55
        d.rounded_rectangle([x, yy, x + s * 1.6, yy + s * 0.42], radius=int(3 * S), outline=WHITE, width=int(2 * S))
        d.ellipse([x + s * 0.12, yy + s * 0.14, x + s * 0.26, yy + s * 0.28], fill=WHITE)


def ic_chat(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.rounded_rectangle([x, y - s * 0.6, x + s * 1.7, y + s * 0.45], radius=int(8 * S), outline=WHITE, width=int(2 * S))
    d.polygon([(x + s * 0.35, y + s * 0.45), (x + s * 0.75, y + s * 0.45), (x + s * 0.42, y + s * 0.85)], fill=WHITE)


def ic_search(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.ellipse([x, y - s * 0.7, x + s * 1.15, y + s * 0.45], outline=WHITE, width=int(2 * S))
    d.line([(x + s * 1.0, y + s * 0.32), (x + s * 1.6, y + s * 0.92)], fill=WHITE, width=int(3 * S))


def ic_db(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.ellipse([x, y - s * 0.8, x + s * 1.6, y - s * 0.35], outline=WHITE, width=int(2 * S))
    d.line([(x, y - s * 0.58), (x, y + s * 0.55)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 1.6, y - s * 0.58), (x + s * 1.6, y + s * 0.55)], fill=WHITE, width=int(2 * S))
    d.arc([x, y + s * 0.1, x + s * 1.6, y + s * 0.55], 0, 180, fill=WHITE, width=int(2 * S))


def ic_cloud(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.arc([x, y - s * 0.6, x + s * 0.9, y + s * 0.2], 150, 20, fill=WHITE, width=int(2 * S))
    d.arc([x + s * 0.5, y - s * 0.75, x + s * 1.5, y + s * 0.2], 180, 20, fill=WHITE, width=int(2 * S))
    d.line([(x + s * 0.1, y + s * 0.25), (x + s * 1.35, y + s * 0.25)], fill=WHITE, width=int(2 * S))


def ic_cube(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.polygon([(x + s * 0.8, y - s * 0.75), (x + s * 1.6, y - s * 0.3), (x + s * 0.8, y + s * 0.15), (x, y - s * 0.3)], outline=WHITE, width=int(2 * S))
    d.line([(x, y - s * 0.3), (x, y + s * 0.45)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 1.6, y - s * 0.3), (x + s * 1.6, y + s * 0.45)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 0.8, y + s * 0.15), (x + s * 0.8, y + s * 0.9)], fill=WHITE, width=int(2 * S))
    d.line([(x, y + s * 0.45), (x + s * 0.8, y + s * 0.9), (x + s * 1.6, y + s * 0.45)], fill=WHITE, width=int(2 * S))


def ic_chart(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.rectangle([x, y - s * 0.7, x + s * 1.6, y + s * 0.7], outline=WHITE, width=int(2 * S))
    d.line([(x + s * 0.3, y + s * 0.45), (x + s * 0.3, y - s * 0.1)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 0.75, y + s * 0.45), (x + s * 0.75, y - s * 0.35)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 1.2, y + s * 0.45), (x + s * 1.2, y + s * 0.05)], fill=WHITE, width=int(2 * S))


def ic_folder(x, y, s):
    d = ImageDraw.Draw(CUR)
    d.line([(x, y - s * 0.55), (x + s * 0.65, y - s * 0.55), (x + s * 0.85, y - s * 0.3), (x + s * 1.6, y - s * 0.3)], fill=WHITE, width=int(2 * S))
    d.rounded_rectangle([x, y - s * 0.35, x + s * 1.6, y + s * 0.7], radius=int(4 * S), outline=WHITE, width=int(2 * S))


CUR = None


def main():
    global CUR
    img = Image.new("RGB", (W, H), PAPER)
    CUR = img
    d = ImageDraw.Draw(img)

    f_note = ImageFont.truetype(F_RG, 17 * S)
    f_title = ImageFont.truetype(F_BD, 34 * S)

    d.text((80 * S, 40 * S), "qchat-cli 技术架构", font=f_title, fill=(23, 43, 63))
    d.text((80 * S, 88 * S), "一条 QQ 消息从客户端到本地产物的路径；虚线框是「不出本机」的边界", font=f_note, fill=(110, 128, 146))

    y = 140 * S

    band(d, y, 168 * S, NAVY, "ENTRY:  qce CLI   |   MCP Server   |   常驻监视器", [
        (ic_terminal, "qce CLI", "命令行入口"),
        (ic_server, "MCP", "stdio 给 agent"),
        (ic_chat, "watch", "新消息投递"),
    ])
    arrow(d, W // 2, y + 168 * S, y + 212 * S)
    y += 212 * S

    band(d, y, 168 * S, TEAL, "TOOL LAYER:  export  |  digest  |  search  |  say·pic  |  poke  |  draw  |  dispatch", [
        (ic_folder, "export / digest", "导出 · 日报"),
        (ic_search, "index / search", "本地索引"),
        (ic_chat, "say · pic · poke", "发消息 · 戳一戳"),
        (ic_cube, "draw", "MiniMax 生图"),
        (ic_server, "dispatch", "派活给子会话"),
    ])
    arrow(d, W // 2, y + 168 * S, y + 212 * S)
    y += 212 * S

    # ── 边界框：核心 + 数据 ──
    box_top = y - 18 * S
    band(d, y, 168 * S, SLATE, "CORE:  OneBot 客户端  |  HTTP :3000  |  WebSocket  |  索引  |  表情库  |  人格", [
        (ic_server, "OneBot", "HTTP :3000"),
        (ic_chat, "WebSocket", "事件推送"),
        (ic_db, "本地索引", ".qce-index"),
        (ic_folder, "素材库", "表情 · 梗 · 记忆"),
    ])
    arrow(d, W // 2, y + 168 * S, y + 212 * S)
    y += 212 * S

    band(d, y, 168 * S, SLATE, "DATA & INTEGRATIONS:  NapCat  |  千问视觉  |  MiniMax image-01  |  DeepSeek", [
        (ic_server, "NapCat", "QQNT 注入"),
        (ic_cloud, "千问视觉", "看图 / OCR"),
        (ic_cloud, "MiniMax", "生图"),
        (ic_cloud, "DeepSeek", "文字模型"),
    ])
    y += 168 * S

    # 虚线框 + 边界标注
    x0, x1 = 56 * S, (W // S - 56) * S
    _dash_rect(d, x0, box_top, x1, y + 22 * S)
    label = "LOCAL-FIRST PRIVACY BOUNDARY"
    f_b = ImageFont.truetype(F_BD, 20 * S)
    lw = d.textlength(label, font=f_b)
    ly = y + 22 * S
    d.rectangle([(x0 + x1) / 2 - lw / 2 - 14 * S, ly - 12 * S, (x0 + x1) / 2 + lw / 2 + 14 * S, ly + 12 * S], fill=PAPER)
    d.text(((x0 + x1) / 2 - lw / 2, ly - 12 * S), label, font=f_b, fill=(110, 128, 146))

    arrow(d, W // 2, y + 40 * S, y + 84 * S)
    y += 84 * S

    band(d, y, 168 * S, AMBER, "OUTPUTS:  导出文件  |  群日报  |  生成图  |  派活结论  |  QQ 消息", [
        (ic_folder, "导出", "md / json / html"),
        (ic_chart, "日报 · 索引", "本地，不联网"),
        (ic_cube, "生成图", "output/gen"),
        (ic_chat, "消息", "群 · 私聊"),
    ])

    # 缩小回目标尺寸，边缘干净
    img = img.resize((W // S, H // S), Image.LANCZOS)

    # 裁掉底部多余留白（内容高度会随文案变化，写死高度总会留一条白边）
    from PIL import ImageChops
    diff = ImageChops.difference(img, Image.new("RGB", img.size, PAPER))
    bbox = diff.getbbox()
    if bbox:
        pad = 40
        img = img.crop((0, 0, img.width, min(img.height, bbox[3] + pad)))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print("ARCH=" + OUT)


def _dash_rect(d, x0, y0, x1, y1, step=14, color=(120, 140, 160), width=2):
    step *= S
    width *= S
    for x in range(int(x0), int(x1), step * 2):
        d.line([(x, y0), (min(x + step, x1), y0)], fill=color, width=width)
        d.line([(x, y1), (min(x + step, x1), y1)], fill=color, width=width)
    for yy in range(int(y0), int(y1), step * 2):
        d.line([(x0, yy), (x0, min(yy + step, y1))], fill=color, width=width)
        d.line([(x1, yy), (x1, min(yy + step, y1))], fill=color, width=width)


if __name__ == "__main__":
    main()
