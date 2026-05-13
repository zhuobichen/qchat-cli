/**
 * 实时消息监听 + 智能回复
 *
 * 双模式（自动选择）：
 *   有 deepseekApiKey → 云端 DeepSeek API 回复
 *   无 deepseekApiKey → 写入 pending-messages.json，由 Claude Code 消费
 *
 * 用法: npx tsx private/monitor-live.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { loadConfig } from './load-config.mjs';

const cfg = loadConfig();
const MY_ID = cfg.myQQ;
const FRIENDS = cfg.monitoredFriends || [];
const GROUPS = cfg.monitoredGroups || [];
const REPLY_WHITELIST = new Set(cfg.replyWhitelist || []);  // 必须显式设置，为空则不回复

const NAPCAT = 'http://127.0.0.1:3000';
const POLL_MS = 3000;
const IDENTITY_PATH = './identity.md';
const PENDING_FILE = './pending-messages.json';

// ═══ 模式判断 ═══
const USE_CLOUD = !!cfg.deepseekApiKey;
const MODE = USE_CLOUD ? '云端 DeepSeek API' : '本地管道 (pending-messages.json → Claude Code)';
const DS_API_KEY = cfg.deepseekApiKey || '';
const DS_BASE = 'https://api.deepseek.com';

let friendLastTime = {};
let friendContext = {};
let processingMessages = new Set();  // 正在处理中的消息（防并轮询重复）

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

  const aiRes = await fetch(`${DS_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DS_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: prompt }],
      reasoning_effort: 'high',
      extra_body: { thinking: { type: 'enabled' } },
      max_tokens: 200,
    }),
  });

  if (!aiRes.ok) throw new Error(`API ${aiRes.status}`);
  const data = await aiRes.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
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

      // 注意: message_seq 不是按时间递增的！用时间戳+message_id 组合去重
      const lastTime = friendLastTime[uid] || 0;
      const newMsgs = msgs.filter(m => m.time > lastTime);
      if (msgs.length > 0) friendLastTime[uid] = Math.max(...msgs.map(m => m.time));

      for (const msg of newMsgs) {
        // 防并发重复：同一消息正在被另一个轮询周期处理
        const msgKey = `${msg.sender?.user_id}_${msg.time}`;
        if (processingMessages.has(msgKey)) continue;
        processingMessages.add(msgKey);

        if (msg.sender?.user_id === MY_ID) {
          // 自己发的消息也记入上下文（保持对话连贯）
          const myText = msg.message
            .map(s => s.type === 'text' ? s.data.text : '')
            .join('').trim();
          if (myText) {
            if (!friendContext[uid]) friendContext[uid] = [];
            friendContext[uid].push({ sender: 'me', text: myText, time: msg.time || Date.now() });
            if (friendContext[uid].length > 20) friendContext[uid].shift();
          }
          processingMessages.delete(msgKey);
          continue;
        }
        const text = msg.message
          .map(s => s.type === 'text' ? s.data.text : '')
          .join('').trim();
        if (!text) continue;

        const nick = msg.sender?.nickname || String(msg.sender?.user_id);
        console.log(`[${new Date().toLocaleTimeString()}] ${nick}: ${text.slice(0, 60)}`);

        // 对方消息入上下文
        if (!friendContext[uid]) friendContext[uid] = [];
        friendContext[uid].push({ sender: nick, text, time: msg.time || Date.now() });
        if (friendContext[uid].length > 20) friendContext[uid].shift();

        // 检查是否已被自己回复（手机/其他设备已回）
        const alreadyReplied = newMsgs.some(m =>
          m.sender?.user_id === MY_ID && m.time >= msg.time
        );
        if (alreadyReplied) {
          console.log(`  ⏭ 已手动回复，跳过`);
          processingMessages.delete(msgKey);
          continue;
        }

        const canReply = REPLY_WHITELIST.has(uid);
        if (!canReply) {
          console.log(`  ⚠ ${nick} 不在回复白名单，仅监听`);
          processingMessages.delete(msgKey);
          continue;
        }

        if (USE_CLOUD) {
          try {
            const reply = await cloudReply(uid, text);
            if (reply) {
              await sendMessage(uid, reply);
              friendContext[uid].push({ sender: 'me', text: reply, time: Date.now() });
              if (friendContext[uid].length > 20) friendContext[uid].shift();
              console.log(`  → 已回复: ${reply.slice(0, 50)}`);
            }
          } catch (e) {
            console.error(`  ✗ 云端回复失败: ${e.message}`);
          }
        } else {
          localPipe(uid, nick, text, msg.time);
          console.log(`  → 已写入 pending，等待 Claude Code 处理`);
        }
        processingMessages.delete(msgKey);
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
