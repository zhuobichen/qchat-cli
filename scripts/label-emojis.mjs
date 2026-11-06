/**
 * 表情库批量打标：本地 OCR 提文字 + 千问 Qwen3-VL 描述情绪。
 *
 * 分流逻辑：
 *   1. 先用本地 rapidocr（免费、CPU、~1s/张）——图里有字就提字
 *   2. 没字 → 调 qwen3-vl-plus 描述情绪（约 0.003 元/张）
 *
 * 为什么不全用云：OCR 场景本地免费就够，没必要花钱。
 * 为什么不用本地 VLM：llama.cpp 那套要 5GB 显存，和 TTS 抢（8GB 卡放不下），
 *                    而且描述质量不如 qwen3-vl-plus。
 *
 * 用法：
 *   node scripts/label-emojis.mjs --prefix DeepSeek            # OCR → 千问填空
 *   node scripts/label-emojis.mjs --prefix DeepSeek --dry
 *   node scripts/label-emojis.mjs --qwen-only                  # 跳过本地 OCR
 *   node scripts/label-emojis.mjs --limit 20                   # 先试一小批
 *
 * 环境变量：
 *   DASHSCOPE_API_KEY  千问 key（或 QCE_DASHSCOPE_KEY）
 *   QCE_VL_MODEL       覆盖模型名（默认 qwen3-vl-plus）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');
const QWEN_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODEL = process.env.QCE_VL_MODEL || 'qwen3-vl-plus';
const NL = String.fromCharCode(10);

const DRY = process.argv.includes('--dry');
const QWEN_ONLY = process.argv.includes('--qwen-only');
const prefixArg = (() => { const i = process.argv.indexOf('--prefix'); return i >= 0 ? process.argv[i + 1] : ''; })();
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();

const ocrMod = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'ocr.js')).href);
const embMod = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'embeddings.js')).href);

const apiKey = embMod.resolveApiKey();
if (!apiKey) {
  console.error('缺少 DASHSCOPE_API_KEY（或 QCE_DASHSCOPE_KEY），无法调用千问');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
let targets = prefixArg
  ? manifest.emojis.filter((e) => e.label.startsWith(prefixArg))
  : manifest.emojis.filter((e) => /^[0-9a-f]{16}$/i.test(e.label.trim()));
if (LIMIT > 0) targets = targets.slice(0, LIMIT);

console.log(`待处理: ${targets.length} 张（模型 ${MODEL}${QWEN_ONLY ? '，跳过本地 OCR' : ''}）`);

const OCR_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);

/** 本地 OCR 提文字（免费）；提不到返回空 */
function ocrText(file) {
  if (QWEN_ONLY) return '';
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (!OCR_EXTS.has(ext)) return '';
  try {
    const r = ocrMod.runOcr([file], { timeoutMs: 60_000 });
    let t = (r?.[0]?.text ?? '').replace(/\s+/g, ' ').trim();
    t = t.replace(/已思考[^）)]*[）)]?/g, '')
         .replace(/用时\s*\d+(\.\d+)?\s*秒/g, '')
         .replace(/^[>\s·]+/, '')
         .replace(/\s+/g, ' ')
         .trim();
    return t.length >= 2 ? t : '';
  } catch {
    return '';
  }
}

/** 用 Python + Pillow 把任意图转 PNG（统一格式，避免动图/webp 兼容问题） */
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

const PROMPT = [
  '这是一张聊天表情包。请回答两行，严格按格式：',
  '情绪：不超过15个中文字，描述它表达的情绪或使用场景',
  '角色：如果明确认识这个卡通角色/IP 才写名字，不确定就写"不确定"',
  '不要解释、不要引号、不要前后缀。',
].join(NL);

/** 调千问描述情绪 + 角色 */
async function qwenDescribe(file) {
  const b64 = toPngB64(file);
  if (!b64) return { emotion: '', character: '' };

  const payload = {
    model: MODEL,
    max_tokens: 80,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
  };

  try {
    const res = await fetch(QWEN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { emotion: '', character: '' };
    const d = await res.json();
    const raw = String(d?.choices?.[0]?.message?.content ?? '').trim();

    const emo = (/情绪[:：]\s*(.+)/.exec(raw)?.[1] ?? raw.split(NL)[0] ?? '').trim();
    const chRaw = (/角色[:：]\s*(.+)/.exec(raw)?.[1] ?? '').trim();
    const character = /不确定|不知道|unknown|^$/i.test(chRaw) ? '' : chRaw;
    return {
      emotion: emo.replace(/^["'“”]|["'“”]$/g, '').trim(),
      character,
    };
  } catch {
    return { emotion: '', character: '' };
  }
}

let byOcr = 0, byQwen = 0, failed = 0;

for (let i = 0; i < targets.length; i += 1) {
  const item = targets[i];
  const file = join(LIB, item.file);
  if (!existsSync(file)) continue;

  let label = ocrText(file);
  let how = 'OCR';
  let character = '';

  if (!label) {
    const r = await qwenDescribe(file);
    label = r.emotion;
    character = r.character;
    how = 'qwen';
  }

  if (!label) {
    failed += 1;
    console.log(`  [FAIL] ${item.file.slice(0, 12)}…`);
    continue;
  }

  const final = `${prefixArg || ''} ${label}`.trim().slice(0, 56);
  if (!DRY) {
    item.label = final;
    if (character) item.character = character;
  }
  if (how === 'OCR') byOcr += 1; else byQwen += 1;
  console.log(`  [${how}] ${label.slice(0, 34)}${character ? `  (角色: ${character})` : ''}`);

  if ((i + 1) % 25 === 0) console.log(`  …进度 ${i + 1}/${targets.length}`);
}

if (!DRY) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n完成：本地OCR ${byOcr}，千问 ${byQwen}，失败 ${failed}`);
console.log(`千问约 ${byQwen} 张图（¥1/百万 tokens 输入，≈ ¥${(byQwen * 0.003).toFixed(3)}）`);
console.log(DRY ? '（dry run，未写盘）' : `已写入 ${MANIFEST}`);
