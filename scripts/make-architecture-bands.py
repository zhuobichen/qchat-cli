#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
qchat-cli 技术架构图（横向色带版，细版）。

版式参考 weflow-cli 的架构图：通栏色带、标题行用 | 分隔条目、图标格、虚线边界、箭头下行。
这一版把项目里真实存在的东西摊开：入口、工具层、核心模块、外部服务、本地存储、产物。
宁可挤一点，也别只画五个框糊弄人。

产物：docs/images/architecture.png
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images", "architecture.png")

S = 2
CW, CH = 1600, 1900
W, H = CW * S, CH * S

F_BD = r"C:\Windows\Fonts\msyhbd.ttc"
F_RG = r"C:\Windows\Fonts\msyh.ttc"

NAVY = (27, 58, 87)
TEAL = (46, 158, 143)
SLATE = (79, 100, 120)
DEEP = (58, 76, 94)
INDIGO = (62, 78, 138)
AMBER = (240, 166, 43)
WHITE = (255, 255, 255)
PAPER = (255, 255, 255)
MUTED = (208, 222, 233)
INK = (23, 43, 63)
SUB = (110, 128, 146)

CUR = None


def _d():
    return ImageDraw.Draw(CUR)


# ── 线性图标（纯白描边，无填充） ──
def ic_terminal(x, y, s):
    d = _d()
    d.rectangle([x, y - s * 0.62, x + s * 1.6, y + s * 0.62], outline=WHITE, width=int(2 * S))
    d.line([(x + s * 0.28, y - s * 0.18), (x + s * 0.62, y + s * 0.12)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 0.62, y + s * 0.12), (x + s * 0.28, y + s * 0.42)], fill=WHITE, width=int(2 * S))


def ic_server(x, y, s):
    d = _d()
    for i in range(3):
        yy = y - s * 0.7 + i * s * 0.52
        d.rounded_rectangle([x, yy, x + s * 1.6, yy + s * 0.4], radius=int(3 * S), outline=WHITE, width=int(2 * S))
        d.ellipse([x + s * 0.14, yy + s * 0.13, x + s * 0.28, yy + s * 0.27], fill=WHITE)


def ic_chat(x, y, s):
    d = _d()
    d.rounded_rectangle([x, y - s * 0.6, x + s * 1.7, y + s * 0.4], radius=int(7 * S), outline=WHITE, width=int(2 * S))
    d.polygon([(x + s * 0.35, y + s * 0.4), (x + s * 0.8, y + s * 0.4), (x + s * 0.42, y + s * 0.82)], fill=WHITE)


def ic_search(x, y, s):
    d = _d()
    d.ellipse([x, y - s * 0.7, x + s * 1.1, y + s * 0.4], outline=WHITE, width=int(2 * S))
    d.line([(x + s * 0.98, y + s * 0.3), (x + s * 1.6, y + s * 0.92)], fill=WHITE, width=int(3 * S))


def ic_db(x, y, s):
    d = _d()
    d.ellipse([x, y - s * 0.78, x + s * 1.6, y - s * 0.36], outline=WHITE, width=int(2 * S))
    d.line([(x, y - s * 0.57), (x, y + s * 0.55)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 1.6, y - s * 0.57), (x + s * 1.6, y + s * 0.55)], fill=WHITE, width=int(2 * S))
    d.arc([x, y + s * 0.08, x + s * 1.6, y + s * 0.55], 0, 180, fill=WHITE, width=int(2 * S))


def ic_cloud(x, y, s):
    d = _d()
    d.arc([x, y - s * 0.62, x + s * 0.95, y + s * 0.16], 150, 20, fill=WHITE, width=int(2 * S))
    d.arc([x + s * 0.5, y - s * 0.78, x + s * 1.5, y + s * 0.16], 180, 20, fill=WHITE, width=int(2 * S))
    d.line([(x + s * 0.12, y + s * 0.22), (x + s * 1.4, y + s * 0.22)], fill=WHITE, width=int(2 * S))


def ic_cube(x, y, s):
    d = _d()
    d.polygon([(x + s * 0.8, y - s * 0.72), (x + s * 1.6, y - s * 0.3),
               (x + s * 0.8, y + s * 0.12), (x, y - s * 0.3)], outline=WHITE, width=int(2 * S))
    d.line([(x, y - s * 0.3), (x, y + s * 0.42)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 1.6, y - s * 0.3), (x + s * 1.6, y + s * 0.42)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 0.8, y + s * 0.12), (x + s * 0.8, y + s * 0.86)], fill=WHITE, width=int(2 * S))
    d.line([(x, y + s * 0.42), (x + s * 0.8, y + s * 0.86), (x + s * 1.6, y + s * 0.42)], fill=WHITE, width=int(2 * S))


def ic_folder(x, y, s):
    d = _d()
    d.line([(x, y - s * 0.55), (x + s * 0.62, y - s * 0.55), (x + s * 0.82, y - s * 0.28),
            (x + s * 1.6, y - s * 0.28)], fill=WHITE, width=int(2 * S))
    d.rounded_rectangle([x, y - s * 0.32, x + s * 1.6, y + s * 0.68], radius=int(4 * S), outline=WHITE, width=int(2 * S))


