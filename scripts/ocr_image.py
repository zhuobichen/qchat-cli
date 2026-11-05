#!/usr/bin/env python3
"""把图片里的文字识别出来，输出 JSON。

用法:
    python scripts/ocr_image.py a.png b.png

输出（UTF-8，ensure_ascii=False）:
    {"results":[{"file":"a.png","text":"合并后的全文","lines":["第一行","第二行"]}]}

依赖 rapidocr_onnxruntime（CPU 可跑，中文可用）。失败时该条 text 为空并带 error 字段，
整体仍返回 0，避免调用方因为一张坏图中断整批。
"""
import json
import sys

# Windows 上 stdout 默认是 GBK，中文会变成乱码/替换符；调用方按 UTF-8 解析
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def main(argv):
    files = argv[1:]
    if not files:
        print(json.dumps({"results": [], "error": "no input files"}, ensure_ascii=False))
        return 0

    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception as exc:  # pragma: no cover - 环境缺失时给明确原因
        print(json.dumps({"results": [], "error": f"rapidocr 不可用: {exc}"}, ensure_ascii=False))
        return 0

    engine = RapidOCR()
    results = []
    for path in files:
        item = {"file": path, "text": "", "lines": []}
        try:
            res, _ = engine(path)
            lines = [seg[1] for seg in (res or []) if len(seg) > 1 and seg[1]]
            item["lines"] = lines
            item["text"] = "\n".join(lines)
        except Exception as exc:
            item["error"] = str(exc)
        results.append(item)

    print(json.dumps({"results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
