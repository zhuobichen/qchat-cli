/**
 * 给表情库批量打标：文字类的用 OCR，纯表情类的用视觉模型。
 *
 * 两条路自动分流：
 *   1. rapidocr（本地 CPU，快）→ 图里有字就提字当标签
 *   2. Qwen3-VL（本地 GPU，2 秒/张）→ 没字就描述表情
 *
 * 为什么需要两套：DeepSeek 那批一半是「思考框+台词」（有字），
 * 一半是纯表情脸（没字）。只用 OCR 会漏掉后者，只用视觉模型又浪费。
 *
 * 用法：
 *   node scripts/label-emojis.mjs --prefix DeepSeek           # 自动分流
 *   node scripts/label-emojis.mjs --prefix DeepSeek --dry
 *   node scripts/label-emojis.mjs --vlm-only                  # 跳过 OCR
 *
 * 前置：
 *   - OCR：本地 rapidocr（python 环境已有）
 *   - 视觉：先起 vlm\启动识图.bat（127.0.0.1:8081）；跑之前要停 TTS 腾显存
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const LIB = join(process.cwd(), 'private', 'emoji-library');
const MANIFEST = join(LIB, 'manifest.json');
const VLM = 'http://127.0.0.1:8081/v1/chat/completions';
const DRY = process.argv.includes('--dry');
const VLM_ONLY = process.argv.includes('--vlm-only');
const prefixArg = (() => { const i = process.argv.indexOf('--prefix'); return i >= 0 ? process.argv[i + 1] : ''; })();
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? Number(process.argv[i + 1]) : 0; })();

const ocrMod = await import(pathToFileURL(join(process.cwd(), 'dist', 'core', 'ocr.js')).href);
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

// 待打标 = 标签还是 hash 的（或指定前缀下的全部）
let targets = prefixArg
  ? manifest.emojis.filter((e) => e.label.startsWith(prefixArg))
  : manifest.emojis.filter((e) => /^[0-9a-f]{16}$/i.test(e.label.trim()));
if (LIMIT > 0) targets = targets.slice(0, LIMIT);

console.log(`待处理: ${targets.length} 张（模式: ${VLM_ONLY ? '仅视觉' : 'OCR → 视觉填空'}）`);

const OCR_EXTS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);

/** OCR 提文字；提不到返回空 */
function ocrText(file) {
  if (VLM_ONLY) return '';
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  if (!OCR_EXTS.has(ext)) return '';
  try {
    const r = ocrMod.runOcr([file], { timeoutMs: 60_000 });
    let t = (r?.[0]?.text ?? '').replace(/\s+/g, ' ').trim();
    // 去掉思考框 UI 噪音
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

/** 用 Python + Pillow 转 PNG 再喂（llama.cpp 不认 webp） */
function vlmDescribe(file) {
  const py = `
import base64, io, json, sys
from PIL import Image
p = sys.argv[1]
im = Image.open(p)
im = im.convert('RGBA') if im.mode in ('P','LA','RGBA') else im.convert('RGB')
w, h = im.size
if max(w, h) > 768:
    s = 768 / max(w, h)
    im = im.resize((int(w*s), int(h*s)))
buf = io.BytesIO(); im.save(buf, format='PNG')
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
`;
  const r = spawnSync('python', ['-c', py, file], { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return '';
  const b64 = r.stdout.trim();

  const payload = JSON.stringify({
    model: 'qwen3-vl',
    max_tokens: 60,
    temperature: 0.2,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '这是一张聊天表情包。用不超过15个中文字描述它表达的情绪或使用场景，只输出描述本身，不要解释、不要引号。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
  });
  const c = spawnSync('curl', [
    '-s', '-m', '180', '-X', 'POST', VLM,
    '-H', 'Content-Type: application/json',
    '--data-binary', '@-',
  ], { input: payload, encoding: 'utf8', timeout: 200_000, maxBuffer: 32 * 1024 * 1024 });
  if (c.status !== 0 || !c.stdout) return '';
  try {
    const d = JSON.parse(c.stdout);
    const text = String(d?.choices?.[0]?.message?.content ?? '').trim();
    return text.replace(/^["'“”]|["'“”]$/g, '').trim();
  } catch {
    return '';
  }
}

let byOcr = 0, byVlm = 0, failed = 0;
for (let i = 0; i < targets.length; i += 1) {
  const item = targets[i];
  const file = join(LIB, item.file);
  if (!existsSync(file)) continue;

  let label = ocrText(file);
  let how = 'OCR';
  if (!label) {
    label = vlmDescribe(file);
    how = 'VLM';
  }
  if (!label) {
    failed += 1;
    if ((i + 1) % 10 === 0) console.log(`  …${i + 1}/${targets.length}（失败 ${failed}）`);
    continue;
  }

  const final = `${prefixArg || 'DeepSeek'} ${label}`.slice(0, 56);
  if (!DRY) item.label = final;
  if (how === 'OCR') byOcr += 1; else byVlm += 1;
  console.log(`  [${how}] ${label.slice(0, 40)}`);
}

if (!DRY) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n完成：OCR 打标 ${byOcr}，视觉打标 ${byVlm}，失败 ${failed}`);
console.log(DRY ? '（dry run，未写盘）' : `已写入 ${MANIFEST}`);
