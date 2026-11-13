// 把某一天的消息补进索引。
//
// 有两处索引，读的人不同，必须都补：
//   <repo>/.qce-index/            → daily-diary 读它（2026-11-13 就栽在这：只补了用户目录，日记仍看不到）
//   ~/.qchat-cli/index/           → qce search / stats 读它
//
// 两种数据来源：
//   默认              从 get_group_msg_history 拉（需要 QQ 在线；已被移出群也能拉）
//   --from-user-index 从 ~/.qchat-cli/index 复制到 .qce-index（QQ 不在线时用这个）
//
// 写法约束：必须在 host_exec 下跑——沙箱写不了 ~/.qchat-cli/index，会 EPERM。
// 只追加、不改已有记录，按 message_id 去重。

const fs = require('fs');
const http = require('http');
const path = require('path');

const TOKEN = '75277e324f924d73255a5d0b77543e035af0e509bc7d7559';
const GID = 913807639;
const USER_IDX = path.join(process.env.USERPROFILE || process.env.HOME, '.qchat-cli', 'index', `group-${GID}.jsonl`);
const REPO_IDX = path.join(__dirname, '..', '.qce-index', `group-${GID}.jsonl`);

const argv = process.argv.slice(2);
const DAY = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toLocaleDateString('sv-SE');
const FROM_USER_INDEX = argv.includes('--from-user-index');

function ymd(t) {
  return new Date(t * 1000).toLocaleDateString('sv-SE');
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function appendMissing(target, rows) {
  const existing = readRows(target);
  const seen = new Set(existing.map((r) => String(r.id)));
  const add = rows.filter((r) => r && r.id && !seen.has(String(r.id)));
  if (!add.length) {
    console.log(path.basename(target), '已是最新（', existing.length, '条）');
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, add.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.log(path.basename(target), '补入', add.length, '条；总数', existing.length + add.length);
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

(async () => {
  let rows = [];
  if (FROM_USER_INDEX) {
    rows = readRows(USER_IDX).filter((r) => ymd(r.time) === DAY);
    console.log('从用户索引取到', DAY, rows.length, '条');
  } else {
    const res = await post('get_group_msg_history', { group_id: GID, count: 400, reverseOrder: false });
    const msgs = res?.data?.messages ?? [];
    const today = msgs.filter((m) => ymd(m.time) === DAY);
    console.log('history', msgs.length, '条；', DAY, today.length, '条');
    rows = today.map((m) => ({
      id: String(m.message_id ?? m.real_id ?? ''),
      groupId: GID,
      time: m.time,
      senderId: Number(m.sender?.user_id ?? m.user_id),
      senderName: m.sender?.card || m.sender?.nickname || String(m.user_id),
      text: segText(m),
    }));
  }

  if (!rows.length) {
    console.log('没有数据可补（QQ 不在线？试试 --from-user-index）');
    process.exitCode = 1;
    return;
  }
  appendMissing(REPO_IDX, rows);
  appendMissing(USER_IDX, rows);
})();
