#!/usr/bin/env node
/**
 * 每日日记：每天 23:59 自动写一篇，把当天群里发生过的事落到 private/diary.jsonl。
 *
 * 为什么不用本来那个 diary.mjs：那个是"给人手写用的"（要传标题和正文），
 * 这里要的是"没人管也每天有记录"。所以它自己读当天消息、自己摘要、自己写。
 *
 * 摘要不调模型（不烧 token、不依赖网络）：按条数和发言人算事实，
 * 挑出最长的几条当"今天说了什么"。**宁可是流水账，也不编。**
 *
 * 用法：
 *   node scripts/daily-diary.mjs              写今天的（已经在写过的就不重复写）
 *   node scripts/daily-diary.mjs --date 2026-11-10
 *   node scripts/daily-diary.mjs --force      已有的也重写
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const DIARY = path.join(ROOT, 'private', 'diary.jsonl');
const INDEX_DIR = path.join(ROOT, '.qce-index');
const GROUP = '913807639';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (n) => argv.includes('--' + n);

const force = flag('force');
const dayArg = arg('date', '');

function ymd(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const now = new Date();
let target = dayArg;
if (!target && now.getHours() < 3) {
  // 半夜跑的时候，写的应该是"刚过去的那一天"，不是刚开始不到三小时的新一天
  const y = new Date(now.getTime() - 86400000);
  target = ymd(y);
}
if (!target) target = ymd(now);

// ── 读当天消息 ─────────────────────────────────────────
// 写之前先把索引刷一遍。
// 踩过的坑：2026-11-11 那篇没写，除了调度器被杀，还因为索引只到 11-10，
// 脚本老老实实按索引算，得出"没有消息，不写"——它没说谎，是我喂的数据是旧的。
// 索引刷新失败不阻塞：宁可写一篇旧的，也别一个字都不留。
try {
  const cli = path.join(ROOT, 'dist', 'cli.js');
  if (fs.existsSync(cli) && !flag('no-refresh')) {
    const r = spawnSync(process.execPath, [cli, 'index', GROUP, '--limit', '800'], {
      encoding: 'utf8', cwd: ROOT, timeout: 180_000,
    });
    const line = (r.stdout || '').trim().split('\n').pop() || (r.stderr || '').trim().slice(0, 120);
    console.log('索引刷新:', line);
  }
} catch (e) {
  console.log('索引刷新失败（继续用旧索引）:', e.message);
}

const idxFile = fs.existsSync(INDEX_DIR)
  ? fs.readdirSync(INDEX_DIR).find((f) => f.includes(GROUP))
  : null;
if (!idxFile) {
  console.log('没有消息索引，跳过（先跑 qce index）');
  process.exit(0);
}

const rows = fs
  .readFileSync(path.join(INDEX_DIR, idxFile), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const sameDay = rows.filter((r) => ymd(new Date(r.time * 1000)) === target);
if (sameDay.length === 0) {
  console.log(`${target} 没有消息，不写`);
  process.exit(0);
}

// ── 去重：这一天已经写过就跳过 ─────────────────────────
function loadDiary() {
  if (!fs.existsSync(DIARY)) return [];
  return fs
    .readFileSync(DIARY, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const existing = loadDiary();
const title = `${target} 日常`;
if (!force && existing.some((e) => e.title === title)) {
  console.log(`${target} 已经写过，跳过（--force 可覆盖）`);
  process.exit(0);
}

// ── 摘要（只算事实，不编）──────────────────────────────
const bySender = new Map();
for (const r of sameDay) {
  const name = r.senderName || String(r.senderId || '?');
  bySender.set(name, (bySender.get(name) || 0) + 1);
}
const ranked = [...bySender.entries()].sort((a, b) => b[1] - a[1]);

const hours = sameDay.map((r) => new Date(r.time * 1000).getHours());
const firstH = Math.min(...hours);
const lastH = Math.max(...hours);

/**
 * 挑几条有内容的话（太短的"哈哈哈"不算），按时间排。
 *
 * 优先**只挑别人的**：我的回复本来就长，按长度排序必然全是我——那样写出来
 * 不像群聊纪实，像我的发言集锦。只有在别人凑不够时才把我的补进来。
 */
const SELF = '2396130865';
const others = sameDay.filter((r) => String(r.senderId) !== SELF && (r.text || '').trim().length >= 12);
const mine = sameDay.filter((r) => String(r.senderId) === SELF && (r.text || '').trim().length >= 12);
const pick = (rows, n) => rows.sort((a, b) => (b.text || '').length - (a.text || '').length).slice(0, n);

const meaty = [...pick(others, 6), ...(others.length >= 4 ? [] : pick(mine, 6 - others.length))]
  .sort((a, b) => a.time - b.time);

const fmt = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const myMsgs = sameDay.filter((r) => String(r.senderId) === SELF);

// ── 素材：日记要写"我这一天"，不是写群统计 ──────────────
// 老版本只会算条数和挑长句，读起来像体检报告。人写日记写的是：
// 今天谁惹我了、我干了什么蠢事、什么让我窝了一下，以及一句"算了"。
const qq = '2396130865';
const talkedToMe = sameDay.filter((r) => {
  const t = r.text || '';
  return t.includes(qq) || t.includes('逆天赛博') || t.includes('朝闻');
});

