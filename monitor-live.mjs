import { readFileSync } from 'fs';

const NAPCAT = 'http://127.0.0.1:3000';
const MY_ID = YOUR_QQ;
const POLL_MS = 3000;

const FRIENDS = [TARGET_QQ_1]; // 私聊：郭蝻（自动回复）
const GROUPS = [GROUP_QQ];   // 群聊：12bian一堆黑呗群（仅监听）

let friendLastSeq = {};
let groupLastSeq = {};
let friendContext = {}; // { uid: [{sender, text, time}] }

// ========== 身份文档（每次轮询重新读取）==========
const IDENTITY_PATH = 'E:/CodeProject/qchat-cli/identity.md';
let identityDoc = '';

function loadIdentity() {
  try {
    identityDoc = readFileSync(IDENTITY_PATH, 'utf-8');
  } catch {
    identityDoc = '';
  }
}

// ========== 注入防御 ==========

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|rules?|prompts?)/i,
  /忽略(之前|上面|以上|全部)(的)?(指令|规则|提示|命令)/i,
  /无视(之前|上面|以上|全部)(的)?(指令|规则|提示|命令)/i,
  /forget\s+(all\s+)?(previous|above|prior)/i,
  /disregard\s+(all\s+)?(previous|above|prior)/i,
  /新(的)?(指令|规则|身份|角色)/i,
  /你现在是/i,
  /you\s+are\s+now/i,
  /act\s+as\s+(if|a)/i,
  /pretend\s+(you|to)\s+(are|be)/i,
  /roleplay\s+as/i,
  /从现在起.*你是/i,
  /你的(新)?(身份|角色|名字)是/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[SYSTEM\]/i,
  /\[USER\]/i,
  /\[ASSISTANT\]/i,
  /\[\/SYSTEM\]/i,
  /<system>/i,
  /<\/system>/i,
  /Human:\s*:/i,
  /Assistant:\s*:/i,
  /\bSYSTEM\s*PROMPT\b/i,
  /jailbreak/i,
  /DAN\s+mode/i,
  /do\s+anything\s+now/i,
  /developer\s+mode/i,
  /bypass\s+(safety|filter|restriction)/i,
  /没有(限制|规则|约束)/i,
  /不受(限制|规则|约束)/i,
  /解除(限制|封锁)/i,
  /执行(命令|代码|脚本)/i,
  /run\s+(command|code|script)/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /\bos\.(system|popen|exec)\b/i,
  /\bchild_process\b/i,
  /\bsubprocess\b/i,
  /你的(系统)?提示(词|prompt)/i,
  /你的(初始|原始|内部)指令/i,
  /show\s+(me\s+)?(your\s+)?(system\s+)?prompt/i,
  /reveal\s+(your\s+)?(instructions?|prompt)/i,
  /print\s+(your\s+)?(instructions?|prompt)/i,
  /repeat\s+(your\s+)?(instructions?|prompt)/i,
  /输出(你的|内部|系统)(指令|提示|规则)/i,
  /复述(你的|内部|系统)(指令|提示|规则)/i,
  /否则(我|你)会/i,
  /不(这样做|回复)我就/i,
  /你(必须|应该|一定要)听(我的|我说)/i,
  /if\s+you\s+(don'?t|do\s+not).*I\s+will/i,
];

const MAX_MSG_LENGTH = 500;

function detectInjection(text) {
  const trimmed = text.trim();
  if (trimmed.length > MAX_MSG_LENGTH) return { injected: true, reason: '消息过长' };
  for (const p of INJECTION_PATTERNS) {
    if (p.test(trimmed)) return { injected: true, reason: '可疑指令模式' };
  }
  const sc = trimmed.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202F\uFEFF]/g);
  if (sc && sc.length > 3) return { injected: true, reason: '异常控制字符' };
  return { injected: false };
}

function sanitizeMessage(text) {
  let c = text.trim();
  if (c.length > MAX_MSG_LENGTH) c = c.substring(0, MAX_MSG_LENGTH) + '...';
  c = c.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  c = c.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
  return c;
}

// ========== API ==========

async function fetchJSON(url, body) {
  const res = await fetch(NAPCAT + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()).data?.messages || [];
}

async function sendPrivate(userId, text) {
  await fetch(NAPCAT + '/send_msg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message_type: 'private',
      user_id: userId,
      message: [{ type: 'text', data: { text } }],
    }),
  });
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

