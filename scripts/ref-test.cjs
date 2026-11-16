// 两张图同时进模型（按 MiniMax 官方契约来）。
//
// 之前踩的坑：我用的是 `image: [a, b]`——这个字段在官方文档里**根本不存在**。
// 接口吞掉未知字段照常返回 200，出图看着也"像"，但那是纯文生图，
// 参考图一张都没进去。这是我今天最该记住的一类错：**参数错了不会报错，只会静静失效**。
//
// 官方图生图契约（platform.minimax.cn/docs/api-reference/image-generation-i2i）：
//   subject_reference: [{ type: 'character', image_file: '<公网URL 或 data:image/...;base64,...>' }]
//
// 两个问题要处理：
//   1) type 只支持 character（人像）。蓝肥鱼不是人像，能不能当主体参考要实测。
//   2) 多张是否都认，也要实测——所以这里逐个子集试，把结果记下来。
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/github_project/ZhaoWen_GitHub维护/qchat-cli';
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'private/minimax.config.json'), 'utf8'));
const KEY = process.env.MINIMAX_API_KEY || cfg.apiKey;
const BASE = process.env.MINIMAX_BASE || cfg.baseUrl || 'https://api.minimaxi.com/v1';

const FISH = path.join(ROOT, 'output/gen/avatar-fish.jpg');   // 蓝肥鱼本体
const GIRL = path.join(ROOT, 'output/gen/_qq-sent.jpg');      // 粉发兜帽口罩

function dataUrl(p) {
  const b = fs.readFileSync(p);
  const mime = p.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${b.toString('base64')}`;
}

// 提示词：说清"保持什么、只加什么"，不描述整体风格（风格由参考图带）
const PROMPT = 'A chubby round blue fish mascot character, big shiny eyes, tiny fins, thick clean sticker outline, '
  + 'now wearing a black hood over its head and a white medical mask covering its mouth, '
  + 'the mask fitted to the fish\'s face width, plain white background, cute chibi style, '
  + 'same pose and same body as the reference character.';

const CASES = [
  { name: '只传蓝鱼（character）', refs: [FISH] },
  { name: '只传女孩（character）', refs: [GIRL] },
  { name: '两张都传（character×2）', refs: [FISH, GIRL] },
];

async function gen(refs) {
  const res = await fetch(`${BASE}/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'image-01',
      prompt: PROMPT,
      aspect_ratio: '1:1',
      n: 1,
      response_format: 'url',
      prompt_optimizer: false,
      subject_reference: refs.map((p) => ({ type: 'character', image_file: dataUrl(p) })),
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* 非 JSON */ }
  const code = j?.base_resp?.status_code;
  const url = j?.data?.image_urls?.[0];
  return { http: res.status, code, msg: j?.base_resp?.status_msg, url, raw: text.slice(0, 160) };
}

(async () => {
  const out = [];
  for (const c of CASES) {
    const r = await gen(c.refs);
    const ok = r.code === 0 && r.url;
    console.log(`--- ${c.name}: code=${r.code} ${ok ? 'OK' : (r.msg || r.raw)}`);
    if (ok) {
      const file = path.join(ROOT, 'output/gen', `ref-test-${CASES.indexOf(c)}.jpg`);
      const buf = Buffer.from(await (await fetch(r.url)).arrayBuffer());
      fs.writeFileSync(file, buf);
      console.log('    saved ' + file);
    }
    out.push({ case: c.name, ok, code: r.code, msg: r.msg ?? null });
  }
  fs.writeFileSync(path.join(ROOT, 'output/gen/ref-test-report.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('\n汇总:', JSON.stringify(out));
})();
