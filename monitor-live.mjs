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
const IDENTITY_PATH = join(__dirname, cfg.identityFile || 'identity.md');
const PENDING_FILE = join(__dirname, 'pending-messages.json');
const MEMORY_DIR = join(__dirname, 'private', 'memory');
const LOCK_DIR = join(__dirname, 'private', 'locks');

// 确保目录存在
if (!existsSync(MEMORY_DIR)) {
  const { mkdirSync } = await import('fs');
  mkdirSync(MEMORY_DIR, { recursive: true });
}
if (!existsSync(LOCK_DIR)) {
  const { mkdirSync } = await import('fs');
  mkdirSync(LOCK_DIR, { recursive: true });
}

// ═══ 文件锁（原子操作，防竞态） ═══
function tryLock(msgId) {
  const lockFile = join(LOCK_DIR, `${msgId}.lock`);
  try {
    // 使用 writeFileSync + wx flag 实现原子创建
    writeFileSync(lockFile, String(Date.now()), { flag: 'wx' });
    return true;  // 锁成功
  } catch {
    return false; // 文件已存在 = 已被锁
  }
}

// ══════════════════════════════════════════
// 模式切换：有 deepseekApiKey → 云端，无 → 本地
// ══════════════════════════════════════════
const USE_CLOUD = !!cfg.deepseekApiKey;
const MODE = USE_CLOUD ? '云端 DeepSeek API' : '本地管道 (pending-messages.json → Claude Code)';
const DS_API_KEY = cfg.deepseekApiKey || '';
const DS_BASE = 'https://api.deepseek.com';

let friendLastTime = {};       // 预加载后的时间边界（仅用于过滤历史消息）
let friendContext = {};        // 最近原始消息
let friendContextSummary = {}; // 更早对话的压缩摘要

const MAX_RAW_CONTEXT = cfg.maxRawContext || 20;  // 可在 config.json 中覆盖

function updateContextSummary(uid, oldMsg) {
  if (!friendContextSummary[uid]) friendContextSummary[uid] = [];
  friendContextSummary[uid].push(`[${oldMsg.sender}] ${oldMsg.text.slice(0, 50)}`);
  if (friendContextSummary[uid].length > 30) friendContextSummary[uid].shift();
}

function addContext(uid, sender, text, time) {
  if (!friendContext[uid]) friendContext[uid] = [];
  friendContext[uid].push({ sender, text, time: time || Date.now() });
  // 溢出 → 移入摘要
  while (friendContext[uid].length > MAX_RAW_CONTEXT) {
    const old = friendContext[uid].shift();
    updateContextSummary(uid, old);
  }
}

function buildContextBlock(uid) {
  let block = '';
  const summary = friendContextSummary[uid];
  if (summary?.length > 0) {
    // AI 压缩的摘要（第一个元素是完整摘要文本）
    const text = summary.length === 1 && summary[0].length > 50
      ? summary[0]  // AI 生成的完整摘要
      : summary.join('\n');  // 旧格式：逐条简述
    block = `\n历史对话摘要：\n${text}`;
  }
  const ctx = friendContext[uid];
  if (ctx?.length > 0) {
    block += `\n\n最近对话：\n${ctx.map(c => `[${c.sender}]: ${c.text}`).join('\n')}`;
  }
  return block;
}

function loadIdentity() {
  try { return readFileSync(IDENTITY_PATH, 'utf-8'); }
  catch { return '你是一个友好的AI助手。'; }
}

// ═══ 记忆存储 ═══
function memoryPath(uid) { return join(MEMORY_DIR, `${uid}.json`); }

function loadMemory(uid) {
  try { return JSON.parse(readFileSync(memoryPath(uid), 'utf-8')); }
  catch { return []; }
}

function saveMemory(uid, entry) {
  const mem = loadMemory(uid);
  mem.push({ time: Date.now(), ...entry });
  // 只保留最近 50 条记忆
  if (mem.length > 50) mem.splice(0, mem.length - 50);
  writeFileSync(memoryPath(uid), JSON.stringify(mem, null, 2));
}

async function api(url, body) {
  const res = await fetch(NAPCAT + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()).data?.messages || [];
}

// ═══ 启动时预加载历史消息（走 qce-bridge 无限制拉取） ═══
const BRIDGE = 'http://127.0.0.1:3001';

