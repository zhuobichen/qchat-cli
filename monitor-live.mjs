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
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══ PID 文件锁（防止多实例并发，根因4） ═══
const PID_FILE = join(__dirname, 'monitor.pid');

function acquirePidLock() {
  try {
    if (existsSync(PID_FILE)) {
      const oldPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      try {
        // 检查进程是否还存在（信号 0 只检测不杀死）
        process.kill(oldPid, 0);
        console.error(`\n错误: monitor-live 已在运行中 (PID: ${oldPid})`);
        console.error('如需强制重启，请先执行: taskkill /PID ' + oldPid + ' /F');
        console.error('或手动删除文件: ' + PID_FILE + '\n');
        process.exit(1);
      } catch {
        // 进程不存在 → 过期锁文件，覆盖
        console.log('检测到过期的 PID 锁文件，已覆盖');
      }
    }
    writeFileSync(PID_FILE, String(process.pid));
    console.log(`PID 锁已获取 (PID: ${process.pid})\n`);
  } catch (e) {
    console.error('无法获取 PID 锁:', e.message);
    process.exit(1);
  }
}

function releasePidLock() {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (pid === process.pid) {
        unlinkSync(PID_FILE);
      }
    }
  } catch {}
}

// 正常退出时释放锁
process.on('exit', releasePidLock);
process.on('SIGINT', () => { releasePidLock(); process.exit(0); });
process.on('SIGTERM', () => { releasePidLock(); process.exit(0); });
process.on('uncaughtException', (err) => {
  console.error('未捕获异常:', err.message);
  releasePidLock();
  process.exit(1);
});

acquirePidLock();

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
  releasePidLock();
  process.exit(1);
}

const NAPCAT = 'http://127.0.0.1:3000';
const POLL_MS = 3000;
const MAX_REPLY_LENGTH = cfg.maxReplyLength || 100;
const IDENTITY_PATH = join(__dirname, cfg.identityFile || 'identity.md');
const PENDING_FILE = join(__dirname, 'pending-messages.json');
const MEMORY_DIR = join(__dirname, 'private', 'memory');
const LOCK_DIR = join(__dirname, 'private', 'locks');
const PROFILES_DIR = join(__dirname, 'private', 'profiles');

// 确保目录存在
if (!existsSync(MEMORY_DIR)) {
  mkdirSync(MEMORY_DIR, { recursive: true });
}
if (!existsSync(LOCK_DIR)) {
  mkdirSync(LOCK_DIR, { recursive: true });
}
if (!existsSync(PROFILES_DIR)) {
  mkdirSync(PROFILES_DIR, { recursive: true });
}

// ═══ 工具函数 ═══

/**
 * 统一消息 ID 生成（根因3修复）
 *
 * 预加载(qce-bridge)和轮询(OneBot)返回的消息对象字段名不同：
 *   qce-bridge: msgId / msgTime / msgSeq
 *   OneBot:     message_id / time / message_seq / real_id
 *
 * 此函数统一生成消息 ID，确保同一条消息在两种来源下产生相同的锁。
 */
function getMsgId(msg) {
  // message_id 优先级最高（OneBot 标准字段）
  if (msg.message_id) return `msg_${msg.message_id}`;
  // real_id 次之（某些版本的 OneBot）
  if (msg.real_id) return `msg_${msg.real_id}`;
  // qce-bridge 字段
  if (msg.msgId) return `msg_${msg.msgId}`;
  // 兜底：时间戳 + 序号
  const time = msg.time || msg.msgTime || 0;
  const seq = msg.message_seq || msg.msgSeq || 0;
  return `msg_${time}_${seq}`;
}

/**
 * 文件锁（原子操作，防竞态）
 * 使用 writeFileSync + wx flag 实现原子创建
 */