def ic_chart(x, y, s):
    d = _d()
    d.rectangle([x, y - s * 0.7, x + s * 1.6, y + s * 0.7], outline=WHITE, width=int(2 * S))
    for dx, top in ((0.28, 0.42), (0.72, -0.34), (1.16, 0.04)):
        d.line([(x + s * dx, y + s * 0.44), (x + s * dx, y + s * top)], fill=WHITE, width=int(2 * S))


def ic_shield(x, y, s):
    d = _d()
    d.polygon([(x + s * 0.8, y - s * 0.75), (x + s * 1.55, y - s * 0.42),
               (x + s * 1.55, y + s * 0.2), (x + s * 0.8, y + s * 0.78),
               (x + s * 0.05, y + s * 0.2), (x + s * 0.05, y - s * 0.42)],
              outline=WHITE, width=int(2 * S))
    d.line([(x + s * 0.42, y + s * 0.02), (x + s * 0.72, y + s * 0.32), (x + s * 1.2, y - s * 0.3)],
           fill=WHITE, width=int(2 * S))


def ic_heart(x, y, s):
    d = _d()
    d.arc([x, y - s * 0.5, x + s * 1.0, y + s * 0.3], 180, 360, fill=WHITE, width=int(2 * S))
    d.arc([x + s * 0.6, y - s * 0.5, x + s * 1.6, y + s * 0.3], 180, 360, fill=WHITE, width=int(2 * S))
    d.line([(x, y - s * 0.05), (x + s * 0.8, y + s * 0.72)], fill=WHITE, width=int(2 * S))
    d.line([(x + s * 1.6, y - s * 0.05), (x + s * 0.8, y + s * 0.72)], fill=WHITE, width=int(2 * S))


def ic_gear(x, y, s):
    d = _d()
    d.ellipse([x + s * 0.28, y - s * 0.42, x + s * 1.32, y + s * 0.52], outline=WHITE, width=int(2 * S))
    d.ellipse([x + s * 0.62, y - s * 0.02, x + s * 0.98, y + s * 0.28], outline=WHITE, width=int(2 * S))


# ── 版式 ──
def band(d, y, h, color, title, cells, radius=14):
    x0, x1 = 76 * S, (CW - 76) * S
    d.rounded_rectangle([x0, y, x1, y + h], radius=radius * S, fill=color)

    size = 27
    while size > 13:
        f_t = ImageFont.truetype(F_BD, size * S)
        if d.textlength(title, font=f_t) <= (x1 - x0) - 70 * S:
            break
        size -= 1
    f_t = ImageFont.truetype(F_BD, size * S)
    tw = d.textlength(title, font=f_t)
    d.text(((x0 + x1 - tw) / 2, y + 18 * S), title, font=f_t, fill=WHITE)

    f_l = ImageFont.truetype(F_BD, 19 * S)
    f_s = ImageFont.truetype(F_RG, 16 * S)

    n = len(cells)
    cell_w = (x1 - x0 - 40 * S) / n
    top = y + 74 * S
    for i, (icon, l1, l2) in enumerate(cells):
        cx = x0 + 20 * S + i * cell_w
        if i:
            d.line([(cx, top + 2 * S), (cx, y + h - 22 * S)], fill=(255, 255, 255), width=1 * S)
        icon(cx + 14 * S, top + 33 * S, 14 * S)
        d.text((cx + 40 * S, top + 10 * S), l1, font=f_l, fill=WHITE)
        if l2:
            d.text((cx + 40 * S, top + 38 * S), l2, font=f_s, fill=MUTED)


def arrow(d, y0, y1):
    x = CW // 2 * S
    d.line([(x, y0), (x, y1 - 16 * S)], fill=(52, 73, 94), width=4 * S)
    d.polygon([(x, y1), (x - 13 * S, y1 - 22 * S), (x + 13 * S, y1 - 22 * S)], fill=(52, 73, 94))


def dash_rect(d, x0, y0, x1, y1, step=14, color=(140, 158, 176), width=2):
    step *= S
    width *= S
    for x in range(int(x0), int(x1), step * 2):
        d.line([(x, y0), (min(x + step, x1), y0)], fill=color, width=width)
        d.line([(x, y1), (min(x + step, x1), y1)], fill=color, width=width)
    for yy in range(int(y0), int(y1), step * 2):
        d.line([(x0, yy), (x0, min(yy + step, y1))], fill=color, width=width)
        d.line([(x1, yy), (x1, min(yy + step, y1))], fill=color, width=width)


