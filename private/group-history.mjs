#!/usr/bin/env node
/**
 * 读取指定群的历史消息，打印可读文本
 * 用法: node private/group-history.mjs <群号> [条数=200]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const confPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const host = conf.connection?.host ?? '127.0.0.1';
const port = conf.connection?.port ?? 3000;
const token = conf.token ?? '';
const base = `http://${host}:${port}`;

const groupId = Number(process.argv[2]);
const want = Number(process.argv[3] ?? 200);
if (!groupId) {
  console.error('用法: node private/group-history.mjs <群号> [条数]');
  process.exit(1);
}

async function api(action, params = {}) {
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(`${action} failed: ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
}

function flatten(msg) {
  if (typeof msg === 'string') return msg;
  if (!Array.isArray(msg)) return String(msg ?? '');
  const out = [];
  for (const seg of msg) {
    const t = seg.type;
    if (t === 'text') out.push(seg.data?.text ?? '');
    else if (t === 'face') out.push(`[表情${seg.data?.id ?? ''}]`);
    else if (t === 'image') out.push('[图片]');
    else if (t === 'mface') out.push('[表情包]');
    else if (t === 'record') out.push('[语音]');
    else if (t === 'video') out.push('[视频]');
    else if (t === 'file') out.push(`[文件 ${seg.data?.file ?? ''}]`);
    else if (t === 'at') out.push(`@${seg.data?.qq === 'all' ? '全体成员' : seg.data?.qq}`);
    else if (t === 'reply') out.push('[回复]');
    else if (t === 'json' || t === 'xml') out.push('[卡片消息]');
    else if (t === 'forward') out.push('[合并转发]');
    else out.push(`[${t}]`);
  }
  return out.join('').trim();
}

const members = new Map();
try {
  const list = await api('get_group_member_list', { group_id: groupId });
  for (const m of list ?? []) members.set(m.user_id, m.card || m.nickname || String(m.user_id));
} catch (e) {
  console.error(`(成员列表获取失败: ${e.message})`);
}

const byId = new Map();
let seq = undefined;
let guard = 0;
while (byId.size < want && guard++ < 60) {
  const batch = await api('get_group_msg_history', {
    group_id: groupId,
    count: Math.min(100, want - byId.size),
    ...(seq !== undefined ? { message_seq: seq } : {}),
  });
  const msgs = batch?.messages ?? [];
  if (msgs.length === 0) break;
  const before = byId.size;
  for (const m of msgs) {
    const key = m.message_id ?? `${m.time}:${m.message_seq}`;
    if (!byId.has(key)) byId.set(key, m);
  }
  const oldest = msgs.reduce((a, b) => (a.message_seq <= b.message_seq ? a : b));
  const nextSeq = oldest.message_seq;
  if (nextSeq === seq) break;
  seq = nextSeq;
  if (byId.size === before) break;
}

const collected = [...byId.values()].sort((a, b) => a.time - b.time);
const lines = [];
for (const m of collected) {
  const t = new Date(m.time * 1000);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  const who = m.sender?.card || m.sender?.nickname || members.get(m.sender?.user_id) || String(m.sender?.user_id);
  const text = flatten(m.message) || '[空]';
  lines.push(`${t.getMonth() + 1}/${t.getDate()} ${hh}:${mm}:${ss}  ${who}(${m.sender?.user_id})\n    ${text}`);
}
console.log(`群 ${groupId} 共取到 ${collected.length} 条消息\n`);
console.log(lines.join('\n'));
