/**
 * 给「待标」的表情用视觉模型补标签。
 *
 * 为什么要这一步：OCR 只对图里带字的梗图有用。纯反应图（猫、熊猫头、动作）
 * 没有文字，标签就一直是「待标 hash」——这种标签在选图时永远匹配不到任何意图，
 * 等于库里有 700 张图但用不上。
 *
 * 标签格式统一成三段，方便后面按段匹配：
 *   <情绪> <动作/姿态> <角色或来源>
 * 例如：无语 翻白眼 熊猫头
 *
 * 用法：
 *   node scripts/label-emoji-vlm.mjs [--dry] [--limit N] [--concurrency 4] [--skip N]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');
const DRY = process.argv.includes('--dry');

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const limit = argOf('--limit', 0);
const skip = argOf('--skip', 0);
const concurrency = Math.max(1, Math.min(8, argOf('--concurrency', 4)));

const vision = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'vision.js')).href);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const all = manifest.emojis.filter((e) => String(e.label).startsWith('待标'));
const todo = all.slice(skip, limit > 0 ? skip + limit : undefined);

console.log(`待标 ${all.length} 张，本次 ${todo.length} 张，并发 ${concurrency}${DRY ? '（dry）' : ''}`);

let done = 0;
let ok = 0;
let fail = 0;
const errors = new Map();

function cleanLabel(raw) {
  const s = String(raw || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[，。！？、；：""''（）【】《》.,!?;:"'()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 只保留前三个词（按空格）
  const parts = s.split(' ').filter(Boolean).slice(0, 3);
  return parts.join(' ').slice(0, 24);
}

let cursor = 0;
async function worker(id) {
  for (;;) {
    const i = cursor;
    cursor += 1;
    if (i >= todo.length) return;
    const item = todo[i];
    const file = join(LIB, item.file);
    if (!existsSync(file)) { fail += 1; continue; }
    try {
      const buf = readFileSync(file);
      // understandImageBuffer 会走「千问 → 本地 OCR → 本地 VLM」三级兜底，
      // 返回结构化的 { text, emotion, character }，正好拼成三段式标签。
      const u = await vision.understandImageBuffer(buf, { tmpDir: process.cwd() });
      const parts = [u?.emotion, u?.character, u?.text]
        .map((x) => cleanLabel(x))
        .filter((x) => x && x.replace(/\s/g, '').length >= 1);
      const label = cleanLabel(parts.slice(0, 3).join(' '));
      if (label && label.replace(/\s/g, '').length >= 2) {
        item.label = label;
        ok += 1;
      } else {
        fail += 1;
      }
    } catch (error) {
      fail += 1;
      const key = String(error?.message ?? error).slice(0, 80);
      errors.set(key, (errors.get(key) ?? 0) + 1);
      // 连续失败说明是系统性问题（配额/网络），早点停
      if (fail > 25 && ok === 0) return;
    }
    done += 1;
    if (done % 20 === 0) console.log(`  ${done}/${todo.length} ok=${ok} fail=${fail}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, (_, k) => worker(k)));

if (!DRY) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`已写回：成功 ${ok}，失败 ${fail}`);
  if (errors.size) {
    console.log('失败原因 top5:');
    for (const [k, n] of [...errors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  ${n}x ${k}`);
    }
  }
} else {
  console.log(`[dry] 成功 ${ok}，失败 ${fail}`);
}
