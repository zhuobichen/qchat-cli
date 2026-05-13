/**
 * 轻量监听 → pending-messages.json
 * 用法: npx tsx private/monitor-notify.mjs
 */
import { writeFileSync } from 'fs';
import { loadConfig } from './load-config.mjs';

const cfg = loadConfig();
const MY_ID = cfg.myQQ;
const FRIENDS = cfg.monitoredFriends || [];
const GROUPS = cfg.monitoredGroups || [];

const NAPCAT = 'http://127.0.0.1:3000';
const POLL_MS = 3000;
const LOG_FILE = './pending-messages.json';

let lastCheckTime = Math.floor(Date.now() / 1000);

async function api(url, body) {
  const res = await fetch(NAPCAT + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()).data?.messages || [];
}

async function poll() {
  const now = Math.floor(Date.now() / 1000);
  for (const uid of FRIENDS) {
    const msgs = await api('/get_friend_msg_history', {
      user_id: uid, count: 5,
    });
    const newMsgs = (msgs || []).filter(m => m.time > lastCheckTime && m.sender?.user_id !== MY_ID);
    if (newMsgs.length > 0) {
      const pending = newMsgs.map(m => ({
        peerUid: String(uid),
        chatType: 1,
        sender: m.sender?.user_id,
        text: m.message.map(s => s.type === 'text' ? s.data.text : '').join(''),
        time: m.time,
      }));
      let existing = [];
      try { existing = JSON.parse(readFileSync(LOG_FILE, 'utf-8')); } catch {}
      existing.push(...pending);
      writeFileSync(LOG_FILE, JSON.stringify(existing, null, 2));
      console.log(`[${new Date().toLocaleTimeString()}] ${pending.length} 条新消息 → pending`);
    }
  }
  lastCheckTime = now;
  setTimeout(poll, POLL_MS);
}

console.log('轻量监听已启动');
poll();
