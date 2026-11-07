#!/usr/bin/env node
/**
 * 迁移：给词库补时间维度。
 *
 * 背景：CHIME 那 1282 条是 2025 年 10 月的数据集快照，导入时统一记成了
 * `addedAt = 导入时间`（2026-11）。这会让它们看起来"刚流行"，实际已经一年多了。
 *
 * 这个脚本按来源回填 firstSeenAt / era，让时效计算算对。
 *
 * 同时：把上次误导入的可疑条目（比如把"欧洲"当梗）挑出来让人看一眼。
 *
 * 用法：node scripts/migrate-term-eras.mjs [--dry]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TERMS = join(process.cwd(), 'private', 'knowledge', 'terms.jsonl');
const DRY = process.argv.includes('--dry');

if (!existsSync(TERMS)) {
  console.error('词库不存在');
  process.exit(2);
}

const lines = readFileSync(TERMS, 'utf8').split(/\r?\n/).filter(Boolean);
const terms = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// CHIME 论文发布 / 数据收集大致时间
const CHIME_EPOCH = Date.UTC(2025, 9, 1); // 2025-10-01
let migrated = 0;
let already = 0;
const suspects = [];

for (const t of terms) {
  if (t.source === 'chime') {
    if (t.firstSeenAt && t.era) { already += 1; continue; }
    t.firstSeenAt = t.firstSeenAt ?? CHIME_EPOCH;
    t.era = t.era ?? 'chime-2025';
    migrated += 1;
  } else if (t.source === 'live') {
    if (t.firstSeenAt && t.era) { already += 1; continue; }
    t.firstSeenAt = t.firstSeenAt ?? t.addedAt ?? Date.now();
    const d = new Date(t.firstSeenAt);
    t.era = t.era ?? `live-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    migrated += 1;
  } else {
    // 人工词条：用导入时间，但保留人工优先级（不加外推）
    if (!t.firstSeenAt) t.firstSeenAt = t.addedAt ?? Date.now();
    if (!t.era) t.era = 'manual';
  }

  // 长度或含义可疑的（可能不是梗）
  if (t.source === 'live' && (!t.term || t.term.length <= 2) && !(t.usage || '').length) {
    suspects.push(t.term);
  }
}

console.log(`总条目: ${terms.length}`);
console.log(`  回填时间: ${migrated}`);
console.log(`  已有时间: ${already}`);
console.log(`  可疑新梗(短词且无例句): ${suspects.length}${suspects.length ? ' → ' + suspects.slice(0, 10).join(', ') : ''}`);

if (DRY) {
  console.log('\n[dry] 未写入');
  process.exit(0);
}

writeFileSync(TERMS, terms.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8');
console.log(`\n已写回 ${TERMS}`);
