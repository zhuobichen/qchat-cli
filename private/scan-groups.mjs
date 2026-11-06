#!/usr/bin/env node
/**
 * 扫描所有群最近消息，定位含关键词的群
 * 用法: node private/scan-groups.mjs 力工 海克斯 大乱斗 [每群条数=100]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const confPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
const base = `http://${conf.connection?.host ?? '127.0.0.1'}:${conf.connection?.port ?? 3000}`;
const token = conf.token ?? '';

const args = process.argv.slice(2);
const countArg = args.find((a) => /^\d+$/.test(a));
const perGroup = Number(countArg ?? 100);
const keywords = args.filter((a) => !/^\d+$/.test(a));
if (!keywords.length) {
  console.error('用法: node private/scan-groups.mjs 关键词1 关键词2 [每群条数]');
  process.exit(1);
}

async function api(action, params = {}) {
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(`${action}: ${json.message ?? json.wording ?? JSON.stringify(json).slice(0, 200)}`);
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
      if (t === 'face') return '[表情]';
      if (t === 'mface') return '[表情包]';
      if (t === 'at') return `@${s.data?.qq}`;
      if (t === 'record') return '[语音]';
      return `[${t}]`;
    })
    .join('');
}

const groups = await api('get_group_list');
console.error(`扫描 ${groups.length} 个群 × 最近 ${perGroup} 条 ...\n`);
const hits = [];
for (const g of groups) {
  let msgs = [];
  try {
    msgs = (await api('get_group_msg_history', { group_id: g.group_id, count: perGroup }))?.messages ?? [];
  } catch (e) {
    console.error(`  ! ${g.group_name}: ${e.message}`);
    continue;
  }
  msgs.sort((a, b) => a.time - b.time);
  const matched = [];
  for (const m of msgs) {
    const text = flatten(m.message);
    if (keywords.some((k) => text.includes(k))) {
      const t = new Date(m.time * 1000);
      matched.push({
        time: `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`,
        who: m.sender?.card || m.sender?.nickname || String(m.sender?.user_id),
        text: text.slice(0, 120),
      });
    }
  }
  if (matched.length) {
    hits.push({ group: g, total: msgs.length, matched });
    console.error(`  HIT ${g.group_name} (${g.group_id}) — ${matched.length}/${msgs.length}`);
  }
}

console.log(`\n=== 命中 ${hits.length} 个群 ===`);
for (const h of hits) {
  console.log(`\n## ${h.group.group_name} (${h.group.group_id}) — 最近 ${h.total} 条中有 ${h.matched.length} 条命中`);
  for (const m of h.matched.slice(0, 15)) console.log(`  ${m.time}  ${m.who}: ${m.text}`);
}
