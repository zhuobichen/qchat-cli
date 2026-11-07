/**
 * 给「待标」的表情补标签。
 *
 * 两步：
 *   1. 本地 OCR（rapidocr）—— 图里有字的（梗图、台词、表情包里的中文）
 *      直接拿文字当标签，这是最准的，因为那文字就是梗本身。
 *   2. 没文字的（纯反应图）留给 VLM，另跑 scripts/label-emoji-vlm.mjs。
 *
 * 用法：node scripts/label-emoji-ocr.mjs [--dry] [--limit N]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');
const DRY = process.argv.includes('--dry');
const limitArg = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 ? Number(process.argv[i + 1]) : 0;
})();

const ocrMod = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'ocr.js')).href);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const targets = manifest.emojis.filter((e) => String(e.label).startsWith('待标'));
const todo = limitArg > 0 ? targets.slice(0, limitArg) : targets;

console.log(`待标总数: ${targets.length}，本次处理: ${todo.length}`);
if (DRY) console.log('（dry run，不写文件）');

let labeled = 0;
let empty = 0;
let failed = 0;

for (let i = 0; i < todo.length; i += 1) {
  const item = todo[i];
  const file = join(LIB, item.file);
  try {
    const res = ocrMod.runOcr([file], { timeoutMs: 45_000 });
    const text = (res?.text ?? '').replace(/\s+/g, ' ').trim();
    // 太短或全是符号的不算有效标签
    const meaningful = text.replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '').length >= 2;
    if (meaningful) {
      item.label = text.slice(0, 60);
      labeled += 1;
    } else {
      empty += 1;
    }
  } catch {
    failed += 1;
  }
  if ((i + 1) % 25 === 0 || i === todo.length - 1) {
    const pct = Math.round(((i + 1) / todo.length) * 100);
    console.log(`  ${i + 1}/${todo.length} (${pct}%) 有字 ${labeled} / 无字 ${empty} / 失败 ${failed}`);
  }
}

if (!DRY) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`已写回 manifest：${labeled} 张拿到文字标签，${empty} 张无字待 VLM`);
} else {
  console.log(`[dry] 会有 ${labeled} 张拿到标签，${empty} 张无字`);
}
