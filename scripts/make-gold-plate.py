#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
免死金牌：图形用 MiniMax 出（无字），中文字用 PIL 精确叠上去。

为什么这么做：上一张让 image-01 直接写「免死金牌」，出来的字糊成一团，
被群里抓了现行（"采长 丰于便依煲 食一"）。中文四字成语在文生图模型里基本必崩，
而这块牌子唯一的笑点就在这四个字上——糊了就等于没有。
"""
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.join(ROOT, 'output', 'gen', 'gold-plate-blank.jpg')
OUT = os.path.join(ROOT, 'output', 'gen', 'death-free-pass-v2.jpg')

F_BD = r"C:\Windows\Fonts\msyhbd.ttc"
F_RG = r"C:\Windows\Fonts\msyh.ttc"

# 1) 没图就先让 MiniMax 出一张「空白的金牌」
if not os.path.exists(GEN):
    subprocess.run([
        'node', 'scripts/minimax-image.mjs',
        'Antique golden plaque, square 1:1, ornate carved gold frame with dragons and clouds, '
        'aged dark red silk background in the center, warm golden rim light, detailed metal texture, '
        'completely empty center with no text, no letters, no characters, top-down flat lay, '
        'photorealistic metalwork',
        '--ar', '1:1', '--name', 'gold-plate-blank',
    ], cwd=ROOT, check=True)

img = Image.open(GEN).convert('RGB')
W, H = img.size
d = ImageDraw.Draw(img)

# 2) 四个大字，居中，带一圈描边让它压在牌面上
text = '免死金牌'
f_big = ImageFont.truetype(F_BD, int(W * 0.17))
tw = d.textlength(text, font=f_big)
bbox = f_big.getbbox(text)
th = bbox[3] - bbox[1]
x = (W - tw) / 2
y = (H - th) / 2 - bbox[1]

# 阴影层：先画深色再画金色，避免糊在红底上看不清
d.text((x + 4, y + 4), text, font=f_big, fill=(40, 20, 8))
d.text((x, y), text, font=f_big, fill=(255, 218, 120), stroke_width=int(W * 0.006), stroke_fill=(120, 60, 10))

# 3) 底下那行小字：有效期
small = '有效期：一秒'
f_small = ImageFont.truetype(F_RG, int(W * 0.045))
sw = d.textlength(small, font=f_small)
d.text(((W - sw) / 2, y + th + int(H * 0.06)), small, font=f_small, fill=(255, 236, 190),
       stroke_width=2, stroke_fill=(80, 40, 10))

# 4) 右下角一枚「已作废」的斜章
stamp = Image.new('RGBA', (int(W * 0.5), int(H * 0.18)), (0, 0, 0, 0))
ds = ImageDraw.Draw(stamp)
f_stamp = ImageFont.truetype(F_BD, int(W * 0.09))
ds.text((10, 10), '已作废', font=f_stamp, fill=(200, 40, 40, 220))
stamp = stamp.rotate(-18, expand=True)
img.paste(stamp, (int(W * 0.45), int(H * 0.70)), stamp)

img.save(OUT, 'JPEG', quality=92)
print('OUT=' + OUT, img.size)