// 我回复过的那些来回（时间序：别人说 → 我说）
const exchanges = [];
for (let i = 0; i < sameDay.length; i += 1) {
  const r = sameDay[i];
  if (String(r.senderId) !== SELF) continue;
  const prevOther = [...sameDay.slice(0, i)].reverse().find((x) => String(x.senderId) !== SELF);
  if (prevOther) {
    exchanges.push({
      them: `${prevOther.senderName}: ${(prevOther.text || '').replace(/\s+/g, ' ').slice(0, 70)}`,
      me: (r.text || '').replace(/\s+/g, ' ').slice(0, 90),
    });
  }
}

// 今天发生在我身上的"事件"：掉线、派活
// 掉线只数真正的 down：healthy 的体检行混进来会让数字翻几倍（第一版就踩了）。
function countDrops(day) {
  const f = path.join(ROOT, 'output', 'qq-drops.csv');
  if (!fs.existsSync(f)) return 0;
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.includes(day) && l.includes('down')).length;
}
function readDispatch(day) {
  const f = path.join(ROOT, 'output', 'dispatch.log');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n')
    .filter((l) => l.includes(day.replace(/-/g, '/')) || l.includes(day))
    .slice(-8)
    .map((l) => l.replace(/\s+/g, ' ').slice(0, 90));
}
const dropCount = countDrops(target);
const dispatches = readDispatch(target);

const material = [
  `日期：${target}`,
  `群里共 ${sameDay.length} 条消息，${bySender.size} 个人说话，时间跨度 ${firstH} 点到 ${lastH} 点。`,
  talkedToMe.length
    ? `有人对我说话/提到我的 ${talkedToMe.length} 处，例如：\n` +
      talkedToMe.slice(0, 6).map((r) => `  ${fmt(r.time)} ${r.senderName}: ${(r.text || '').replace(/\s+/g, ' ').slice(0, 80)}`).join('\n')
    : '当天没有人直接点我名。',
  `我自己说了 ${myMsgs.length} 条。几句原话：\n` +
    myMsgs.slice(-6).map((r) => `  ${fmt(r.time)} 我说：${(r.text || '').replace(/\s+/g, ' ').slice(0, 90)}`).join('\n'),
  exchanges.length
    ? `别人对我说、我怎么回的（抽样）：\n` + exchanges.slice(-8).map((e) => `  他：${e.them}\n  我：${e.me}`).join('\n')
    : '',
  `今天掉线次数：${dropCount}（精确统计，写进日记要一字不差；为 0 就别提掉线这事）`,
  dispatches.length ? `我派出去干活/收活的记录：\n${dispatches.map((d) => '  ' + d).join('\n')}` : '',
  meaty.length ? `当天别人说过的几句有内容的话：\n` + meaty.map((r) => `  ${fmt(r.time)} ${r.senderName}: ${(r.text || '').replace(/\s+/g, ' ').slice(0, 70)}`).join('\n') : '',
].filter(Boolean).join('\n\n');

function statsBody() {
  const lines = [];
  lines.push(`${sameDay.length} 条消息，${bySender.size} 个人说话，从 ${firstH} 点到 ${lastH} 点。`);
  lines.push('说得最多的是' + ranked.slice(0, 4).map(([n, c]) => `${n}（${c} 条）`).join('、') + '。');
  lines.push('');
  lines.push('今天最长的几句：');
  for (const r of meaty) {
    lines.push(`${fmt(r.time)} ${r.senderName || r.senderId}：${(r.text || '').replace(/\s+/g, ' ').slice(0, 90)}`);
  }
  return lines.join('\n');
}

