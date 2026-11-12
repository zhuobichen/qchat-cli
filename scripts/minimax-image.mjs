/**
 * MiniMax 生图（image-01 / 后续新模型）。
 *
 * 为什么要单开一个：原来生图只有豆包桌面版那条路——它要开 GUI、要点输入框、
 * 一张 15~35 秒，而且一次只能跑一个。MiniMax 是纯 HTTP，能并发、能指定比例、
 * 能拿 base64 自己落盘，适合当"默认出图"这条路。
 *
 * 用法：
 *   node scripts/minimax-image.mjs "一只鲸鱼在城市上空游过" 
 *   node scripts/minimax-image.mjs "..." --ar 9:16 --n 2 --name whale
 *   node scripts/minimax-image.mjs "..." --model image-01 --url     # 只回 url 不落盘
 *
 * 约定：成功时打印 `IMAGE_PATH=<绝对路径>`，方便上层脚本 grep。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG_PATH = path.join(ROOT, 'private', 'minimax.config.json');

const argv = process.argv.slice(2);
function flag(name, def = '') {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? def) : def;
}
const has = (name) => argv.includes(`--${name}`);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--ar', '--n', '--name', '--model', '--out'].includes(argv[i - 1])));

const prompt = positional.join(' ').trim();
if (!prompt) {
  console.error('用法: node scripts/minimax-image.mjs "<提示词>" [--ar 16:9] [--n 1] [--name 名字] [--model image-01] [--url]');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const aspect = flag('ar', cfg.defaultAspect || '16:9');
const n = Math.max(1, Math.min(4, Number(flag('n', '1')) || 1));
const model = flag('model', cfg.model || 'image-01');
const outDir = path.resolve(ROOT, flag('out', cfg.outDir || 'output/gen'));
const wantUrl = has('url');
const name = flag('name') || '';

const bases = [process.env.MINIMAX_BASE || cfg.baseUrl, cfg.baseUrlFallback].filter(Boolean);

async function callOnce(base) {
  const res = await fetch(`${base}/image_generation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MINIMAX_API_KEY || cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio: aspect,
      n,
      response_format: wantUrl ? 'url' : 'base64',
      prompt_optimizer: true,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} 非 JSON: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
let lastErr;
let data;
let usedBase = '';
for (const base of bases) {
  try {
    data = await callOnce(base);
    usedBase = base;
    break;
  } catch (e) {
    lastErr = e;
    console.error(`(${base} 失败: ${e.message.slice(0, 160)})`);
  }
}
if (!data) {
  console.error(`fail  ${lastErr?.message ?? '未知错误'}`);
  process.exit(1);
}

// MiniMax 的返回里 base_resp.status_code 0 才算成功（HTTP 200 也可能是业务错误）
const status = data?.base_resp?.status_code;
if (status !== undefined && status !== 0) {
  console.error(`fail  MiniMax 业务错误 ${status}: ${data?.base_resp?.status_msg || ''}`);
  process.exit(1);
}

const items = data?.data?.image_base64 ?? data?.data?.images ?? data?.data ?? [];
const urls = data?.data?.image_urls ?? [];

if (wantUrl || !items.length) {
  for (const u of urls) console.log(`IMAGE_URL=${u}`);
  if (!urls.length) console.error('fail  返回里没有图片');
  console.log(`BASE=${usedBase}`);
  process.exit(urls.length ? 0 : 1);
}

fs.mkdirSync(outDir, { recursive: true });
const saved = [];
items.forEach((item, i) => {
  const b64 = typeof item === 'string' ? item : item?.bytes;
  if (!b64) return;
  const stem = name ? `${name}${items.length > 1 ? `-${i + 1}` : ''}` : `mm-${stamp}${items.length > 1 ? `-${i + 1}` : ''}`;
  const buf = Buffer.from(b64, 'base64');
  // MiniMax 回的 base64 其实是 JPEG（实测 1280x720 的 JFIF），
  // 存成 .png 会让下游按扩展名判类型的工具拒读（read_image 就报过这个）。
  // 按 magic 定扩展名，别相信模型名。
  const ext = buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : buf.slice(0, 4).toString('hex') === '89504e47' ? 'png' : 'bin';
  const file = path.join(outDir, `${stem}.${ext}`);
  fs.writeFileSync(file, buf);
  saved.push(file);
});

if (!saved.length) {
  console.error('fail  返回里没有 base64 图片数据');
  process.exit(1);
}
for (const f of saved) console.log(`IMAGE_PATH=${f}`);
console.log(`BASE=${usedBase} MODEL=${model} AR=${aspect}`);
