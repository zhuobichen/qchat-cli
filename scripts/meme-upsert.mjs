/**
 * 梗词条 upsert：把一批词条写进 private/knowledge/terms.jsonl。
 *
 * 为什么不直接用 >> 追加：重复跑会把同一条写很多遍，词库很快变垃圾。
 * 这里按 term 去重：已存在就**更新**（保留 hits 等运行期字段），不存在才追加。
 *
 * 输入文件格式（JSON 数组，UTF-8）：
 * [
 *   {"term":"滑动变祖器","meaning":"...","usage":"...","tone":"调侃",
 *    "source":"gengbaike","verifiedBy":"huxiu.com","priority":"high","era":"gengbaike-2026"}
 * ]
 *
 * 用法：
 *   node scripts/meme-upsert.mjs <input.json>         写入
 *   node scripts/meme-upsert.mjs <input.json> --dry   只看会改什么
 */
import fs from 'node:fs';
import path from 'node:path';

const TERMS = path.join(process.cwd(), 'private', 'knowledge', 'terms.jsonl');
const input = process.argv[2];
const DRY = process.argv.includes('--dry');

if (!input) {
  console.error('用法: node scripts/meme-upsert.mjs <input.json> [--dry]');
  process.exit(1);
}

const incoming = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(incoming)) {
  console.error('输入必须是 JSON 数组');
  process.exit(1);
}

const lines = fs.existsSync(TERMS) ? fs.readFileSync(TERMS, 'utf8').split('\n').filter((l) => l.trim() !== '') : [];
const byTerm = new Map();
for (let i = 0; i < lines.length; i += 1) {
  try {
    const d = JSON.parse(lines[i]);
    if (d?.term) byTerm.set(d.term, i);
  } catch {
    /* 坏行跳过 */
  }
}

let added = 0;
let updated = 0;
const now = Date.now();

for (const t of incoming) {
  if (!t?.term || !t?.meaning) continue;
  const idx = byTerm.get(t.term);
  if (idx === undefined) {
    const rec = { scope: 'global', source: 'gengbaike', priority: 'high', addedAt: now, ...t };
    lines.push(JSON.stringify(rec));
    byTerm.set(t.term, lines.length - 1);
    added += 1;
    console.log(`  + ${t.term}`);
  } else {
    const old = JSON.parse(lines[idx]);
    // 运行期字段不被覆盖
    const rec = { ...old, ...t, addedAt: old.addedAt ?? now, hits: old.hits ?? 0 };
    lines[idx] = JSON.stringify(rec);
    updated += 1;
    console.log(`  ~ ${t.term}`);
  }
}

if (DRY) {
  console.log(`\n[dry] 将新增 ${added} 条，更新 ${updated} 条`);
} else {
  fs.writeFileSync(TERMS, lines.join('\n') + '\n', 'utf8');
  console.log(`\n完成：新增 ${added} 条，更新 ${updated} 条 → ${TERMS}`);
}
