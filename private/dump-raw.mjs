#!/usr/bin/env node
/**
 * 导出群消息原始 JSON（用于取图片/链接等富媒体）
 * 用法: node private/dump-raw.mjs <群号> [条数=100]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const confPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const base = `http://${conf.connection?.host ?? '127.0.0.1'}:${conf.connection?.port ?? 3000}`;
const token = conf.token ?? '';

const groupId = Number(process.argv[2]);
const count = Number(process.argv[3] ?? 100);

async function api(action, params = {}) {
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(`${action}: ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
}

const data = await api('get_group_msg_history', { group_id: groupId, count });
const msgs = (data?.messages ?? []).sort((a, b) => a.time - b.time);
const rich = msgs.filter((m) => Array.isArray(m.message) && m.message.some((s) => ['image', 'mface', 'forward', 'json'].includes(s.type)));
console.log(JSON.stringify(rich.map((m) => ({ time: new Date(m.time * 1000).toLocaleString('zh-CN'), who: m.sender?.card || m.sender?.nickname, message_id: m.message_id, segments: m.message })), null, 2));