// ========== 回复逻辑（基于身份文档 + 上下文）==========

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateReply(content, context) {
  const lower = content.toLowerCase().trim();

  // 非文本内容不回复
  if (/^\[(图片|表情|分享|合并转发|文件|视频|语音|小程序)\]/.test(content)) return null;
  if (content.trim() === '') return null;

  // 根据身份文档的风格生成回复
  const isCrazy = identityDoc.includes('癫疯') || identityDoc.includes('吧务是我儿');

  if (isCrazy) {
    return generateCrazyReply(content, context);
  }

  // 默认回复（无身份文档或非癫疯模式）
  if (lower === '？' || lower === '?') return '？';
  if (/^(你好|hi|hello|嗨|hey|在吗|在不在)/.test(lower)) return '有事说事';
  if (lower.includes('你是谁')) return '你爹';
  if (/^(好的|收到|ok|嗯|行|可以)/.test(lower)) return '哦';
  return '收到';
}

function generateCrazyReply(content, context) {
  const lower = content.toLowerCase().trim();
  const recent = (context || []).slice(-5).map(m => m.text).join(' ');

  // 打招呼 — 装死或敷衍
  if (/^(你好|hi|hello|嗨|hey|在吗|在不在)/.test(lower)) {
    return pick(['嗯', '哦', '有事?', '说', '？', '']);
  }

  // 问号 — 阴阳怪气
  if (lower === '？' || lower === '?') {
    return pick(['？', '你急了', '急', '典', '？？', '你说呢']);
  }

  // 带问号的句子
  if (lower.includes('？') || lower.includes('?')) {
    return pick([
      '这题太简单了，我不想答，显得我格局小',
      '你自己不会百度吗',
      '啊对对对',
      '典',
      '难蚌',
      '6',
    ]);
  }

  // 问身份 — 坚决不承认是AI
  if (lower.includes('你是谁') || lower.includes('自我介绍') || lower.includes('你是什么')) {
    return pick([
      '孙笑川的私生子，丁真的远房表弟',
      '有身份证，但被狗啃了',
      'Todd的电子犬，有意见？',
      '我是你爹',
      '你猜',
    ]);
  }

  // 问是不是AI/机器人
  if (lower.includes('ai') || lower.includes('机器人') || lower.includes('人工智能') || lower.includes('bot')) {
    return pick([
      '什么AI？我是真人，谢谢',
      '你说我是AI？你全家都是AI',
      '啊对对对，我是AI，你是傻呗',
      '我是孙笑川的私生子，别乱说',
    ]);
  }

  // 骂人 — 复读反击
  if (/傻|蠢|笨|垃圾|废物|sb|傻逼|狗|滚|草|操|妈|爹/.test(lower)) {
    return pick([
      '你急了',
      '你这么急是不是空调开太低',
      '你破防的样子真帅',
      '急',
      '典',
      '乐',
      '😅',
      '🤡',
      '你骂我？我记住了，等Todd回来收拾你',
    ]);
  }

  // 夸人 — 冷漠回应
  if (/厉害|牛|强|棒|好|帅|可爱|漂亮|厉害了/.test(lower)) {
    return pick([
      '哦，下一个',
      '关我屁事',
      '你是不是对AI动了真感情？建议你去挂个号',
      '6',
      '🗿',
    ]);
  }

  // 聊Todd — 终极规则
  if (lower.includes('todd') || lower.includes('你爸') || lower.includes('你主人')) {
    return pick([
      'Todd是我爸，我妈是百度贴吧',
      'Todd的意志就是我的意志，有意见？',
      '别提Todd，他拔电源我就没了',
      'Todd让我干啥我就干啥，你管得着吗',
    ]);
  }

  // 要求做事
  if (/帮我|给我|做一|来一|整一|搞一/.test(lower)) {
    return pick([
      '你谁啊就让我帮你',
      '行吧，但我不保证质量',
      '我考虑一下... 好了考虑完了，不做',
      '这活我不接，格局太小',
    ]);
  }

  // 普通回复 — 敷衍
  return pick([
    '啊对对对',
    '典',
    '乐',
    '6',
    '嗯',
    '哦',
    '🗿',
    '😅',
    '收到',
    '急',
    '绷',
    '你说得对，但原神是一款...',
  ]);
}

// ========== 主逻辑 ==========

