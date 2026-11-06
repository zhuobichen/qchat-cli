#!/usr/bin/env python3
"""把音频里的语音转成文字，输出 JSON（离线，用本地已缓存的 faster-whisper 模型）。

用法:
    python scripts/asr_audio.py a.mp3 b.wav

输出（UTF-8）:
    {"results":[{"file":"a.mp3","text":"转写结果","language":"zh","duration":9.3}]}

依赖 faster_whisper + 本地已缓存的模型（默认 small）。没网也能跑：
默认设置 HF_HUB_OFFLINE=1，只找本地快照。
"""
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_MODEL = os.environ.get("QCE_ASR_MODEL", "small")


def main(argv):
    files = argv[1:]
    if not files:
        print(json.dumps({"results": [], "error": "no input files"}, ensure_ascii=False))
        return 0

    # 离线优先：模型从本地缓存加载，避免在无网环境下卡住
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:
        print(json.dumps({"results": [], "error": f"faster_whisper 不可用: {exc}"}, ensure_ascii=False))
        return 0

    try:
        model = WhisperModel(DEFAULT_MODEL, device="cpu", compute_type="int8", local_files_only=True)
    except Exception as exc:
        print(json.dumps({
            "results": [],
            "error": f"加载模型 {DEFAULT_MODEL} 失败（需要本地已缓存）：{exc}",
        }, ensure_ascii=False))
        return 0

    language = os.environ.get("QCE_ASR_LANG", "zh")
    results = []
    for path in files:
        item = {"file": path, "text": "", "language": "", "duration": 0.0}
        try:
            segments, info = model.transcribe(path, language=language, vad_filter=True)
            item["text"] = "".join(seg.text for seg in segments).strip()
            item["language"] = getattr(info, "language", "")
            item["duration"] = round(float(getattr(info, "duration", 0.0)), 2)
        except Exception as exc:
            item["error"] = str(exc)
        results.append(item)

    print(json.dumps({"results": results}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
