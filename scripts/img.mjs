#!/usr/bin/env node
/**
 * 通用生图工具：参考图传几张都行。
 *
 * 为什么需要它：之前那个 minimax-image.mjs 只会纯文生图（它的请求体里根本没有参考图字段）。
 * 我今天还踩了两个坑，都写在这儿当文档：
 *   1) 给老接口 image-01 传 `image: [a,b]` —— 这个字段官方契约里不存在，
 *      接口吞掉未知字段照常返回 200，图看着"像"但参考图一张没进。**参数错了不会报错，只会静静失效。**
 *   2) image-01 的 subject_reference 设计上只收一张（实测两张报
 *      `2013 invalid params, image_reference must be one`），我却据此以为"多图不可能"。
 *
 * 真正支持多图的是新模型 MiniMax-H3-Image：
 *   文生图   POST /v1/images/generations   { prompt }
 *   图片编辑 POST /v1/images/edits         { prompt, image: [1~16 张] }
 *
 * 用法：
 *   node scripts/img.mjs "一只戴帽子的蓝鱼"                       # 无参考图 → 文生图
 *   node scripts/img.mjs "给它戴上口罩" --ref a.jpg --ref b.png    # 1~16 张 → 图片编辑
 *   node scripts/img.mjs "..." --ref a.jpg --model image-01        # 强制老模型（只能 1 张）
 *   node scripts/img.mjs "..." --size 1024x1024 --n 2 --name out
 *
 * 输出：output/gen/<name>-<时间>.jpg，并把每次调用记进 output/gen/prompts.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GEN = path.join(ROOT, 'output', 'gen');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'private', 'minimax.config.json'), 'utf8'));
const KEY = process.env.MINIMAX_API_KEY || cfg.apiKey;
const BASE = (process.env.MINIMAX_BASE || cfg.baseUrl || 'https://api.minimaxi.com/v1').replace(/\/$/, '');

const NEW_MODEL = 'MiniMax-H3-Image';
const OLD_MODEL = 'image-01';

function parseArgs(argv) {
  const refs = [];
  let prompt = '';
  const opts = { size: null, n: 1, name: 'img', model: null, ar: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--ref') { refs.push(argv[++i]); continue; }
    if (a === '--size') { opts.size = argv[++i]; continue; }
    if (a === '--n') { opts.n = Number(argv[++i]); continue; }
    if (a === '--name') { opts.name = argv[++i]; continue; }
    if (a === '--model') { opts.model = argv[++i]; continue; }
    if (a === '--ar') { opts.ar = argv[++i]; continue; }
    if (a.startsWith('--')) { console.error('未知参数 ' + a); process.exit(2); }
    prompt = (prompt ? prompt + ' ' : '') + a;
  }
  return { prompt, refs, opts };
}

function dataUrlOf(p) {
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  if (!fs.existsSync(abs)) throw new Error('参考图不存在: ' + abs);
  const b = fs.readFileSync(abs);
  const mime = /\.png$/i.test(abs) ? 'image/png' : /\.webp$/i.test(abs) ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${b.toString('base64')}`;
}

async function post(endpoint, body) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* 非 JSON，下面统一报 */ }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  // MiniMax 用 HTTP 200 + base_resp 表达失败，必须看 status_code
  const code = j?.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    throw new Error(`base_resp ${code}: ${j?.base_resp?.status_msg ?? text.slice(0, 200)}`);
  }
  return j;
}

const { prompt, refs, opts } = parseArgs(process.argv.slice(2));
if (!prompt) {
  console.error('用法: node scripts/img.mjs "<提示词>" [--ref 图1] [--ref 图2 ...] [--size 1024x1024] [--n 1] [--name 名字]');
  process.exit(2);
}
if (refs.length > 16) {
  console.error(`参考图最多 16 张，你给了 ${refs.length} 张`);
  process.exit(2);
}

const useOld = opts.model === OLD_MODEL;
const model = opts.model || (refs.length ? NEW_MODEL : NEW_MODEL);

async function main() {
  let payload;
  let endpoint;

  if (useOld) {
    // 老接口：subject_reference 只能一张，多图直接说明白
    if (refs.length > 1) {
      throw new Error(`${OLD_MODEL} 的 subject_reference 只收一张（实测多张报 image_reference must be one）。`
        + `要传 ${refs.length} 张请去掉 --model，用默认的 ${NEW_MODEL}。`);
    }
    endpoint = '/image_generation';
    payload = {
      model: OLD_MODEL,
      prompt,
      n: opts.n,
      response_format: 'url',
      prompt_optimizer: false,
      ...(opts.ar ? { aspect_ratio: opts.ar } : {}),
      ...(refs.length ? { subject_reference: [{ type: 'character', image_file: dataUrlOf(refs[0]) }] } : {}),
    };
  } else if (refs.length === 0) {
    // 新模型文生图
    endpoint = '/images/generations';
    payload = { model, prompt, n: opts.n, response_format: 'url' };
    if (opts.size) {
      const [w, h] = opts.size.split('x').map(Number);
      if (!w || !h) throw new Error('--size 写法应为 宽x高，例如 1024x1024');
      payload.width = w;
      payload.height = h;
    }
  } else {
    // 新模型图片编辑：1~16 张
    endpoint = '/images/edits';
    payload = {
      model,
      prompt,
      n: opts.n,
      response_format: 'url',
      images: refs.map((p) => ({ image_url: dataUrlOf(p) })),
    };
    if (opts.size) {
      const [w, h] = opts.size.split('x').map(Number);
      if (w && h) { payload.width = w; payload.height = h; }
    }
  }

  console.log(`POST ${BASE}${endpoint}  model=${model}  参考图=${refs.length} 张`);
  const j = await post(endpoint, payload);

  // 两种返回形状都要认：
  //   老 image-01 → { data: { image_urls: [...] } }
  //   新 H3       → { created, data: [{ url, size, revised_prompt }] }
  const urls = j?.data?.image_urls
    ?? (Array.isArray(j?.data) ? j.data.map((x) => x?.url).filter(Boolean) : [])
    ?? j?.image_urls ?? [];
  if (!urls.length) {
    console.log(JSON.stringify(j).slice(0, 500));
    throw new Error('返回里没有图片');
  }

  fs.mkdirSync(GEN, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const saved = [];
  for (let i = 0; i < urls.length; i += 1) {
    const name = `${opts.name}-${stamp}${i ? '-' + i : ''}.jpg`;
    const file = path.join(GEN, name);
    const buf = Buffer.from(await (await fetch(urls[i])).arrayBuffer());
    fs.writeFileSync(file, buf);
    saved.push(file);
    console.log('saved ' + file);
  }

  fs.appendFileSync(path.join(GEN, 'prompts.jsonl'), JSON.stringify({
    at: new Date().toISOString(), endpoint, model, prompt, refs, files: saved,
  }) + '\n', 'utf8');

  console.log(JSON.stringify({ ok: true, endpoint, model, files: saved }, null, 2));
}

main().catch((e) => {
  console.error('FAIL ' + e.message);
  process.exit(1);
});
