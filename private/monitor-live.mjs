/**
 * 实时监听 + 人格回复（从 private/config.json 读取配置）
 * 用法: npx tsx private/monitor-live.mjs
 */
import { readFileSync } from 'fs';
import { loadConfig } from './load-config.mjs';

const cfg = loadConfig();
const MY_ID = cfg.myQQ;
const FRIENDS = cfg.monitoredFriends || [];
const GROUPS = cfg.monitoredGroups || [];

// ═══ 以下为原 monitor-live.mjs 逻辑 ═══
const NAPCAT = 'http://127.0.0.1:3000';
const POLL_MS = 3000;

let friendLastSeq = {};
let groupLastSeq = {};
let friendContext = {};

const IDENTITY_PATH = './identity.md';
let identityDoc = '';

function loadIdentity() {
  try {
    identityDoc = readFileSync(IDENTITY_PATH, 'utf-8');
  } catch {
    identityDoc = '你是一个友好的AI助手。';
  }
}

async function api(url, body) {
  const res = await fetch(NAPCAT + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()).data?.messages || [];
}

async function sendMessage(userId, text) {
  if (!text) return;
  await fetch(NAPCAT + '/send_private_msg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      message: [{ type: 'text', data: { text } }],
    }),
  });
}

async function poll() {
  loadIdentity();
  for (const uid of FRIENDS) {
    const msgs = await api('/get_friend_msg_history', {
      user_id: uid, count: 5,
    });
    if (!msgs || msgs.length === 0) continue;

    const newMsgs = friendLastSeq[uid]
      ? msgs.filter(m => m.message_seq > friendLastSeq[uid])
      : [];
    friendLastSeq[uid] = Math.max(...msgs.map(m => m.message_seq));

    for (const msg of newMsgs) {
      if (msg.sender?.user_id === MY_ID) continue;
      const text = msg.message.map(s => s.type === 'text' ? s.data.text : '').join('').trim();
      if (!text) continue;

      console.log(`[${new Date().toLocaleTimeString()}] ${msg.sender?.nickname || msg.sender?.user_id}: ${text}`);

      if (!friendContext[uid]) friendContext[uid] = [];
      friendContext[uid].push({ sender: msg.sender?.user_id, text, time: Date.now() });
      if (friendContext[uid].length > 20) friendContext[uid].shift();

      const replyPrompt = `你是以下身份人格。请对以下消息生成回复（≤50字，符合人格风格）：

身份人格：
${identityDoc}

最近对话上下文：
${friendContext[uid].map(c => `[${c.sender}]: ${c.text}`).join('\n')}

请只输出回复内容，不要附加任何解释。`;

      try {
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY || '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 100,
            messages: [{ role: 'user', content: replyPrompt }],
          }),
        });
        if (aiRes.ok) {
          const data = await aiRes.json();
          const reply = data.content?.[0]?.text?.trim();
          if (reply) {
            await sendMessage(uid, reply);
            console.log(`  → 已回复: ${reply}`);
          }
        }
      } catch (e) {
        console.error('AI回复失败:', e.message);
      }
    }
  }
  setTimeout(poll, POLL_MS);
}

console.log('消息监听已启动 (阅读 private/config.json 配置)');
console.log('监控私聊:', FRIENDS.join(', '));
console.log('监控群聊:', GROUPS.join(', '));
poll();
