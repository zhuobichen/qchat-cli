/**
 * 补抓：把某个群最近的历史图片过一遍"偷表情包"的判定，该收的收。
 *
 * 为什么需要：观察模式只能收**新**消息。开关打开之前的历史图，
 * 如果不补一遍，就得等下次有人发表情。
 *
 * 用法：
 *   node scripts/backfill-stickers.mjs [群号] [--count 50] [--dry]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const DRY = process.argv.includes('--dry');
const GID = Number(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 913807639);
const COUNT = Number(argOf('--count', '50')) || 50;

const steal = await import(pathToFileURL(path.join(process.cwd(), 'dist', 'core', 'sticker-steal.js')).href);

const cfgP = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
let token = '';
try {
  token = JSON.parse(fs.readFileSync(cfgP, 'utf8')).network.httpServers[0].token ?? '';
} catch {}

const api = async (action, body = {}, timeoutMs = 20000) => {
  const res = await fetch(`http://127.0.0.1:3000/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
};

console.log(`拉群 ${GID} 最近 ${COUNT} 条消息…`);
const h = await api('get_group_msg_history', { group_id: GID, count: COUNT });
const msgs = h?.data?.messages ?? [];
console.log(`拿到 ${msgs.length} 条`);

// 自己发的图不收——那是库里已有的，再偷一遍没意义
let selfUin = '';
try {
  const me = await api('get_login_info', {});
  selfUin = String(me?.data?.user_id ?? '');
} catch {}

const imgs = [];
for (const m of msgs) {
  if (selfUin && String(m.sender?.user_id) === selfUin) continue;
  for (const s of m.message ?? []) {
    if (s.type !== 'image') continue;
    imgs.push({ seg: s, msg: m });
  }
}
console.log(`其中图片 ${imgs.length} 张`);

const quota = steal.loadQuota();
const scope = `g${GID}`;
let added = 0;
let skipDup = 0;
let skipJudge = 0;
let skipDl = 0;

for (const { seg, msg } of imgs) {
  const d = seg.data ?? {};
  const likelySticker = String(d.sub_type) === '1' || /^\[.+\]$/.test(String(d.summary ?? ''));
  const url = d.url || d.file_url;

  let buf = null;
  if (url && /^https?:/.test(String(url))) {
    try {
      const r = await fetch(String(url), { signal: AbortSignal.timeout(20000) });
      if (r.ok) buf = Buffer.from(await r.arrayBuffer());
    } catch {
      /* 下面统计 */
    }
  }
  if (!buf) {
    skipDl += 1;
    continue;
  }

  const size = steal.probeImageSize(buf);
  const verdict = steal.judgeStealable({ buffer: buf, ...size, strict: !likelySticker });
  if (!verdict.accept) {
    skipJudge += 1;
    continue;
  }

  const fromName = msg.sender?.card || msg.sender?.nickname || '';
  if (DRY) { added += 1; console.log(`  [dry] 会收 ${fromName}`); continue; }
  const r = steal.addStolenSticker(path.join(process.cwd(), 'private', 'emoji-library'), {
    buffer: buf,
    fromUin: String(msg.sender?.user_id ?? ''),
    fromName,
    scope,
  });
  if (r.added) {
    added += 1;
    console.log(`  + ${r.label}  ${size.width ?? '?'}x${size.height ?? '?'}  ${Math.round(buf.length / 1024)}KB  ${verdict.reason}`);
    if (!DRY) steal.consumeQuota(scope, quota);
  } else {
    skipDup += 1;
  }
}

if (!DRY) steal.saveQuota(quota);
console.log(`\n收 ${added} 张 | 已有 ${skipDup} | 判定不收 ${skipJudge} | 下载失败 ${skipDl}${DRY ? '（dry，未写盘）' : ''}`);
