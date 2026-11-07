#!/usr/bin/env node
/**
 * 梗库热更器：常驻进程，周期性从热榜捞新梗。
 *
 * 为什么常驻而不是 cron：Windows 计划任务需要管理员权限（本机装不上），
 * 而 DSH 的后台作业又绑在会话上。所以用一个自己会睡的循环进程最省事——
 * 它不依赖任何人，DSH 关了它还在跑（detached 启动）。
 *
 * 节奏：默认每 6 小时跑一次。太频繁没意义（热榜变化没那么快），
 * 还会白烧 AI 判定成本。
 *
 * 用法：
 *   node scripts/meme-refresher.mjs              # 前台跑（调试用）
 *   node scripts/meme-refresher.mjs --once       # 只跑一次就退出
 *   node scripts/meme-refresher.mjs --hours 6
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const ONCE = process.argv.includes('--once');
const HOURS = Math.max(1, Number(argOf('--hours', '6')) || 6);
const LIMIT = String(argOf('--limit', '15'));

const LOG = join(process.cwd(), 'private', 'knowledge', 'refresh.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(join(process.cwd(), 'private', 'knowledge'), { recursive: true });
    appendFileSync(LOG, line + String.fromCharCode(10), 'utf8');
  } catch {
    /* 日志写不进去不影响主流程 */
  }
}

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), 'scripts', 'refresh-memes.mjs'), '--limit', LIMIT],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, windowsHide: true },
    );
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => {
      const added = out.match(/新增 (\d+) 条/)?.[1] ?? '?';
      log(`刷新完成 exit=${code} 新增=${added} 条`);
      const plus = out.split(String.fromCharCode(10)).filter((l) => l.trim().startsWith('+ '));
      for (const p of plus) log('  ' + p.trim());
      resolve(code === 0);
    });
  });
}

log(`梗库热更器启动（每 ${HOURS} 小时一次，单次上限 ${LIMIT} 条）`);

if (ONCE) {
  await runOnce();
  process.exit(0);
}

let timer = null;
const loop = async () => {
  try {
    await runOnce();
  } catch (error) {
    log(`本次失败: ${String(error?.message ?? error).slice(0, 120)}`);
  }
  timer = setTimeout(loop, HOURS * 3600_000);
};

await loop();

// 收到终止信号时干净退出
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (timer) clearTimeout(timer);
    log(`收到 ${sig}，退出`);
    process.exit(0);
  });
}
