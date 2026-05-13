/**
 * 实时消息监听 + 智能回复
 *
 * 用法:
 *   # 有 private/config.json 时自动读取
 *   npx tsx monitor-live.mjs
 *
 *   # 无配置文件时通过命令行传参
 *   npx tsx monitor-live.mjs --friends 123,456 --myqq 789
 *
 *   # 云端 API 模式（需要 API key）
 *   npx tsx monitor-live.mjs --api-key sk-xxx
 *
 * 双模式：
 *   有 apiKey → 云端 DeepSeek API 回复
 *   无 apiKey → 写入 pending-messages.json，由 Claude Code 消费
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══ 加载配置 ═══
let cfg = {};

// 1. 尝试读 private/config.json
const privateConfig = join(__dirname, 'private', 'config.json');
if (existsSync(privateConfig)) {
  cfg = JSON.parse(readFileSync(privateConfig, 'utf-8'));
}

// 2. 解析 CLI 参数（优先级高于配置文件）
function parseArgs() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--friends' && args[i + 1]) {
      cfg.monitoredFriends = args[++i].split(',').map(Number);
    } else if (args[i] === '--groups' && args[i + 1]) {
      cfg.monitoredGroups = args[++i].split(',').map(Number);
    } else if (args[i] === '--myqq' && args[i + 1]) {
      cfg.myQQ = Number(args[++i]);
    } else if (args[i] === '--api-key' && args[i + 1]) {
      cfg.deepseekApiKey = args[++i];
    } else if (args[i] === '--whitelist' && args[i + 1]) {
      cfg.replyWhitelist = args[++i].split(',').map(Number);
    }
  }
}
parseArgs();

const MY_ID = cfg.myQQ;
const FRIENDS = cfg.monitoredFriends || [];
const REPLY_WHITELIST = new Set(cfg.replyWhitelist || []);

if (!MY_ID || FRIENDS.length === 0) {
  console.log('缺少必要配置。用法:');
  console.log('  npx tsx monitor-live.mjs --myqq <QQ号> --friends <QQ号1,QQ号2> [--api-key <key>] [--whitelist <QQ号>]');
  console.log('  或在 private/config.json 中配置 myQQ 和 monitoredFriends');
  process.exit(1);
}

const NAPCAT = 'http://127.0.0.1:3000';
const POLL_MS = 3000;
const IDENTITY_PATH = join(__dirname, 'identity.md');
const PENDING_FILE = join(__dirname, 'pending-messages.json');

const USE_CLOUD = !!cfg.deepseekApiKey;
const MODE = USE_CLOUD ? '云端 DeepSeek API' : '本地管道 (pending-messages.json → Claude Code)';
const DS_API_KEY = cfg.deepseekApiKey || '';
const DS_BASE = 'https://api.deepseek.com';

let friendLastTime = {};
let friendContext = {};
let processingMessages = new Set();

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

async function poll() {
  for (const uid of FRIENDS) {
    try {
      const msgs = await api('/get_friend_msg_history', { user_id: uid, count: 5 });
      if (!msgs || msgs.length === 0) continue;

      const lastTime = friendLastTime[uid] || 0;
      const newMsgs = msgs.filter(m => m.time > lastTime);
      if (msgs.length > 0) friendLastTime[uid] = Math.max(...msgs.map(m => m.time));

      for (const msg of newMsgs) {
        const msgKey = `${msg.sender?.user_id}_${msg.time}`;
        if (processingMessages.has(msgKey)) continue;
        processingMessages.add(msgKey);

        if (msg.sender?.user_id === MY_ID) {
          const myText = msg.message.map(s => s.type === 'text' ? s.data.text : '').join('').trim();
          if (myText) {
            if (!friendContext[uid]) friendContext[uid] = [];
            friendContext[uid].push({ sender: 'me', text: myText, time: msg.time || Date.now() });
            if (friendContext[uid].length > 20) friendContext[uid].shift();
          }
          processingMessages.delete(msgKey);
          continue;
        }

        const text = msg.message.map(s => s.type === 'text' ? s.data.text : '').join('').trim();
        if (!text) { processingMessages.delete(msgKey); continue; }

        const nick = msg.sender?.nickname || String(msg.sender?.user_id);
        console.log(`[${new Date().toLocaleTimeString()}] ${nick}: ${text.slice(0, 60)}`);

        if (!friendContext[uid]) friendContext[uid] = [];
        friendContext[uid].push({ sender: nick, text, time: msg.time || Date.now() });
        if (friendContext[uid].length > 20) friendContext[uid].shift();

        const alreadyReplied = newMsgs.some(m =>
          m.sender?.user_id === MY_ID && m.time >= msg.time
        );
        if (alreadyReplied) {
          console.log(`  ⏭ 已手动回复，跳过`);
          processingMessages.delete(msgKey);
          continue;
        }

        if (!REPLY_WHITELIST.has(uid)) {
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
    } catch (e) {}
  }
  setTimeout(poll, POLL_MS);
}

console.log('═══════════════════════════════════');
console.log('  qchat-cli 消息监听已启动');
console.log(`  模式: ${MODE}`);
console.log(`  私聊: ${FRIENDS.join(', ')}`);
console.log(`  群聊: ${(cfg.monitoredGroups || []).join(', ') || '(无)'}`);
console.log(`  人格: identity.md (每次轮询重新读取)`);
console.log(`  配置: ${existsSync(privateConfig) ? 'private/config.json' : '命令行参数'}`);
console.log('═══════════════════════════════════');
poll();
