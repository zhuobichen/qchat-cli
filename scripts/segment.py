"""用 jieba 把文本切词，输出候选词（JSON 到 stdout）。

为什么需要单独一个脚本：Node 侧没有可靠的中文分词，而我之前用「滑动窗口切 n-gram」
的土办法切出来全是「国走」「是好」这种碎片，喂给 AI 判定纯属浪费 token。

jieba 装在 _seedvc 的 venv 里（它本来就在依赖链上）。

用法：
  python segment.py <文本文件> [--min 2] [--max 6]
  # 文本文件：一行一句，或直接是标题列表
输出：
  [{"word": "...", "n": 3, "context": "原句片段"}]
"""
import json
import logging
import sys

try:
    import jieba
    jieba.setLogLevel(logging.ERROR)
except ImportError:
    print(json.dumps({"error": "jieba not installed"}))
    sys.exit(1)

args = sys.argv[1:]
path = args[0] if args and not args[0].startswith('--') else None
min_len = 2
max_len = 6
for i, a in enumerate(args):
    if a == '--min':
        min_len = int(args[i + 1])
    elif a == '--max':
        max_len = int(args[i + 1])

if not path:
    print(json.dumps({"error": "need a text file"}))
    sys.exit(2)

with open(path, 'r', encoding='utf-8') as f:
    lines = [l.strip() for l in f if l.strip()]

counts = {}
context = {}
for line in lines:
    for w in jieba.cut(line):
        w = w.strip()
        if not (min_len <= len(w) <= max_len):
            continue
        if not all('\u4e00' <= ch <= '\u9fa5' or ch.isalnum() for ch in w):
            continue
        if not any('\u4e00' <= ch <= '\u9fa5' for ch in w):
            continue
        counts[w] = counts.get(w, 0) + 1
        if w not in context:
            context[w] = line[:60]

out = [
    {"word": w, "n": n, "context": context[w]}
    for w, n in sorted(counts.items(), key=lambda kv: -kv[1])
]
print(json.dumps(out, ensure_ascii=False))
