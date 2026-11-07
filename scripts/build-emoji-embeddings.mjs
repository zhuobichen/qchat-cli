/**
 * 给表情库建向量索引，供选图时做语义检索。
 *
 * 为什么需要：现在 `candidatesFor` 靠 bigram 子串匹配 —— 意图「无语」只能
 * 命中标签里含「无」「语」的图。而实际想表达「无语」时，合适的图可能是
 * 「熊猫头 翻白眼」「猫咪 面无表情 呆滞」，这些字面上不含「无语」。
 * 向量检索能接住这类同义/近义关系。
 *
 * 产出：private/emoji-library/embeddings.json
 *   { model, builtAt, count, items: [{ hash, v }] }
 *
 * 用法：
 *   node scripts/build-emoji-embeddings.mjs [--force]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');
const OUT = join(LIB, 'embeddings.json');
const FORCE = process.argv.includes('--force');

const emb = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'embeddings.js')).href);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
// 只给有真标签的打向量；「待标 xxxx」这种没信息量
const usable = manifest.emojis.filter((e) => {
  const l = String(e.label || '').trim();
  return l && !l.startsWith('待标') && l.replace(/\s/g, '').length >= 2;
});

console.log(`库里 ${manifest.emojis.length} 张，可打向量的 ${usable.length} 张`);

if (existsSync(OUT) && !FORCE) {
  const prev = JSON.parse(readFileSync(OUT, 'utf8'));
  console.log(`已有索引（${prev.count} 条，${prev.builtAt}）。要重建加 --force`);
  process.exit(0);
}

const BATCH = 16;
const items = [];
for (let i = 0; i < usable.length; i += BATCH) {
  const slice = usable.slice(i, i + BATCH);
  const texts = slice.map((e) => String(e.label).slice(0, 120));
  let vectors;
  try {
    vectors = await emb.embedTexts(texts, {
      apiKey: emb.resolveApiKey(),
      endpoint: emb.DEFAULT_EMBEDDING_ENDPOINT,
      model: process.env.QCE_EMBED_MODEL || 'text-embedding-v4',
    });
  } catch (error) {
    console.error(`批次 ${i} 失败: ${error?.message ?? error}`);
    process.exit(1);
  }
  slice.forEach((e, k) => {
    items.push({ hash: e.hash, v: emb.encodeVector(vectors[k]) });
  });
  if ((i + BATCH) % 160 === 0 || i + BATCH >= usable.length) {
    console.log(`  已向量化 ${Math.min(i + BATCH, usable.length)}/${usable.length}`);
  }
}

writeFileSync(
  OUT,
  JSON.stringify({
    model: process.env.QCE_EMBED_MODEL || 'text-embedding-v4',
    builtAt: new Date().toISOString(),
    count: items.length,
    dims: items.length ? emb.decodeVector(items[0].v).length : 0,
    items,
  }),
  'utf8',
);
console.log(`索引已写入 ${OUT}（${items.length} 条）`);
