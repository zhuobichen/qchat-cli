/**
 * 实时消息监听 + 智能回复
 *
 * 双模式（自动选择）：
 *   有 ANTHROPIC_API_KEY → 云端 Claude API 回复
 *   无 ANTHROPIC_API_KEY → 写入 pending-messages.json，由 Claude Code 消费
 *
 * 用法: npx tsx private/monitor-live.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadConfig } from './load-config.mjs';

const cfg = loadConfig();
const MY_ID = cfg.myQQ;
const FRIENDS = cfg.monitoredFriends || [];
const GROUPS = cfg.monitoredGroups || [];

const NAPCAT = 'http://127.0.0.1:3000';
const POLL_MS = 3000;
const IDENTITY_PATH = './identity.md';
const PENDING_FILE = './pending-messages.json';

// ═══ 模式判断 ═══
const USE_CLOUD = !!process.env.ANTHROPIC_API_KEY;
const MODE = USE_CLOUD ? '云端 API' : '本地管道 (pending-messages.json → Claude Code)';

let friendLastSeq = {};
let friendContext = {};

// ═══ 工具函数 ═══
function loadIdentity() {
  try { return readFileSync(IDENTITY_PATH, 'utf-8'); }
  catch { return '你是一个友好的AI助手。'; }
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
    body: JSON.stringify({ user_id: userId, message: [{ type: 'text', data: { text } }] }),
  });
}

async function cloudReply(uid, text) {
  const identity = loadIdentity();
  if (!friendContext[uid]) friendContext[uid] = [];
  friendContext[uid].push({ sender: uid, text, time: Date.now() });
  if (friendContext[uid].length > 20) friendContext[uid].shift();

  const prompt = `你是以下身份人格。请对以下消息生成回复（≤50字，符合人格风格）：

身份人格：
${identity}

最近对话上下文：
${friendContext[uid].map(c => `[${c.sender}]: ${c.text}`).join('\n')}

请只输出回复内容，不要附加任何解释。`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!aiRes.ok) throw new Error(`API ${aiRes.status}`);
  const data = await aiRes.json();
  return data.content?.[0]?.text?.trim() || '';
}

function localPipe(uid, senderNick, text, msgTime) {
  let pending = [];
  try { pending = JSON.parse(readFileSync(PENDING_FILE, 'utf-8')); } catch {}
  pending.push({
    peerUid: String(uid),
    senderNick: senderNick || String(uid),
    text,
    time: msgTime || Math.floor(Date.now() / 1000),
    receivedAt: new Date().toISOString(),
  });
  writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

// ═══ 主循环 ═══
async function poll() {
  for (const uid of FRIENDS) {
    try {
      const msgs = await api('/get_friend_msg_history', { user_id: uid, count: 5 });
      if (!msgs || msgs.length === 0) continue;

      const lastSeq = friendLastSeq[uid] || 0;
      const newMsgs = msgs.filter(m => m.message_seq > lastSeq);
      friendLastSeq[uid] = Math.max(...msgs.map(m => m.message_seq));

      for (const msg of newMsgs) {
        if (msg.sender?.user_id === MY_ID) continue;
        const text = msg.message
          .map(s => s.type === 'text' ? s.data.text : '')
          .join('').trim();
        if (!text) continue;

        const nick = msg.sender?.nickname || String(msg.sender?.user_id);
        console.log(`[${new Date().toLocaleTimeString()}] ${nick}: ${text.slice(0, 60)}`);

        if (USE_CLOUD) {
          try {
            const reply = await cloudReply(uid, text);
            if (reply) {
              await sendMessage(uid, reply);
              console.log(`  → 已回复: ${reply.slice(0, 50)}`);
            }
          } catch (e) {
            console.error(`  ✗ 云端回复失败: ${e.message}`);
          }
        } else {
          localPipe(uid, nick, text, msg.time);
          console.log(`  → 已写入 pending，等待 Claude Code 处理`);
        }
      }
    } catch (e) {
      // 单次轮询失败不中断
    }
  }
  setTimeout(poll, POLL_MS);
}

console.log('═══════════════════════════════════');
console.log('  qchat-cli 消息监听已启动');
console.log(`  模式: ${MODE}`);
console.log(`  私聊: ${FRIENDS.length > 0 ? FRIENDS.join(', ') : '(无)'}`);
console.log(`  群聊: ${GROUPS.length > 0 ? GROUPS.join(', ') : '(无)'}`);
console.log(`  人格: identity.md (每次轮询重新读取)`);
console.log('═══════════════════════════════════');
console.log('');
poll();
