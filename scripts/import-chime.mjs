/**
 * 把 CHIME 数据集（中文网络梗解释）导入本地梗库。
 *
 * 数据来源：https://github.com/yuboxie/chime （EMNLP 2025）
 *   1458 条，字段：meme / meaning / origin / examples[] / profanity / offense / type_cn
 *
 * 为什么用它：这正是"让 bot 学抽象文化"缺的那块——结构化的、带例句的、
 * 还标了脏话和冒犯性的词库。自己攒一年也攒不到这个质量。
 *
 * 安全策略：
 *   profanity 或 offense = true 的默认**不进库**（75 + 127 条）。
 *   这些词让 bot 学会说，只会惹麻烦，收益远小于风险。
 *   要收的话加 --include-risky，但每条会带上风险标记。
 *
 * 用法：
 *   node scripts/import-chime.mjs [--include-risky] [--dry]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv.find((a) => a.endsWith('.json')) ?? '.chime.json';
const INCLUDE_RISKY = process.argv.includes('--include-risky');
const DRY = process.argv.includes('--dry');
const OUT = join(process.cwd(), 'private', 'knowledge', 'terms.jsonl');

if (!existsSync(SRC)) {
  console.error(`找不到数据文件: ${SRC}`);
  console.error('先下载: curl -L -o .chime.json https://gh-proxy.com/https://raw.githubusercontent.com/yuboxie/chime/main/data/chime_full.json');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(SRC, 'utf8'));

// 中文类型 → 语气提示（供回复时判断该怎么用）
const toneOf = (typeCn) => {
  switch (typeCn) {
    case '谐音': return '谐音梗，常用于轻松调侃';
    case '缩写': return '缩写，口语化';
    case '俗语': return '俗语，偏老派';
    case '引用': return '出自某处，带出处梗';
    case '修辞': return '修辞玩法，讽刺或夸张';
    case '现象': return '描述某类网络现象';
    default: return '';
  }
};

const terms = [];
let skippedRisky = 0;
let skippedEmpty = 0;

for (const item of raw) {
  const term = String(item.meme ?? '').trim();
  const meaning = String(item.meaning ?? '').trim();
  if (!term || !meaning) { skippedEmpty += 1; continue; }

  const risky = Boolean(item.profanity) || Boolean(item.offense);
  if (risky && !INCLUDE_RISKY) { skippedRisky += 1; continue; }

  const examples = Array.isArray(item.examples) ? item.examples : [];
  const usage = examples.length > 0 ? String(examples[0]).trim().slice(0, 120) : undefined;

  const entry = {
    term,
    meaning: meaning.slice(0, 300),
    ...(usage ? { usage } : {}),
    tone: toneOf(item.type_cn),
    scope: 'global',
    source: 'chime',
    addedAt: Date.now(),
  };
  if (risky) entry.risky = true;
  if (item.origin) entry.origin = String(item.origin).slice(0, 200);

  terms.push(entry);
}

console.log(`源数据: ${raw.length} 条`);
console.log(`  导入: ${terms.length}`);
console.log(`  跳过(脏话/冒犯): ${skippedRisky}`);
console.log(`  跳过(空): ${skippedEmpty}`);
console.log(`  预计文件: ${(JSON.stringify(terms).length / 1024).toFixed(0)} KB`);

if (DRY) {
  console.log('\n[dry] 前 5 条预览:');
  for (const t of terms.slice(0, 5)) {
    console.log(`  「${t.term}」= ${t.meaning.slice(0, 50)}`);
    console.log(`     例: ${t.usage ?? '(无)'}`);
  }
  process.exit(0);
}

// 保留已有的人工词条（source 不是 chime 的），只覆盖 chime 那部分
let existing = [];
if (existsSync(OUT)) {
  existing = readFileSync(OUT, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((x) => x && x.source !== 'chime');
  console.log(`保留已有非 CHIME 词条: ${existing.length}`);
}

mkdirSync(join(process.cwd(), 'private', 'knowledge'), { recursive: true });
const all = [...existing, ...terms];
writeFileSync(OUT, all.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8');
console.log(`\n已写入 ${OUT}（共 ${all.length} 条）`);
