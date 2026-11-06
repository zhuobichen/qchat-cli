#!/usr/bin/env node
/**
 * 待回复队列：QQ 消息进来 → 入队 → 我（会话）处理 → 出队。
 *
 * 为什么要队列而不是直接回：
 *   - watcher 只管「看见」，回复由会话里的我来做（用 harness 环境的模型 + 记忆 + 人格）
 *   - 我可能需要几分钟（查资料、调工具、想一下），队列能等
 *   - 队列落盘：我处理崩了/断线了，消息还在队列里，重启接着处理
 *
 * 用法:
 *   node scripts/qce-queue.mjs add <json>     # 入队（watcher 调）
 *   node scripts/qce-queue.mjs list            # 看待处理
 *   node scripts/qce-queue.mjs take            # 取一条（标记处理中）
 *   node scripts/qce-queue.mjs done <id>       # 处理完，删除
 *   node scripts/qce-queue.mjs skip <id> <原因> # 跳过
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUEUE_DIR = process.env.QCE_QUEUE_DIR ?? join(ROOT, 'private', '.queue');
const QUEUE_PATH = join(QUEUE_DIR, 'pending.json');

const cmd = process.argv[2] ?? 'list';

function load() {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    const p = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

function save(list) {
  mkdirSync(QUEUE_DIR, { recursive: true });
  const tmp = `${QUEUE_PATH}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  renameSync(tmp, QUEUE_PATH);
}

function add(payload) {
  const list = load();
  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    payload,
    status: 'pending',
    createdAt: Date.now(),
    attempts: 0,
  };
  list.push(entry);
  save(list);
  console.log(JSON.stringify(entry));
}

function take() {
  const list = load();
  const i = list.findIndex((e) => e.status === 'pending');
  if (i < 0) {
    console.log(JSON.stringify({ empty: true }));
    return;
  }
  list[i].status = 'processing';
  list[i].attempts += 1;
  list[i].takenAt = Date.now();
  save(list);
  console.log(JSON.stringify(list[i]));
}

function done(id) {
  const list = load();
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) {
    console.log('not found');
    return;
  }
  list.splice(i, 1);
  save(list);
  console.log('ok');
}

function skip(id, reason) {
  const list = load();
  const e = list.find((x) => x.id === id);
  if (!e) {
    console.log('not found');
    return;
  }
  e.status = 'skipped';
  e.reason = reason ?? '';
  e.skippedAt = Date.now();
  save(list);
  console.log('ok');
}

function list_() {
  const list = load();
  const pending = list.filter((e) => e.status === 'pending');
  console.log(JSON.stringify({
    total: list.length,
    pending: pending.length,
    processing: list.filter((e) => e.status === 'processing').length,
    skipped: list.filter((e) => e.status === 'skipped').length,
    items: list.slice(-20),
  }, null, 2));
}

/** 超时的 processing 重新入队（我崩了/断线了） */
function reclaim(olderThanSec = 300) {
  const list = load();
  const now = Date.now();
  let n = 0;
  for (const e of list) {
    if (e.status === 'processing' && now - (e.takenAt ?? 0) > olderThanSec * 1000) {
      e.status = 'pending';
      n += 1;
    }
  }
  if (n > 0) save(list);
  console.log(JSON.stringify({ reclaimed: n }));
}

switch (cmd) {
  case 'add': {
    let payload;
    try {
      payload = JSON.parse(process.argv[3] ?? '{}');
    } catch {
      payload = { raw: process.argv[3] ?? '' };
    }
    add(payload);
    break;
  }
  case 'list': list_(); break;
  case 'take': take(); break;
  case 'done': done(process.argv[3]); break;
  case 'skip': skip(process.argv[3], process.argv[4]); break;
  case 'reclaim': reclaim(Number(process.argv[3] ?? 300)); break;
  default:
    console.log('用法: add|list|take|done|skip|reclaim');
    process.exit(1);
}