def main():
    global CUR
    img = Image.new("RGB", (W, H), PAPER)
    CUR = img
    d = ImageDraw.Draw(img)

    f_h = ImageFont.truetype(F_BD, 38 * S)
    f_sub = ImageFont.truetype(F_RG, 18 * S)

    d.text((76 * S, 40 * S), "qchat-cli 技术架构", font=f_h, fill=INK)
    d.text((78 * S, 96 * S),
           "从 QQ 客户端到本地产物：入口 → 工具层 → 核心模块 → 外部服务 → 本地存储 → 产物",
           font=f_sub, fill=SUB)

    BH, GAP = 176, 60
    y = 152 * S

    band(d, y, BH * S, NAVY,
         "ENTRY:  qce CLI  |  MCP stdio  |  qq-watch  |  qq-watchdog  |  qq-poke-watch", [
             (ic_terminal, "qce CLI", "近 30 个子命令"),
             (ic_server, "MCP", "search / digest / send"),
             (ic_chat, "qq-watch", "轮询 → 投递会话"),
             (ic_shield, "qq-watchdog", "体检 · 熔断 · 推码"),
             (ic_heart, "poke-watch", "WS 收戳 · 还手"),
         ])
    arrow(d, y + BH * S, y + (BH + GAP) * S)
    y += (BH + GAP) * S

    band(d, y, BH * S, TEAL,
         "TOOL LAYER:  export  |  digest  |  index·search  |  say·pic·media  |  poke  |  draw  |  dispatch  |  memory·alert", [
             (ic_folder, "export", "md/json/html/csv"),
             (ic_chart, "digest", "日报 · 活跃曲线"),
             (ic_search, "index·search", "本地秒搜 · 语义"),
             (ic_chat, "say·pic·media", "文本 / 图 / 视频"),
             (ic_cube, "poke · draw", "戳一戳 / 生图"),
             (ic_server, "dispatch", "车道 · 派活"),
         ])
    arrow(d, y + BH * S, y + (BH + GAP) * S)
    y += (BH + GAP) * S

    box_top = y - 22 * S
    band(d, y, BH * S, SLATE,
         "CORE MODULES:  onebot-client  |  history  |  sticker·emoji  |  wiki  |  personas  |  safety·auth  |  time-sense", [
             (ic_server, "onebot-client", "HTTP · WS · 重试"),
             (ic_db, "history", "分页 · 去重"),
             (ic_heart, "表情 · 梗库", "963 张 / 4576 条"),
             (ic_chat, "personas", "人格 · 规则"),
             (ic_shield, "safety · auth", "白名单 · 令牌"),
             (ic_gear, "time-sense", "时间感知"),
         ])
    arrow(d, y + BH * S, y + (BH + GAP) * S)
    y += (BH + GAP) * S

    band(d, y, (BH + 8) * S, DEEP,
         "EXTERNAL:  NapCat  |  千问视觉  |  MiniMax image-01  |  DeepSeek·Qwen  |  OCR·ASR  |  embedding", [
             (ic_server, "NapCat", "OneBot 11 · QQNT"),
             (ic_cloud, "千问视觉", "qwen3-vl-plus"),
             (ic_cube, "MiniMax", "image-01 生图"),
             (ic_cloud, "文本模型", "DeepSeek / Qwen"),
             (ic_search, "OCR · ASR", "rapidocr / whisper"),
         ])
    arrow(d, y + (BH + 8) * S, y + (BH + 8 + GAP) * S)
    y += (BH + 8 + GAP) * S

    band(d, y, BH * S, INDIGO,
         "LOCAL STORAGE:  .qce-index  |  private/  |  output/  |  logs · DLQ", [
             (ic_db, ".qce-index", "群消息 JSONL"),
             (ic_folder, "private/", "表情 · 梗 · 人格 · 车道"),
             (ic_folder, "output/", "导出 · 生成图 · 日志"),
             (ic_shield, "死信队列", "失败可重放"),
         ])
    y += BH * S

    x0, x1 = 52 * S, (CW - 52) * S
    dash_rect(d, x0, box_top, x1, y + 24 * S)
    label = "LOCAL-FIRST   ·   只监听 127.0.0.1，聊天数据不出本机"
    f_b = ImageFont.truetype(F_BD, 20 * S)
    lw = d.textlength(label, font=f_b)
    ly = y + 24 * S
    d.rectangle([(x0 + x1) / 2 - lw / 2 - 16 * S, ly - 13 * S,
                 (x0 + x1) / 2 + lw / 2 + 16 * S, ly + 13 * S], fill=PAPER)
    d.text(((x0 + x1) / 2 - lw / 2, ly - 12 * S), label, font=f_b, fill=SUB)

    arrow(d, y + 48 * S, y + 100 * S)
    y += 100 * S

    band(d, y, BH * S, AMBER,
         "OUTPUTS:  导出文件  |  群日报  |  生成图  |  QQ 消息  |  派活结论  |  本地索引", [
             (ic_folder, "导出", "md / json / html"),
             (ic_chart, "日报", "一屏看完"),
             (ic_cube, "生成图", "output/gen"),
             (ic_chat, "消息", "群 / 私聊 / 戳"),
             (ic_terminal, "派活", "子会话结论"),
         ])

    img = img.resize((CW, CH), Image.LANCZOS)
    diff = ImageChops.difference(img, Image.new("RGB", img.size, PAPER))
    bbox = diff.getbbox()
    if bbox:
        img = img.crop((0, 0, img.width, min(img.height, bbox[3] + 48)))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT, "PNG", optimize=True)
    print("ARCH=" + OUT, img.size)


if __name__ == "__main__":
    main()
