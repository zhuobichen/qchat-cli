#!/bin/bash
# 一条命令刷新整个知识库
#
#   bash scripts/refresh-knowledge.sh          # 只重建 wiki（不联网）
#   bash scripts/refresh-knowledge.sh --crawl  # 先抓梗百科再重建（慢，20-40 分钟）
#
# 为什么要串起来：抓完忘了重建 wiki 是很容易发生的事，
# 结果就是词库更新了、面板里看到的还是旧的。
set -u
cd "$(dirname "$0")/.." || exit 1

export TEMP="$(pwd)/.tmp-vitest"
export TMP="$TEMP"
mkdir -p "$TEMP"

if [ "${1:-}" = "--crawl" ]; then
  FROM="${2:-1000}"
  TO="${3:-3999}"
  echo "=== 抓梗百科 id $FROM-$TO"
  node scripts/gengbaike-crawl.mjs --from "$FROM" --to "$TO" --out .gb-out.jsonl --delay 280
  if [ -s .gb-out.jsonl ]; then
    echo "=== 词条去重入库"
    python - <<'PY'
import io, json
existing = set()
for l in io.open('private/knowledge/terms.jsonl', encoding='utf-8'):
    if not l.strip():
        continue
    try:
        existing.add(json.loads(l).get('term'))
    except Exception:
        pass
out = []
for l in io.open('.gb-out.jsonl', encoding='utf-8'):
    r = json.loads(l)
    t = (r.get('term') or '').strip()
    m = (r.get('meaning') or '').strip()
    if len(t) < 2 or len(m) < 40 or t in existing:
        continue
    out.append({
        'term': t, 'meaning': m[:600], 'source': 'gengbaike-web',
        'priority': 'high', 'verifiedBy': 'gengbaike.cn',
        'era': (r.get('updatedAt') or '2026')[:7],
    })
io.open('.upsert.json', 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False))
print(f'待写入 {len(out)} 条')
PY
    node scripts/meme-upsert.mjs .upsert.json
    rm -f .upsert.json .gb-out.jsonl
  fi
fi

echo "=== 重建梗库 wiki"
node scripts/wiki-build.mjs --with-terms

echo "=== 重建表情库 wiki"
node scripts/sticker-wiki.mjs

echo
echo "完成。面板里的「梗库检索 / 表情检索」下次请求就能看到新数据（词库按 mtime 自动失效缓存）。"
echo "注意：wiki 的 markdown 文件是给人看的快照，不重建也不影响面板搜索。"
