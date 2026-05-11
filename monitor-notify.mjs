import { writeFileSync, readFileSync } from 'fs';

const NAPCAT = 'http://127.0.0.1:3000';
const MY_ID = YOUR_QQ;
const POLL_MS = 3000;

const FRIENDS = [TARGET_QQ_1]; // 需要回复的私聊
const GROUPS = [GROUP_QQ];   // 仅监听的群聊

const LOG_FILE = 'E:/CodeProject/qchat-cli/pending-messages.json';

let lastCheckTime = Math.floor(Date.now() / 1000);

async function api(url, body) {
  const res = await fetch(NAPCAT + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()).data?.messages || [];
}

function getText(msg) {
  return msg.message.map(seg => {
    if (seg.type === 'text') return seg.data.text;
    if (seg.type === 'image') return '[图片]';
    if (seg.type === 'face') return '[表情]';
    if (seg.type === 'at') return '@' + (seg.data.qq || '');
    if (seg.type === 'json') { try { return '[分享] ' + JSON.parse(seg.data.data).meta?.detail_1?.desc; } catch { return '[小程序]'; } }
    if (seg.type === 'forward') return '[合并转发]';
    if (seg.type === 'file') return '[文件]';
    if (seg.type === 'video') return '[视频]';
    if (seg.type === 'record') return '[语音]';
    return '';
  }).join('');
}

// 轻量轮询：只检测新消息
async function poll() {
  const newPrivate = [];

  // 私聊：轻量检测（count:5）
  for (const uid of FRIENDS) {
    try {
      const msgs = await api('/get_friend_msg_history', { user_id: uid, count: 5 });
      for (const msg of msgs) {
        if (msg.time <= lastCheckTime) continue;
        if (msg.user_id === MY_ID) continue;
        newPrivate.push({ uid, msg });
      }
    } catch (e) {}
  }

  // 群聊：轻量检测，只打日志
  for (const gid of GROUPS) {
    try {
      const msgs = await api('/get_group_msg_history', { group_id: gid, count: 5 });
      for (const msg of msgs) {
        if (msg.time <= lastCheckTime) continue;
        if (msg.user_id === MY_ID) continue;
        const time = new Date(msg.time * 1000).toLocaleTimeString('zh-CN');
        const sender = msg.sender.card || msg.sender.nickname;
        console.log('[群聊 ' + time + '] ' + sender + ': ' + getText(msg));
      }
    } catch (e) {}
  }

  lastCheckTime = Math.floor(Date.now() / 1000);

  // 发现私聊新消息 → 拉取上下文 → 写入待处理
  if (newPrivate.length > 0) {
    for (const { uid, msg } of newPrivate) {
      const time = new Date(msg.time * 1000).toLocaleTimeString('zh-CN');
      const sender = msg.sender.card || msg.sender.nickname;
      console.log('[私聊 ' + time + '] ' + sender + ': ' + getText(msg));

      // 拉取上下文（20条）
      const contextMsgs = await api('/get_friend_msg_history', { user_id: uid, count: 20 });
      const context = contextMsgs.map(m => ({
        sender: m.user_id === MY_ID ? '我' : (m.sender.card || m.sender.nickname),
        text: getText(m),
        time: new Date(m.time * 1000).toLocaleString('zh-CN'),
      }));

      const pending = [{
        type: 'private',
        from: uid,
        sender,
        text: getText(msg),
        time: new Date(msg.time * 1000).toLocaleString('zh-CN'),
        timestamp: msg.time,
        context,
      }];

      // 追加到待处理文件（不覆盖）
      let existing = [];
      try { existing = JSON.parse(readFileSync(LOG_FILE, 'utf-8')); } catch {}
      existing.push(...pending);
      writeFileSync(LOG_FILE, JSON.stringify(existing, null, 2));
    }
  }
}

async function init() {
  writeFileSync(LOG_FILE, '[]');
  console.log('消息通知服务已启动');
  console.log('私聊: ' + FRIENDS.join(', ') + ' (需回复)');
  console.log('群聊: ' + GROUPS.join(', ') + ' (仅监听)');
  console.log('策略: 轻量检测(3s) → 发现新消息才拉取上下文');
  console.log('---');
  setInterval(poll, POLL_MS);
}
init();
