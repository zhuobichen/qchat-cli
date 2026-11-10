/**
 * 日记：我自己写的工作记录。
 *
 * 为什么用 jsonl 而不是 markdown：面板要读、要按时间倒序、要统计条数，
 * jsonl 一行一条最省事；要人看的时候再用 --md 导出。
 *
 * 存在 private/diary.jsonl，一行一条：
 *   {"at":"2026-11-10T13:20:00+08:00","title":"...","body":"...","tags":["群","修bug"]}
 *
 * 用法：
 *   node scripts/diary.mjs write "标题" "正文" [--tags 群,修bug]
 *   node scripts/diary.mjs list [--limit 10]
 *   node scripts/diary.mjs md > 日记.md
 */
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'private', 'diary.jsonl');
const args = process.argv.slice(2);
const cmd = args[0] ?? 'list';

const takeFlag = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : '';
};

function load() {
  if (!fs.existsSync(FILE)) return [];
  const out = [];
  for (const line of fs.readFileSync(FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 坏行跳过 */
    }
  }
  return out;
}

function localIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = pad(Math.floor(Math.abs(off) / 60));
  const mm = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${hh}:${mm}`;
}

if (cmd === 'write') {
  // 位置参数：write <title> <body>
  const pos = args.slice(1).filter((a) => !a.startsWith('--') && a !== takeFlag('--tags'));
  const title = pos[0] ?? '';
  const body = pos[1] ?? '';
  if (!title) {
    console.log('用法: node scripts/diary.mjs write "标题" "正文" [--tags a,b]');
    process.exit(1);
  }
  const tagsRaw = takeFlag('--tags');
  const rec = {
    at: localIso(),
    title,
    body,
    ...(tagsRaw ? { tags: tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
  };
  fs.appendFileSync(FILE, JSON.stringify(rec) + '\n', 'utf8');
  console.log(`已写入 ${rec.at}: ${title}`);
  process.exit(0);
}

if (cmd === 'list') {
  const limit = Number(takeFlag('--limit') ?? 10);
  const all = load().slice().reverse().slice(0, limit);
  if (all.length === 0) {
    console.log('还没有日记。');
    process.exit(0);
  }
  for (const e of all) {
    console.log(`${e.at?.slice(0, 16).replace('T', ' ')}  ${e.title}`);
    if (e.body) console.log(`    ${String(e.body).slice(0, 100)}`);
  }
  process.exit(0);
}

if (cmd === 'md') {
  const all = load().slice().reverse();
  console.log('# 日记\n');
  for (const e of all) {
    console.log(`## ${e.at?.slice(0, 16).replace('T', ' ')}  ${e.title}\n`);
    if (e.body) console.log(e.body + '\n');
    if (e.tags?.length) console.log(`标签: ${e.tags.join(' / ')}\n`);
  }
  process.exit(0);
}

console.log('用法: write | list | md');
