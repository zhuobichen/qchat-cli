"""用 rapidocr 把图片里的文字抠出来。

为什么需要：当前模型读不了图，但群里天天有人发截图问"这是什么/赏析一下"。
OCR 至少能把文字部分拿出来，图片内容就只能靠文字推。

用法: python .ocr.py <图片路径>
"""
import sys
import json

from rapidocr_onnxruntime import RapidOCR

img = sys.argv[1]
engine = RapidOCR()
result, _ = engine(img)

if not result:
    print('（图里没识别到文字）')
    sys.exit(0)

# result 每项是 [box, text, score]
lines = []
for item in result:
    text = item[1]
    score = item[2] if len(item) > 2 else 0
    lines.append((text, score))

print(f'识别到 {len(lines)} 行：')
for text, score in lines:
    print(f'  {text}')