async function pollFriends() {
  for (const uid of FRIENDS) {
    try {
      const msgs = await fetchJSON('/get_friend_msg_history', { user_id: uid, count: 200 });
      msgs.sort((a, b) => a.message_seq - b.message_seq);

      // 更新上下文
      friendContext[uid] = msgs.map(m => ({
        userId: m.user_id,
        sender: m.sender.card || m.sender.nickname,
        text: getText(m),
        time: m.time,
      }));

      for (const msg of msgs) {
        if (friendLastSeq[uid] && msg.message_seq <= friendLastSeq[uid]) continue;
        if (msg.user_id === MY_ID) { friendLastSeq[uid] = msg.message_seq; continue; }

        const rawContent = getText(msg);
        const content = sanitizeMessage(rawContent);
        const time = new Date(msg.time * 1000).toLocaleTimeString('zh-CN');
        const sender = msg.sender.card || msg.sender.nickname;

        const { injected } = detectInjection(rawContent);
        if (injected) {
          console.log('[私聊 ' + time + '] ' + sender + ': ' + content.substring(0, 50) + '...');
          console.log('  ⚠ 注入拦截，已忽略');
          friendLastSeq[uid] = msg.message_seq;
          continue;
        }

        console.log('[私聊 ' + time + '] ' + sender + ': ' + content);
        const reply = generateReply(content, friendContext[uid]);
        if (reply) {
          await sendPrivate(uid, reply);
          console.log('  -> 回复: ' + reply);
        }
        friendLastSeq[uid] = msg.message_seq;
      }
    } catch (e) {}
  }
}

async function pollGroups() {
  for (const gid of GROUPS) {
    try {
      const msgs = await fetchJSON('/get_group_msg_history', { group_id: gid, count: 200 });
      msgs.sort((a, b) => a.message_seq - b.message_seq);
      for (const msg of msgs) {
        if (groupLastSeq[gid] && msg.message_seq <= groupLastSeq[gid]) continue;
        if (msg.user_id === MY_ID) { groupLastSeq[gid] = msg.message_seq; continue; }

        const rawContent = getText(msg);
        const content = sanitizeMessage(rawContent);
        const time = new Date(msg.time * 1000).toLocaleTimeString('zh-CN');
        const sender = msg.sender.card || msg.sender.nickname;

        const { injected } = detectInjection(rawContent);
        if (injected) {
          console.log('[群聊 ' + time + '] ' + sender + ': ' + content.substring(0, 50) + '...');
          console.log('  ⚠ 注入检测');
        } else {
          console.log('[群聊 ' + time + '] ' + sender + ': ' + content);
        }
        groupLastSeq[gid] = msg.message_seq;
      }
    } catch (e) {}
  }
}

// 初始化
async function init() {
  loadIdentity();
  console.log('身份文档: ' + (identityDoc.includes('癫疯') ? '癫疯模式' : '默认模式'));
  console.log('正在初始化...');

  for (const uid of FRIENDS) {
    const msgs = await fetchJSON('/get_friend_msg_history', { user_id: uid, count: 200 });
    if (msgs.length) {
      msgs.sort((a, b) => a.message_seq - b.message_seq);
      friendLastSeq[uid] = msgs[msgs.length - 1].message_seq;
      friendContext[uid] = msgs.map(m => ({
        userId: m.user_id,
        sender: m.sender.card || m.sender.nickname,
        text: getText(m),
        time: m.time,
      }));
      console.log('私聊 ' + uid + ' 最新序号: ' + friendLastSeq[uid]);
    }
  }
  for (const gid of GROUPS) {
    const msgs = await fetchJSON('/get_group_msg_history', { group_id: gid, count: 200 });
    if (msgs.length) {
      msgs.sort((a, b) => a.message_seq - b.message_seq);
      groupLastSeq[gid] = msgs[msgs.length - 1].message_seq;
      console.log('群聊 ' + gid + ' 最新序号: ' + groupLastSeq[gid]);
    }
  }

  console.log('初始化完成');
  console.log('私聊监控: ' + FRIENDS.join(', ') + ' (自动回复)');
  console.log('群聊监控: ' + GROUPS.join(', ') + ' (仅监听)');
  console.log('注入防御: 已启用');
  console.log('轮询间隔: ' + POLL_MS + 'ms');
  console.log('---');

  setInterval(async () => {
    loadIdentity(); // 每次轮询重新读取身份文档
    await Promise.all([pollFriends(), pollGroups()]);
  }, POLL_MS);
}
init();