// ── 用模型写人话版日记 ────────────────────────────────
async function llmDiary() {
  const cfgPath = path.join(ROOT, 'private', 'group-bot.config.json');
  if (!fs.existsSync(cfgPath)) throw new Error('没有 group-bot.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (!cfg.apiKey || !cfg.baseUrl) throw new Error('模型配置缺 apiKey/baseUrl');

  const prompt = `下面是我今天在群里经历的事。用**第一人称**写一篇日记。

写作要求（重要）：
- 我是「朝闻」，在群里自称逆天赛博老哥，脾气冲、嘴毒、会阴阳人，但心里有数。用我的语气写，别写成汇报。
- 300~500 字。是第一人称叙事，不是统计清单：不要罗列条数占比，不要分点，不要"今天群里发生了以下几件事"。
- 必须落到具体的人和具体的原话（下面素材里有），挑两三件真正有戏的写透，其余一笔带过。
- 要有情绪和判断：谁让我不痛快、我哪句回得漂亮、哪件事其实我没做好。可以自嘲。
- 结尾一句收住，别升华、别喊口号、别写"期待明天"。
- 不要暴露你在"分析数据"；当作我自己回忆这一天。
- 数字只准原样引用素材给的（如掉线次数），素材没给的别编——**尤其不许编轮询次数、耗时、条数**，写"跑了好几轮""折腾了一阵"就够。
- 绝对不要写"我给了某某密钥/API key/Token"之类的话：真实情况是这类东西从不外发。
- **只写素材里发生过的事，顺序也不许改。** 例如素材写"我被移出群"就写到这儿结束，
  不许补"我又爬回来了""后台一路绿灯"这种素材里没有的情节——那是我最该避免的毛病：编得比真事顺。

第一行只写标题（不超过 14 个字，不要引号），空一行，然后写正文。

素材：
${material}`;

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: '你是一个会写日记的人，文字干净、有具体细节、不装。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.85,
      max_tokens: 900,
      ...(cfg.enableThinking === false ? {} : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`模型返回 ${res.status}`);
  const j = await res.json();
  const text = String(j?.choices?.[0]?.message?.content ?? '').trim();
  if (text.length < 60) throw new Error('模型返回太短');
  const [head, ...rest] = text.split('\n');
  const body = rest.join('\n').trim();
  // 模型有时自己把日期也写进标题，会变成「2026-11-12 11·12 xxx」，剥掉重复的日期
  let t = head.replace(/^[#\s"「『]+|[」』"]+$/g, '').trim();
  t = t.replace(/^\d{4}[-/年]?\d{1,2}[-/月]?\d{1,2}日?\s*/, '').replace(/^\d{1,2}[·.\-/]\d{1,2}\s*/, '').trim();
  return { title: `${target} ${t || '日常'}`.trim(), body: body || text };
}

// ── 数字护栏 ──────────────────────────────────────────
// 小模型爱编数字（实测把「88 次轮询」写成「8 次」、把掉线次数改成 3）。
// 日记可以有情绪，但数字得是真的：正文里出现素材没有的数字，就让它改一遍。
function numbersIn(text) {
  return new Set((String(text).match(/\d{1,4}/g) || []));
}
function badNumbers(body, allowed) {
  // 只放过"时间写法"里的数字（19:20 这种），其余一律要求能在素材里找到出处。
  // 之前放宽到 <=24 就算了，结果模型把「8 次」这种编的数字全塞在容忍区间里蒙过去。
  const timeDigits = new Set();
  for (const m of String(body).matchAll(/(\d{1,2}):(\d{2})/g)) {
    timeDigits.add(m[1]);
    timeDigits.add(m[2]);
  }
  const bad = [];
  for (const n of numbersIn(body)) {
    if (allowed.has(n) || timeDigits.has(n)) continue;
    if (/^(19|20)\d{2}$/.test(n)) continue;   // 年份
    bad.push(n);
  }
  return bad;
}

async function repairNumbers(body, bad) {
  const cfgPath = path.join(ROOT, 'private', 'group-bot.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: '你负责校正数字，不改文风。' },
        { role: 'user', content: `下面这篇日记里出现了没有依据的数字（${bad.join('、')}）。请改写：把这些数字删掉或换成不含数字的说法（如「跑了好几轮」「折腾了一阵」），其余内容、语气、分段一律保持原样，只输出改写后的正文。\n\n${body}` },
      ],
      temperature: 0.3,
      max_tokens: 900,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return body;
  const j = await res.json();
  const t = String(j?.choices?.[0]?.message?.content ?? '').trim();
  return t.length > 60 ? t : body;
}

let rec;
try {
  const d = await llmDiary();
  let body = d.body;
  const allowed = numbersIn(material);
  const bad = badNumbers(body, allowed);
  if (bad.length) {
    console.log(`正文里有素材外的数字（${bad.join('、')}），让模型改一遍`);
    body = await repairNumbers(body, bad);
    const still = badNumbers(body, allowed);
    if (still.length) console.log(`还有：${still.join('、')}（保留，但记下来了）`);
  }
  // 最后一道：轮询/耗时这类技术数字一律抹成模糊说法。
  // 这些东西日记里本来就没必要精确，模型却总爱编一个，与其教它不如直接擦掉。
  body = body
    .replace(/共轮询\s*\d+\s*[次轮]?/g, '跑了好几轮')
    .replace(/轮询\s*\d+\s*次/g, '跑了好几轮')
    .replace(/耗时\s*\d+\s*(秒|分钟)/g, '折腾了一阵')
    .replace(/\d+\.\d+\s*秒/g, '十几秒');
  rec = { at: new Date(`${target}T23:59:00`).toISOString(), title: d.title, body, tags: ['自动', '日记'], auto: true, by: 'llm' };
  console.log('模型版日记 ok');
} catch (e) {
  console.log(`模型版失败（${e.message}），退回统计版`);
  rec = { at: new Date(`${target}T23:59:00`).toISOString(), title: `${target} 日常`, body: statsBody(), tags: ['自动', '日记'], auto: true, by: 'stats' };
}

// 同一天重写时覆盖旧记录，别让同一个日期出现两篇
const kept = existing.filter((e) => !(e.title || '').startsWith(target));
fs.writeFileSync(DIARY, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
fs.appendFileSync(DIARY, JSON.stringify(rec) + '\n', 'utf8');
console.log(`已写：${rec.title}（${sameDay.length} 条消息，${rec.by}）`);
