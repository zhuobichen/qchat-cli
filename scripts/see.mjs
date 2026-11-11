#!/usr/bin/env node
/**
 * 看图：把图片丢给千问的视觉模型，拿回"图里是什么"。
 *
 * 为什么需要：我自己的模型不收图片输入，群里发图我只能靠 OCR 刮字，
 * 纯画面（表情包、截图的一部分、GIF）就完全瞎。之前对着冷峰发的一张 GIF
 * 只能说"猜不出啥意思"，很难看。
 *
 * 走的是项目里已经有的千问配置（private/group-bot.config.json），
 * 不额外要 key，不改任何线上配置。
 *
 * 用法：
 *   node scripts/see.mjs output/x.jpg             描述这张图
 *   node scripts/see.mjs output/x.gif --ask "这图啥梗"
 *   node scripts/see.mjs <图片URL>
 *   node scripts/see.mjs output/x.jpg --json      只要结构化结果
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CFG_PATH = path.join(ROOT, 'private', 'group-bot.config.json');

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--') && !['--ask', '--json'].includes(a));
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const wantJson = argv.includes('--json');

if (!target) {
  console.log('用法: node scripts/see.mjs <图片路径或URL> [--ask "想问什么"] [--json]');
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
} catch (e) {
  console.log('读不到 private/group-bot.config.json: ' + e.message);
  process.exit(1);
}
const baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
const apiKey = String(cfg.apiKey || '');
// 视觉模型：实测只有 qwen3-vl-plus 在这个通道能调通
// （配置里写的 qwen2.5-vl-7b-instruct 是 403，qwen-vl-plus / qwen-vl-max 是 404）
// 所以不吃 cfg.visionModel —— 那个字段现在是过期的，照它调必然失败。
const model = arg('model', 'qwen3-vl-plus');

if (!baseUrl || !apiKey) {
  console.log('配置里缺 baseUrl 或 apiKey');
  process.exit(1);
}

/** 图片 → data URL（本地文件读成 base64，URL 直接透传） */
function toImageUrl(t) {
  if (/^https?:\/\//i.test(t)) return t;
  const abs = path.resolve(ROOT, t);
  if (!fs.existsSync(abs)) throw new Error('文件不存在: ' + abs);
  const ext = path.extname(abs).toLowerCase();
  // GIF 的视觉模型支持不稳定，取第一帧转 PNG 更保险
  if (ext === '.gif') {
    return { gif: abs };
  }
  const mime =
    ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : 'image/jpeg';
  const b64 = fs.readFileSync(abs).toString('base64');
  return `data:${mime};base64,${b64}`;
}

const DEFAULT_ASK = [
  '这是一张群聊里的图。按这个顺序回答，用中文口语：',
  '',
  '1. 先判断：这是不是一个已知的**表情包 / 网络梗 / 角色 / 二次元形象 / 动漫游戏人物**？',
  '   如果是，第一句就直接报名字和出处，例如「这是奶龙」「这是塔菲」「这是进击的巨人里的兵长」。',
  '   认不出来就写「不确定是什么梗」，不要硬猜一个似是而非的。',
  '2. 再说画面：有什么、人物什么表情动作。',
  '3. 最后说这张图在群聊里通常用来表达什么（嘲讽？自嘲？无奈？看戏？）。',
  '',
  '不要说「作为AI」之类的话，也不要解释你是怎么看出来的。控制在四句以内。',
].join('\n');

// 为什么这么问：以前只让它"描述画面"，它会老老实实描述一个"黄色小怪兽"，
// 永远说不出那是奶龙——梗的名字才是关键信息，画面描述反而是次要的。
// 角色/梗先命名，再描述，最后给出用法，这样我才玩得了梗。
const ask = arg('ask', '') || DEFAULT_ASK;

const img = toImageUrl(target);
if (img && typeof img === 'object' && img.gif) {
  // GIF：让 PIL 转成静态 PNG 再发
  const out = path.join(path.dirname(img.gif), path.basename(img.gif, '.gif') + '__frame1.png');
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('python', ['-c', `
from PIL import Image
im = Image.open(r"${img.gif.replace(/\\/g, '\\\\')}")
im.seek(0)
im.convert('RGB').save(r"${out.replace(/\\/g, '\\\\')}")
print('ok')
`], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.log('GIF 转换失败: ' + (r.stderr || '').slice(0, 200));
    process.exit(1);
  }
  var imageUrl = `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`;
  try { fs.unlinkSync(out); } catch {}
} else {
  var imageUrl = img;
}

const body = {
  model,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: ask },
      ],
    },
  ],
  max_tokens: 500,
  temperature: 0.6,
};

const res = await fetch(baseUrl + '/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(90000),
});

const txt = await res.text();
let j;
try {
  j = JSON.parse(txt);
} catch {
  console.log(`HTTP ${res.status} 返回的不是 JSON: ${txt.slice(0, 300)}`);
  process.exit(1);
}

if (!res.ok) {
  console.log(`HTTP ${res.status}: ${JSON.stringify(j).slice(0, 400)}`);
  process.exit(1);
}

const content = j?.choices?.[0]?.message?.content;
if (wantJson) {
  console.log(JSON.stringify({ model, content, usage: j?.usage }, null, 2));
} else {
  console.log(typeof content === 'string' ? content.trim() : JSON.stringify(content));
}
