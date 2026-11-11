#!/usr/bin/env node
/**
 * 日记守夜：常驻进程，每天 23:59 跑一次 daily-diary.mjs。
 *
 * 为什么不用 Windows 计划任务：本机注册计划任务被拒（拒绝访问，权限不够）。
 * 而 qq-watch / party-watch 这些本来就是常驻进程在跑，多一个守夜进程是最省事的路子。
 *
 * 为什么自己写日志：host_exec detach 起的进程 stdout 会被丢弃（日志恒 0 字节）。
 *
 * 用法：
 *   node scripts/diary-scheduler.mjs           常驻，每天 23:59 跑
 *   node scripts/diary-scheduler.mjs --dry     只看下一次什么时候跑
 *   node scripts/diary-scheduler.mjs --now     立刻跑一次（补昨天的）
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const LOG = path.join(ROOT, 'output', 'diary-scheduler.log');
const SCRIPT = path.join(ROOT, 'scripts', 'daily-diary.mjs');
const HOUR = 23;
const MINUTE = 59;

const argv = process.argv.slice(2);
const dry = argv.includes('--dry');
const runNow = argv.includes('--now');

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + '\n', 'utf8');
  } catch {}
}

/** 下一次 23:59 的时刻 */
function nextFire(now = new Date()) {
  const t = new Date(now);
  t.setHours(HOUR, MINUTE, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t;
}

function run() {
  log('开始写日记');
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  log(`日记结果: ${out.split('\n').filter(Boolean).slice(-2).join(' / ') || '(无输出)'}  退出码 ${r.status}`);
}

if (runNow) {
  run();
  process.exit(0);
}

if (dry) {
  console.log('下一次:', nextFire().toLocaleString('zh-CN', { hour12: false }));
  process.exit(0);
}

log(`日记守夜启动：每天 ${HOUR}:${String(MINUTE).padStart(2, '0')} 跑一次`);
run(); // 启动时先补一次（如果今天还没写，daily-diary 自己会跳过）

for (;;) {
  const next = nextFire();
  const waitMs = next.getTime() - Date.now();
  log(`下一次 ${next.toLocaleString('zh-CN', { hour12: false })}（${Math.round(waitMs / 1000)} 秒后）`);
  await new Promise((r) => setTimeout(r, waitMs));
  run();
}