async function preloadHistory(uid) {
  console.log(`  预加载 ${uid} 的完整历史...`);
  try {
    // 走 qce-bridge 全量拉取（count 设大值，一次拿全部）
    const res = await fetch(`${BRIDGE}/get_full_msg_history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerUid: String(uid), chatType: 1, count: 10000 }),
    });
    const data = await res.json();
    const allMsgs = data.messages || [];
    if (allMsgs.length === 0) {
      console.log(`    (无历史)`);
      return;
    }
    console.log(`    ✓ 已载入 ${allMsgs.length} 条完整历史`);
    // 按时间排序后载入上下文
    allMsgs.sort((a, b) => (a.msgTime || 0) - (b.msgTime || 0));
    for (const msg of allMsgs) {
      const isMe = msg.sendType === 2 || msg.sendType === 0;
      const elements = msg.elements || [];
      const text = elements.map(el => {
        if (el.textElement) return el.textElement.content || '';
        if (el.data?.text) return el.data.text;
        return '';
      }).join('').trim();
      if (!text) continue;
      const sender = isMe ? 'me' : (msg.sendNickName || msg.sendMemberName || msg.senderUid || '');
      addContext(uid, sender, text, msg.msgTime || 0);
    }
    if (allMsgs.length > 0) {
      const times = allMsgs.map(m => m.msgTime || 0).filter(Boolean);
    }
    // 预加载的消息全部加文件锁
    for (const msg of allMsgs) {
      tryLock(msg.msgId || `${msg.msgTime}_${msg.msgSeq}`);
    }
    // 用当前时间做边界（不用历史消息时间，避免新消息被误过滤）
    friendLastTime[uid] = Math.floor(Date.now() / 1000);
    // ── AI 压缩历史为摘要（只生成一次，存文件复用） ──
    const summaryFile = join(MEMORY_DIR, `${uid}_summary.txt`);
    if (existsSync(summaryFile)) {
      // 已有摘要，直接加载
      const saved = readFileSync(summaryFile, 'utf-8').trim();
      if (saved) {
        friendContextSummary[uid] = [saved];
        console.log(`    ✓ 已加载历史摘要 (${saved.length} 字)`);
      }
    } else if (USE_CLOUD && allMsgs.length > 0) {
      console.log('    AI 正在生成历史摘要（仅此一次）...');
      try {
        const historyText = allMsgs.slice(0, 300).map(m => {
          const isMe = m.sendType === 2 || m.sendType === 0;
          const name = isMe ? '我' : (m.sendNickName || m.sendMemberName || m.senderUid || '');
          const text = (m.elements || []).map(el => {
            if (el.textElement) return el.textElement.content || '';
            if (el.data?.text) return el.data.text;
            return '';
          }).join('');
          return `[${name}]: ${text}`;
        }).join('\n');

        const compressRes = await fetch(`${DS_BASE}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DS_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'deepseek-v4-pro',
            messages: [{
              role: 'user',
              content: `请将以下两个人的QQ聊天历史压缩为一个简洁摘要。保留：关键话题、重要事件、对方的性格偏好、我们之间的称呼。控制在300字以内。\n\n${historyText}`,
            }],
            max_tokens: 500,
          }),
        });
        const compressData = await compressRes.json();
        const summary = compressData.choices?.[0]?.message?.content?.trim();
        if (summary) {
          friendContextSummary[uid] = [summary];
          writeFileSync(summaryFile, summary, 'utf-8');
          console.log(`    ✓ AI 摘要已生成并保存 (${summary.length} 字)`);
        }
      } catch (e) {
        console.log(`    ⚠ AI 压缩失败，使用截断摘要: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`\r    ✗ 加载失败: ${e.message}（将仅监听新消息）`);
  }
}

async function sendMessage(userId, text) {
  if (!text) return;
  await fetch(NAPCAT + '/send_private_msg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, message: [{ type: 'text', data: { text } }] }),
  });
}

// ═══ 云端回复：DeepSeek API ═══
async function cloudReply(uid, text) {
  const identity = loadIdentity();
  addContext(uid, uid, text, Date.now());

  const memory = loadMemory(uid);
  let memoryBlock = '';
  if (memory.length > 0) {
    // 只取最近 5 条 + 关键词匹配的旧条目
    const recent = memory.slice(-5);
    const keywords = text.split(/[\s，。！？、]+/).filter(w => w.length >= 2);
    const matched = memory.slice(0, -5).filter(m =>
      keywords.some(kw => m.topic?.includes(kw) || m.summary?.includes(kw))
    ).slice(-3);
    const relevant = [...matched, ...recent];
    if (relevant.length > 0) {
      memoryBlock = `\n\n相关记忆：\n${relevant.map(m => `- ${m.topic}: ${m.summary}`).join('\n')}`;
    }
  }

  const prompt = `你是以下身份人格。请对以下消息生成回复（符合人格风格，无需限制长度）。

身份人格：
${identity}${memoryBlock}
${buildContextBlock(uid)}

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
      max_tokens: 2000,
    }),
  });

  if (!aiRes.ok) throw new Error(`API ${aiRes.status}`);
  const data = await aiRes.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ═══ 本地管道：写入 pending-messages.json（含完整上下文） ═══
