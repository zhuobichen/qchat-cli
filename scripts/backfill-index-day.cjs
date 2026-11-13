// 一次性：把 2026-11-13 那些消息补回索引（已被移出群，只有 history API 能取）
// 运行环境：必须在 host_exec 下跑——沙箱写不了 C:\Users\...\.qchat-cli\index。
const fs = require('fs');
const http = require('http');
const path = require('path');

const TOKEN = '75277e324f924d73255a5d0b77543e035af0e509bc7d7559';
const GID = 913807639;
const DAY = process.argv[2] || '2026-11-13';
const IDX = path.join(process.env.USERPROFILE || process.env.HOME, '.qchat-cli', 'index', 'group-913807639.jsonl');

function post(action, body) {
  return new Promise((resolve) => {
    const raw = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: 3000, path: '/' + action, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + TOKEN,
        'Content-Length': Buffer.byteLength(raw),
      },
    }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(raw); req.end();
  });
}

function segText(m) {
  const segs = Array.isArray(m.message) ? m.message : [];
  const parts = [];
  for (const s of segs) {
    if (s.type === 'text') parts.push(s.data.text);
    else if (s.type === 'image') parts.push('[图片]');
    else if (s.type === 'face') parts.push('[表情]');
    else if (s.type === 'json') parts.push('[卡片]');
    else if (s.type === 'record') parts.push('[语音]');
  }
  return parts.join(' ').trim();
}

(async () => {
  const res = await post('get_group_msg_history', { group_id: GID, count: 400, reverseOrder: false });
  const msgs = res?.data?.messages ?? [];
  const today = msgs.filter((m) => new Date(m.time * 1000).toLocaleDateString('sv-SE') === DAY);
  console.log('history', msgs.length, '条；', DAY, today.length, '条');

  const existing = fs.existsSync(IDX)
    ? fs.readFileSync(IDX, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    : [];
  const seen = new Set(existing.map((r) => String(r.id)));
  const add = [];
  for (const m of today) {
    const id = String(m.message_id ?? m.real_id ?? '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    add.push({
      id,
      groupId: GID,
      time: m.time,
      senderId: Number(m.sender?.user_id ?? m.user_id),
      senderName: m.sender?.card || m.sender?.nickname || String(m.user_id),
      text: segText(m),
    });
  }
  if (!add.length) { console.log('已是最新，无需补'); return; }
  fs.appendFileSync(IDX, add.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.log('补入', add.length, '条；总数', existing.length + add.length);
})();
