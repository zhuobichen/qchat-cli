/**
 * 表情库批量打标：**千问优先，本地兜底**。
 *
 * 优先级（用户定的）：
 *   1. 千问 qwen3-vl-plus（DashScope 直连）—— 认得准、不占显存、能和 TTS 同跑
 *   2. 本地 rapidocr（免费 CPU）—— 千问没额度/失败时，至少把图里的字提出来
 *   3. 本地视觉模型（llama.cpp :8081）—— 前两者都不行且服务在跑时才用
 *
 * 千问额度耗尽会自动降级，不会卡住；日志里标明每张走的是哪条路。
 *
 * 用法：
 *   node scripts/label-emojis.mjs --prefix DeepSeek           # 千问 → 本地兜底
 *   node scripts/label-emojis.mjs --local-only                # 强制本地（省钱/断网）
 *   node scripts/label-emojis.mjs --qwen-only                 # 只看千问，不兜底
 *   node scripts/label-emojis.mjs --dry
 *   node scripts/label-emojis.mjs --limit 20
 *
 * 环境变量（.env 自动加载）：
 *   DASHSCOPE_API_KEY   千问 key
 *   QCE_VL_MODEL        覆盖模型名（默认 qwen3-vl-plus）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// 读项目根目录的 .env（脚本不经过 cli 所以自己加载）
try {
  process.loadEnvFile('.env');
} catch {
  /* 没有 .env 就走环境变量 */
}

const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');

const DRY = process.argv.includes('--dry');
const LOCAL_ONLY = process.argv.includes('--local-only');
const QWEN_ONLY = process.argv.includes('--qwen-only');
const prefixArg = (() => { const i = process.argv.indexOf('--prefix'); return i >= 0 ? process.argv[i + 1] : ''; })();
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();

const visionMod = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'vision.js')).href);

/** 用 Python + Pillow 转 PNG 并 base64（统一格式，避开 webp/动图兼容问题） */
function toPngB64(file) {
  const py = `
import base64, io, sys
from PIL import Image
im = Image.open(sys.argv[1])
im = im.convert('RGBA') if im.mode in ('P','LA','RGBA') else im.convert('RGB')
w, h = im.size
if max(w, h) > 1024:
    s = 1024 / max(w, h)
    im = im.resize((int(w*s), int(h*s)))
buf = io.BytesIO(); im.save(buf, format='PNG')
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
`;
  const r = spawnSync('python', ['-c', py, file], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout.trim() : '';
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
let targets = prefixArg
  ? manifest.emojis.filter((e) => e.label.startsWith(prefixArg))
  : manifest.emojis.filter((e) => /^[0-9a-f]{16}$/i.test(e.label.trim()));
if (LIMIT > 0) targets = targets.slice(0, LIMIT);

console.log(`待处理: ${targets.length} 张（${LOCAL_ONLY ? '强制本地' : QWEN_ONLY ? '仅千问' : '千问 → 本地兜底'}）`);

const stats = { qwen: 0, 'local-ocr': 0, 'local-vlm': 0, none: 0 };

for (let i = 0; i < targets.length; i += 1) {
  const item = targets[i];
  const file = join(LIB, item.file);
  if (!existsSync(file)) continue;

  const b64 = toPngB64(file);
  if (!b64) {
    stats.none += 1;
    console.log(`  [skip] ${item.file.slice(0, 12)}… 图片读不出`);
    continue;
  }

  const r = await visionMod.understandImage(file, b64, {
    ...(LOCAL_ONLY ? { localOnly: true } : {}),
    ...(QWEN_ONLY ? { qwenOnly: true } : {}),
  });

  stats[r.source] = (stats[r.source] ?? 0) + 1;

  // 标签：优先用图里的文字（信息量最大），没有就用情绪描述
  const label = (r.text && r.text.length >= 2 ? r.text : r.emotion).trim();
  if (!label) {
    console.log(`  [none] ${item.file.slice(0, 12)}… 三条路都没结果`);
    continue;
  }

  const final = `${prefixArg || ''} ${label}`.trim().slice(0, 56);
  if (!DRY) {
    item.label = final;
    if (r.character) item.character = r.character;
  }
  const tag = r.source === 'qwen' ? '千问' : r.source === 'local-ocr' ? '本地OCR' : '本地VLM';
  console.log(`  [${tag}] ${label.slice(0, 34)}${r.character ? `  (角色: ${r.character})` : ''}`);

  if ((i + 1) % 25 === 0) console.log(`  …进度 ${i + 1}/${targets.length}`);
}

if (!DRY) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n完成：千问 ${stats.qwen}，本地OCR ${stats['local-ocr']}，本地VLM ${stats['local-vlm']}，无结果 ${stats.none}`);
if (stats.qwen > 0) console.log(`千问约 ${stats.qwen} 张图 ≈ ¥${(stats.qwen * 0.003).toFixed(3)}`);
console.log(DRY ? '（dry run，未写盘）' : `已写入 ${MANIFEST}`);
