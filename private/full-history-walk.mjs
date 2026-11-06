#!/usr/bin/env node
/**
 * 全量遍历群历史（往前翻到最早），输出可读文本
 * 用法: node private/full-history-walk.mjs <群号> [最大页数=40] [每页=500]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const confPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const base = `http://${conf.connection?.host ?? '127.0.0.1'}:${conf.connection?.port ?? 3000}`;
const token = conf.token ?? '';

const gid = Number(process.argv[2]);
const maxPages = Number(process.argv[3] ?? 40);
const perPage = Number(process.argv[4] ?? 500);
if (!gid) {
  console.error('用法: node private/full-history-walk.mjs <群号> [最大页数] [每页]');
  process.exit(1);
}

async function api(action, params = {}) {
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(`${action}: ${json.message ?? json.wording ?? ''}`);
  return json.data;
}

function flatten(msg) {
  if (typeof msg === 'string') return msg;
  if (!Array.isArray(msg)) return String(msg ?? '');
  return msg
    .map((s) => {
      const t = s.type;
      if (t === 'text') return s.data?.text ?? '';
      if (t === 'image') return '[图片]';
      if (t === 'face') return `[表情${s.data?.id ?? ''}]`;
      if (t === 'mface') return '[表情包]';
      if (t === 'at') return `@${s.data?.qq === 'all' ? '全体' : s.data?.qq}`;
      if (t === 'record') return '[语音]';
      if (t === 'video') return '[视频]';
      if (t === 'file') return '[文件]';
      if (t === 'reply') return '[回复]';
      if (t === 'json' || t === 'xml') return '[卡片]';
      if (t === 'forward') return '[合并转发]';
      return `[${t}]`;
    })
    .join('');
}

const store = new Map();
const addBatch = (msgs) => {
  let fresh = 0;
  for (const m of msgs ?? []) {
    const key = String(m.message_id ?? `${m.time}:${m.message_seq}`);
    if (!store.has(key)) {
      store.set(key, m);
      fresh++;
    }
  }
  return fresh;
};

console.error(`遍历群 ${gid}（每页 ${perPage}，最多 ${maxPages} 页）...`);
let page = 0;
let batch = (await api('get_group_msg_history', { group_id: gid, count: perPage }))?.messages ?? [];
addBatch(batch);
const first = [...store.values()].sort((a, b) => a.time - b.time);
console.error(`  第1页: +${batch.length}，累计 ${store.size}，最早 ${new Date(first[0].time * 1000).toLocaleString('zh-CN', { hour12: false })}`);

while (page < maxPages) {
  page++;
  const sorted = [...store.values()].sort((a, b) => a.time - b.time);
  const oldest = sorted[0];
  if (!oldest) break;
  let older;
  try {
    older = (await api('get_group_msg_history', {
      group_id: gid,
      count: perPage,
      message_seq: oldest.message_seq,
      reverse_order: true,
    }))?.messages ?? [];
  } catch (e) {
    console.error(`  第${page + 1}页失败: ${e.message}`);
    break;
  }
  const fresh = addBatch(older);
  const now = [...store.values()].sort((a, b) => a.time - b.time);
  console.error(
    `  第${page + 1}页: +${fresh}/${older.length}，累计 ${store.size}，最早 ${new Date(now[0].time * 1000).toLocaleString('zh-CN', { hour12: false })}`
  );
  if (fresh === 0) break;
}

const all = [...store.values()].sort((a, b) => a.time - b.time);
const lines = [];
for (const m of all) {
  const t = new Date(m.time * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const who = m.sender?.card || m.sender?.nickname || String(m.sender?.user_id);
  lines.push(`${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}  ${who}(${m.sender?.user_id})`);
  lines.push(`    ${flatten(m.message) || '[空]'}`);
}

mkdirSync('output', { recursive: true });
const out = `output/group-${gid}-full.txt`;
writeFileSync(out, `群 ${gid} 共 ${all.length} 条\n时间范围: ${new Date(all[0]?.time * 1000).toLocaleString('zh-CN', { hour12: false })} → ${new Date(all[all.length - 1]?.time * 1000).toLocaleString('zh-CN', { hour12: false })}\n\n` + lines.join('\n'), 'utf8');
console.log(`\n完成: ${all.length} 条 -> ${out}`);
