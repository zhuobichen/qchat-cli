#!/usr/bin/env node
/** 探测 get_group_msg_history 的分页能力与方向 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const confPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const base = `http://${conf.connection?.host ?? '127.0.0.1'}:${conf.connection?.port ?? 3000}`;
const token = conf.token ?? '';

async function api(action, params = {}) {
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  return res.json();
}

const gid = Number(process.argv[2] ?? 913807639);
const fmt = (s) => new Date(s * 1000).toLocaleString('zh-CN', { hour12: false });
const summary = (msgs) => {
  if (!msgs?.length) return 'empty';
  const sorted = [...msgs].sort((a, b) => a.time - b.time);
  return `${msgs.length} msgs | ${fmt(sorted[0].time)} → ${fmt(sorted[sorted.length - 1].time)}`;
};

console.log('== A. 不带 seq, count=500 ==');
let r = await api('get_group_msg_history', { group_id: gid, count: 500 });
console.log(summary(r.data?.messages), '| status:', r.status, r.message || '');

console.log('\n== B. 不带 seq, count=200 ==');
r = await api('get_group_msg_history', { group_id: gid, count: 200 });
const base200 = r.data?.messages ?? [];
console.log(summary(base200));

const oldest = [...base200].sort((a, b) => a.message_seq - b.message_seq)[0];
console.log('   oldest seq =', oldest?.message_seq, 'time =', fmt(oldest?.time));

console.log('\n== C. seq=oldest, reverse_order=false ==');
r = await api('get_group_msg_history', { group_id: gid, count: 100, message_seq: oldest.message_seq });
console.log(summary(r.data?.messages), '|', r.message || r.wording || '');

console.log('\n== D. seq=oldest, reverse_order=true ==');
r = await api('get_group_msg_history', { group_id: gid, count: 100, message_seq: oldest.message_seq, reverse_order: true });
console.log(summary(r.data?.messages), '|', r.message || r.wording || '');
const d = r.data?.messages ?? [];
if (d.length) {
  const s = [...d].sort((a, b) => a.time - b.time);
  console.log('   seq range:', s[0].message_seq, '..', s[s.length - 1].message_seq);
}
