/**
 * 把表情档案库里「还没进库」的图全部导入本地表情库。
 *
 * 背景：blue-fish-archive 有 768 张图，但库里只有 388 条（其中 153 条还是
 * 同一族 DeepSeek）。也就是说一半以上的图根本没进库，选图自然贫乏。
 *
 * 做法：按内容 hash 去重 → 排除二维码/logo 等非表情 → 复制到暂存目录 →
 * 交给 `qce face add` 统一入库（它会写 manifest、算 hash、登记路径）。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const ARCHIVE = 'D:\\github_project\\ZhaoWen_GitHub维护\\表情包\\blue-fish-archive';
const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');
const STAGE = join(process.cwd(), '.emoji-import');

const IMG_EXT = new Set(['.gif', '.png', '.jpg', '.jpeg', '.webp']);
// 这些不是表情，是站点资源
const SKIP_NAME = /qr|logo|icon|avatar|banner|cover|placeholder/i;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (IMG_EXT.has(extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const have = new Set(manifest.emojis.map((e) => e.hash));

const files = walk(ARCHIVE).filter((f) => !SKIP_NAME.test(basename(f)));
const seen = new Set();
const picked = [];
let dupInArchive = 0;
let alreadyInLib = 0;
let tooBig = 0;

for (const f of files) {
  let buf;
  try { buf = readFileSync(f); } catch { continue; }
  // 太大的不导（超过 8MB 的 gif 发不动）
  if (buf.length > 8 * 1024 * 1024) { tooBig += 1; continue; }
  const h = createHash('sha256').update(buf).digest('hex');
  if (seen.has(h)) { dupInArchive += 1; continue; }
  seen.add(h);
  if (have.has(h)) { alreadyInLib += 1; continue; }
  picked.push({ src: f, hash: h, bytes: buf.length, buf });
}

console.log(`档案库图片: ${files.length}`);
console.log(`  去重后新的: ${picked.length}`);
console.log(`  档案内重复: ${dupInArchive}`);
console.log(`  已在库里:   ${alreadyInLib}`);
console.log(`  超过 8MB:   ${tooBig}`);
console.log(`  预计总量:   ${(picked.reduce((n, x) => n + x.bytes, 0) / 1e6).toFixed(1)} MB`);

if (picked.length === 0) {
  console.log('没有需要导入的。');
  process.exit(0);
}

mkdirSync(STAGE, { recursive: true });
const staged = [];
for (const p of picked) {
  const out = join(STAGE, `${p.hash.slice(0, 16)}${extname(p.src).toLowerCase()}`);
  if (!existsSync(out)) writeFileSync(out, p.buf);
  staged.push(out);
}
console.log(`已暂存到: ${STAGE}（${staged.length} 个文件）`);
console.log('下一步: node dist/cli.js face add .emoji-import -l 待标');
