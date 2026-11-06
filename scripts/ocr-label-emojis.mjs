/**
 * 一次性脚本：OCR 表情图里的文字，当成标签写进 manifest。
 *
 * 为什么这么做：DeepSeek 那批表情是「思考框 + 台词」的形式，
 * 图里的文字本身就是这条梗的意思。OCR 出来的文字比 hash 有用一万倍——
 * Jev 选图时能靠它匹配到正确意图。
 *
 * 用法：
 *   node scripts/ocr-label-emojis.mjs [--prefix DeepSeek] [--dry]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');
const DRY = process.argv.includes('--dry');
const prefixArg = (() => {
  const i = process.argv.indexOf('--prefix');
  return i >= 0 ? process.argv[i + 1] : '';
})();

const ocrMod = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'ocr.js')).href);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
let targets = manifest.emojis;

// 只处理标签还像 hash 的（或指定前缀的）
if (prefixArg) {
  targets = targets.filter((e) => e.label.startsWith(prefixArg));
} else {
  targets = targets.filter((e) => /^[0-9a-f]{16}$/i.test(e.label.trim()) || /^DeepSeek [0-9a-f]{16}$/i.test(e.label.trim()));
}

console.log(`待 OCR: ${targets.length} 张`);

let done = 0, labeled = 0, empty = 0;
for (const item of targets) {
  const file = join(LIB, item.file);
  if (!existsSync(file)) continue;
  done += 1;
  if (done % 20 === 0) console.log(`  …已处理 ${done}/${targets.length}`);

  let text = '';
  try {
    const results = ocrMod.runOcr([file], { timeoutMs: 60_000 });
    text = (results?.[0]?.text ?? '').replace(/\s+/g, ' ').trim();
  } catch (e) {
    // 单张失败不影响整体
  }

  // 过滤掉思考框里的 UI 噪音
  text = text
    .replace(/已思考[^）)]*[）)]?/g, '')
    .replace(/用时\s*\d+(\.\d+)?\s*秒/g, '')
    .replace(/^[>\s·]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || text.length < 2) {
    empty += 1;
    continue;
  }
  const label = `${prefixArg || 'DeepSeek'} ${text}`.slice(0, 60);
  if (!DRY) item.label = label;
  labeled += 1;
}

if (!DRY) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
}

console.log(`完成：处理 ${done}，打标 ${labeled}，无文字 ${empty}`);
console.log(DRY ? '（dry run，未写盘）' : `已写入 ${MANIFEST}`);