function localPipe(uid, senderNick, text, msgTime) {
  const identity = loadIdentity();
  const memory = loadMemory(uid);
  const memoryRecent = memory.slice(-5);  // 最近 5 条记忆

  let pending = [];
  try { pending = JSON.parse(readFileSync(PENDING_FILE, 'utf-8')); } catch {}

  pending.push({
    peerUid: String(uid),
    senderNick: senderNick || String(uid),
    text,
    time: msgTime || Math.floor(Date.now() / 1000),
    receivedAt: new Date().toISOString(),
    // 完整上下文（与云端模式一致）
    context: {
      identity,
      memory: memoryRecent,
      historySummary: friendContextSummary[uid] || [],
      recentMessages: (friendContext[uid] || []).map(c => ({ sender: c.sender, text: c.text })),
    },
  });
  writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

async function poll() {
  for (const uid of FRIENDS) {
    try {
      const msgs = await api('/get_friend_msg_history', { user_id: uid, count: 5 });
      if (!msgs || msgs.length === 0) continue;

      for (const msg of msgs) {
        // 时间边界过滤（防止 qce-bridge/OneBot ID 不一致导致历史消息重复处理）
        if (msg.time <= (friendLastTime[uid] || 0)) continue;

        // message_id 去重（文件锁，原子操作）
        const msgId = msg.message_id || msg.real_id || `${msg.time}_${msg.message_seq}`;
        if (!tryLock(msgId)) continue;

        // 自己发的消息 → 记上下文后跳过
        if (Number(msg.sender?.user_id) === MY_ID) {
          const myText = msg.message.map(s => s.type === 'text' ? s.data.text : '').join('').trim();
          if (myText) addContext(uid, 'me', myText, msg.time);
          continue;
        }

        const text = msg.message.map(s => s.type === 'text' ? s.data.text : '').join('').trim();
        if (!text) continue;

        const nick = msg.sender?.nickname || String(msg.sender?.user_id);
        console.log(`[${new Date().toLocaleTimeString()}] ${nick}: ${text.slice(0, 60)}`);

        addContext(uid, nick, text, msg.time);

        // 检查是否已被手动回复
        const alreadyReplied = msgs.some(m =>
          Number(m.sender?.user_id) === MY_ID && m.time >= msg.time
        );
        if (alreadyReplied) {
          console.log(`  ⏭ 已手动回复，跳过`);
          saveMemory(uid, { topic: text.slice(0, 30), summary: '(手动回复)' });
          continue;
        }

        if (!REPLY_WHITELIST.has(uid)) {
          console.log(`  ⚠ ${nick} 不在回复白名单，仅监听`);
          continue;
        }

        // ── 回复入口：云端 / 本地 ──
        if (USE_CLOUD) {
          // 【云端模式】调用 DeepSeek API 自动生成回复
          try {
            const reply = await cloudReply(uid, text);
            if (reply) {
              await sendMessage(uid, reply);
              addContext(uid, 'me', reply, Date.now());
              console.log(`  → 已回复: ${reply.slice(0, 50)}`);
              saveMemory(uid, { topic: text.slice(0, 30), summary: reply.slice(0, 60) });
            }
          } catch (e) {
            console.error(`  ✗ 云端回复失败: ${e.message}`);
          }
        } else {
          // 【本地模式】写入 pending-messages.json，由 Claude Code 消费
          localPipe(uid, nick, text, msg.time);
          console.log(`  → 已写入 pending，等待 Claude Code 处理`);
        }
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
console.log(`  人格: ${cfg.identityFile || 'identity.md'} (每次轮询重新读取)`);
console.log(`  配置: ${existsSync(privateConfig) ? 'private/config.json' : '命令行参数'}`);
console.log('═══════════════════════════════════');

// 预加载每个好友的最近历史
console.log('\n正在加载历史消息...');
for (const uid of FRIENDS) {
  await preloadHistory(uid);
}
console.log('');

poll();
