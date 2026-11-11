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

/** 挑几条有内容的话（太短的"哈哈哈"不算），按时间排 */
const meaty = sameDay
  .filter((r) => (r.text || '').trim().length >= 12)
  .sort((a, b) => (b.text || '').length - (a.text || '').length)
  .slice(0, 6)
  .sort((a, b) => a.time - b.time);

const fmt = (t) => {
  const d = new Date(t * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const myMsgs = sameDay.filter((r) => String(r.senderId) === '2396130865');

const lines = [];
lines.push(`${sameDay.length} 条消息，${bySender.size} 个人说话，从 ${firstH} 点到 ${lastH} 点。`);
lines.push(
  '说得最多的是' +
    ranked
      .slice(0, 4)
      .map(([n, c]) => `${n}（${c} 条）`)
      .join('、') +
    '。',
);
lines.push('');
lines.push('今天最长的几句：');
for (const r of meaty) {
  const t = (r.text || '').replace(/\s+/g, ' ').slice(0, 90);
  lines.push(`${fmt(r.time)} ${r.senderName || r.senderId}：${t}`);
}
if (myMsgs.length) {
  lines.push('');
  lines.push(`我自己说了 ${myMsgs.length} 条。`);
}

const rec = {
  at: new Date(`${target}T23:59:00`).toISOString(),
  title,
  body: lines.join('\n'),
  tags: ['自动', '日记'],
  auto: true,
};

fs.appendFileSync(DIARY, JSON.stringify(rec) + '\n', 'utf8');
console.log(`已写：${title}（${sameDay.length} 条消息）`);
