#!/bin/bash
# 把 dsh-qq-panel 的源码同步到 DSH 实际加载的副本。
#
# 为什么需要：DSH 从 profiles/web/node_modules/dsh-qq-panel 加载插件，
# 那是一个**目录副本**而不是链接。改源目录 dsh/home/plugins/dsh-qq-panel
# 不会有任何效果——踩过一次：路由加了、重启了、还是 404，
# 因为加载的副本时间戳还停在两天前。
#
# 用法：
#   bash scripts/sync-panel.sh          同步
#   bash scripts/sync-panel.sh --check  只比对，不写
#
# 同步完必须重启 DSH 才生效（服务端代码不会热加载）。
set -u

SRC="D:/github_project/ZhaoWen_GitHub维护/dsh/home/plugins/dsh-qq-panel"
DST="D:/github_project/ZhaoWen_GitHub维护/dsh/home/profiles/web/node_modules/dsh-qq-panel"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

if [ ! -d "$SRC" ]; then echo "源目录不存在: $SRC"; exit 1; fi
if [ ! -d "$DST" ]; then echo "目标目录不存在: $DST"; exit 1; fi

changed=0
for f in index.js client.js package.json cordis.patch.yml; do
  [ -f "$SRC/$f" ] || continue
  a=$(stat -c %s "$SRC/$f" 2>/dev/null || echo 0)
  b=$(stat -c %s "$DST/$f" 2>/dev/null || echo -1)
  if [ "$a" != "$b" ]; then
    echo "  差异: $f  ($a vs $b)"
    changed=$((changed+1))
    if [ "$CHECK" -eq 0 ]; then
      cp -f "$DST/$f" "$DST/$f.bak" 2>/dev/null || true
      cp -f "$SRC/$f" "$DST/$f"
    fi
  fi
done

if [ "$changed" -eq 0 ]; then
  echo "已同步，无差异。"
elif [ "$CHECK" -eq 1 ]; then
  echo "有 $changed 个文件不同（--check 模式未写入）。"
else
  echo "已同步 $changed 个文件 → 重启 DSH 生效。"
fi