function tryLock(msgId) {
  const lockFile = join(LOCK_DIR, `${msgId}.lock`);
  try {
    writeFileSync(lockFile, String(Date.now()), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理过期锁文件（启动时执行一次）
 * 删除超过 1 小时的锁，防止磁盘堆积
 */
function cleanOldLocks() {
  try {
    const files = readdirSync(LOCK_DIR);
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 小时
    let cleaned = 0;
    for (const f of files) {
      const filePath = join(LOCK_DIR, f);
      try {
        const stat = statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          unlinkSync(filePath);
          cleaned++;
        }
      } catch {}
    }
    if (cleaned > 0) console.log(`  ✓ 清理了 ${cleaned} 个过期锁文件`);
  } catch {}
}

cleanOldLocks();

// ═══ 状态变量 ═══

// 预加载后设的时间边界：只处理比预加载消息更新的消息
let friendMaxTime = {};
// 本地管道模式内存去重：同一消息 ID 不重复写入 pending
const pipedMsgIds = new Set();

const USE_CLOUD = !!cfg.deepseekApiKey;
const MODE = USE_CLOUD ? '云端 DeepSeek API' : '本地管道 (pending-messages.json → Claude Code)';
const DS_API_KEY = cfg.deepseekApiKey || '';
const DS_BASE = 'https://api.deepseek.com';

let friendContext = {};        // 最近原始消息
let friendContextSummary = {}; // 更早对话的压缩摘要

const MAX_RAW_CONTEXT = cfg.maxRawContext || 20;
const MAX_CONTEXT_MSG_LENGTH = cfg.maxContextMsgLength || 100;

function updateContextSummary(uid, oldMsg) {
  if (!friendContextSummary[uid]) friendContextSummary[uid] = [];
  friendContextSummary[uid].push(`[${oldMsg.sender}] ${oldMsg.text.slice(0, 50)}`);
  if (friendContextSummary[uid].length > 30) friendContextSummary[uid].shift();
}

function addContext(uid, sender, text, time) {
  // "我"的消息过长则截断，避免上下文被自己的长回复撑爆
  if (sender === 'me' && text.length > MAX_CONTEXT_MSG_LENGTH) {
    text = text.slice(0, MAX_CONTEXT_MSG_LENGTH);
  }
  if (!friendContext[uid]) friendContext[uid] = [];
  friendContext[uid].push({ sender, text, time: time || Date.now() });
  while (friendContext[uid].length > MAX_RAW_CONTEXT) {
    const old = friendContext[uid].shift();
    updateContextSummary(uid, old);
  }
}

function buildContextBlock(uid) {
  let block = '';
  const summary = friendContextSummary[uid];
  if (summary?.length > 0) {
    const text = summary.length === 1 && summary[0].length > 50
      ? summary[0]
      : summary.join('\n');
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

/** 加载用户画像（如果存在） */
function loadProfile(uid) {
  const profileFile = join(PROFILES_DIR, `${uid}.md`);
  try {
    if (existsSync(profileFile)) {
      return readFileSync(profileFile, 'utf-8');
    }
  } catch {}
  return '';
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

/**
 * 预加载结果：返回该好友历史消息的最大时间戳
 * 用于设置精确的时间边界（而非 Date.now()），减少边界处漏消息
 */
async function preloadHistory(uid) {
  console.log(`  预加载 ${uid} 的完整历史...`);
  let maxMsgTime = 0;
  try {
    const res = await fetch(`${BRIDGE}/get_full_msg_history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerUid: String(uid), chatType: 1, count: 10000 }),
    });
    const data = await res.json();
    const allMsgs = data.messages || [];
    if (allMsgs.length === 0) {
      console.log(`    (无历史)`);
      return maxMsgTime;
    }
    console.log(`    ✓ 已载入 ${allMsgs.length} 条完整历史`);
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
    // 记录预加载消息的最大时间戳
    const times = allMsgs.map(m => m.msgTime || 0).filter(Boolean);
    if (times.length > 0) maxMsgTime = Math.max(...times);

    // 预加载的消息全部用统一 ID 加文件锁（根因3修复）
    for (const msg of allMsgs) {
      const lockId = getMsgId(msg);
      tryLock(lockId);
    }

    // ── AI 压缩历史为摘要 ──
    const summaryFile = join(MEMORY_DIR, `${uid}_summary.txt`);
    if (existsSync(summaryFile)) {
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
  return maxMsgTime;
}

async function sendMessage(userId, text) {
  if (!text) return;
  const truncated = text.length > MAX_REPLY_LENGTH ? text.slice(0, MAX_REPLY_LENGTH) : text;
  await fetch(NAPCAT + '/send_private_msg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, message: [{ type: 'text', data: { text: truncated } }] }),
  });
}

// ═══ 云端回复：DeepSeek API ═══
async function cloudReply(uid, text) {
  const identity = loadIdentity();
  addContext(uid, uid, text, Date.now());

  const memory = loadMemory(uid);
  let memoryBlock = '';
  if (memory.length > 0) {
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

  const profile = loadProfile(uid);
  const profileBlock = profile ? `\n\n对方画像：\n${profile}` : '';

  const prompt = `你是以下身份人格。请对以下消息生成回复（符合人格风格，无需限制长度）。

身份人格：
${identity}${profileBlock}${memoryBlock}
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

// ═══ 本地管道：写入 pending-messages.json（根因1修复：pipedMsgIds 去重） ═══
function localPipe(uid, senderNick, text, msgTime, msgId) {
  // 内存去重：同一个消息 ID 不重复写入 pending
  if (pipedMsgIds.has(msgId)) return;
  pipedMsgIds.add(msgId);

  const identity = loadIdentity();
  const memory = loadMemory(uid);
  const memoryRecent = memory.slice(-5);

  let pending = [];
  try { pending = JSON.parse(readFileSync(PENDING_FILE, 'utf-8')); } catch {}

  pending.push({
    msgId,  // 附带消息 ID，方便消费者去重
    peerUid: String(uid),
    senderNick: senderNick || String(uid),
    text,
    time: msgTime || Math.floor(Date.now() / 1000),
    receivedAt: new Date().toISOString(),
    context: {
      maxReplyLength: MAX_REPLY_LENGTH,
      identity,
      profile: loadProfile(uid),
      memory: memoryRecent,
      historySummary: friendContextSummary[uid] || [],
      recentMessages: (friendContext[uid] || []).map(c => ({ sender: c.sender, text: c.text })),
    },
  });
  writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2));
}

// ═══ 主轮询 ═══
async function poll() {
  for (const uid of FRIENDS) {
    try {
      const msgs = await api('/get_friend_msg_history', { user_id: uid, count: 5 });
      if (!msgs || msgs.length === 0) continue;

      for (const msg of msgs) {
        // message_id 去重（统一 ID，原子文件锁）
        const msgId = getMsgId(msg);
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

        // 时间边界：用 < 而非 <=，避免跳过与最后一条历史消息时间戳相同的新消息
        if (msg.time < (friendMaxTime[uid] || 0)) {
          console.log(`  ⏭ 历史消息，跳过`);
          continue;
        }

        // 当前批次内检测：是否已手动回复
        const alreadyRepliedInBatch = msgs.some(m =>
          Number(m.sender?.user_id) === MY_ID && m.time >= msg.time
        );
        if (alreadyRepliedInBatch) {
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
          // 本地管道模式（根因1修复：pipedMsgIds 防止重复写入）
          localPipe(uid, nick, text, msg.time, msgId);
          console.log(`  → 已写入 pending，等待 Claude Code 处理`);
        }
      }
    } catch (e) {
      // 忽略单次轮询错误，继续下一轮
    }
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

// 预加载每个好友的完整历史，记录边界时间
console.log('\n正在加载历史消息...');
for (const uid of FRIENDS) {
  friendMaxTime[uid] = await preloadHistory(uid);
}
console.log('');

poll();
