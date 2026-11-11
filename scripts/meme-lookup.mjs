/**
 * 一个入口查两样东西：文字梗（梗库）和图（表情库）。
 *
 * 为什么要有：梗库 4576 条、表情库 963 张，都是躺着不动的资产。
 * 不查的时候它们是硬盘占用；要用的时候如果还得现想"在哪个目录、文件名怎么拼"，
 * 那就等于没有。所以给一个命令，说话时顺手就能翻。
 *
 * 用法：
 *   node scripts/meme-lookup.mjs 典孝急乐          # 查梗库（默认）
 *   node scripts/meme-lookup.mjs 笑死 --sticker    # 查表情库的 label
 *   node scripts/meme-lookup.mjs 摆烂 --all        # 两边一起查
 *   node scripts/meme-lookup.mjs 典 --limit 3      # 只看前 3 条
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIKI = path.join(ROOT, 'private', 'wiki');
const TERMS = path.join(WIKI, 'terms');
const MANIFEST = path.join(ROOT, 'private', 'emoji-library', 'manifest.json');

const argv = process.argv.slice(2);
const wantSticker = argv.includes('--sticker');
const wantAll = argv.includes('--all');
const li = argv.indexOf('--limit');
const limit = li >= 0 ? Math.max(1, Number(argv[li + 1]) || 8) : 8;
const keyword = argv.find((a, i) => !a.startsWith('--') && !(li >= 0 && i === li + 1));

if (!keyword) {
  console.error('用法: node scripts/meme-lookup.mjs <关键词> [--sticker|--all] [--limit N]');
  process.exit(1);
}

/** 把词条正文里那段解释压成一行，去掉元信息和导航尾巴 */
function summarize(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const body = raw
    .split('\n')
    .filter((l) => !/^#\s|^>\s|^\*\*归类\*\*|^←|^---\s*$/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body.slice(0, 150);
}

function searchWiki(kw) {
  const lower = kw.toLowerCase();
  const files = fs.readdirSync(TERMS).filter((f) => f.endsWith('.md'));
  const hits = [];

  // 先看标题：标题命中永远比正文命中更相关（"典孝急乐"出现在别人解释里不算）
  for (const f of files) {
    const name = f.replace(/\.md$/, '');
    if (name.toLowerCase().includes(lower)) hits.push({ name, file: path.join(TERMS, f), by: '标题' });
  }
  // 标题不够再翻正文
  if (hits.length < limit) {
    for (const f of files) {
      const name = f.replace(/\.md$/, '');
      if (name.toLowerCase().includes(lower)) continue;
      let raw;
      try { raw = fs.readFileSync(path.join(TERMS, f), 'utf8'); } catch { continue; }
      if (raw.toLowerCase().includes(lower)) hits.push({ name, file: path.join(TERMS, f), by: '正文' });
      if (hits.length >= limit * 4) break;   // 正文命中太多没意义，够筛了
    }
  }
  return hits.slice(0, limit);
}

function searchSticker(kw) {
  if (!fs.existsSync(MANIFEST)) return [];
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const lower = kw.toLowerCase();
  return (m.emojis || [])
    .filter((e) => String(e.label || '').toLowerCase().includes(lower))
    .slice(0, limit)
    .map((e) => ({ label: e.label, file: e.file }));
}

if (!wantSticker || wantAll) {
  const hits = searchWiki(keyword);
  console.log(`—— 梗库（${hits.length} 条 / 共 4576 条）`);
  if (!hits.length) {
    console.log('  没这条。可能是新梗还没入库，直接按语境说就行，别硬编解释。');
  }
  for (const h of hits) {
    console.log(`  [${h.by}] ${h.name}`);
    console.log(`      ${summarize(h.file)}`);
  }
}

if (wantSticker || wantAll) {
  const hits = searchSticker(keyword);
  console.log(`—— 表情库（${hits.length} 张 / 共 963 张）`);
  if (!hits.length) {
    console.log('  没有贴这个 label 的图。换个词，或者别配图。');
  }
  for (const h of hits) {
    console.log(`  ${h.label}   (${h.file})`);
  }
  if (hits.length) {
    console.log(`  发出去：node scripts/send-sticker.mjs --list ${keyword}  然后 node scripts/send-sticker.mjs --id <hash>`);
  }
}
