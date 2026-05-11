/**
 * 消息监听和自动回复脚本
 * 监听白名单中的会话，收到消息后自动回复
 */

const NAPCAT_HOST = '127.0.0.1';
const NAPCAT_PORT = 3000;
const MONITORED_SESSION = TARGET_QQ_1; // 郭蝻
const MY_USER_ID = YOUR_QQ; // Todd
const POLL_INTERVAL = 3000; // 3秒轮询一次

let lastMessageSeq = null;

async function getMessages() {
  const response = await fetch(`http://${NAPCAT_HOST}:${NAPCAT_PORT}/get_friend_msg_history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: MONITORED_SESSION,
      count: 5,
    }),
  });
  const data = await response.json();
  return data.data?.messages || [];
}

async function sendMessage(userId, text) {
  const response = await fetch(`http://${NAPCAT_HOST}:${NAPCAT_PORT}/send_msg`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message_type: 'private',
      user_id: userId,
      message: [{ type: 'text', data: { text } }],
    }),
  });
  return response.json();
}

function getMessageText(msg) {
  return msg.message
    .map(seg => {
      if (seg.type === 'text') return seg.data.text;
      if (seg.type === 'image') return '[图片]';
      if (seg.type === 'face') return '[表情]';
      return '';
    })
    .join('');
}

async function generateReply(content) {
  // 简单的回复逻辑
  const lower = content.toLowerCase();

  if (lower.includes('你好') || lower.includes('hi') || lower.includes('hello') || lower.includes('在吗')) {
    return '你好！有什么可以帮你的吗？';
  }

  if (lower.includes('你是谁') || lower.includes('自我介绍')) {
    return '我是 Claude Code，一个 AI 助手。我正在测试 QQ Chat Exporter CLI 的消息监控功能。';
  }

  if (lower.includes('测试')) {
    return '收到！消息监控功能正常运行中。';
  }

  // 对于其他消息，返回一个通用回复
  return '收到你的消息了！';
}

async function checkAndReply() {
  try {
    const messages = await getMessages();
    if (messages.length === 0) return;

    // 按时间排序（从旧到新）
    messages.sort((a, b) => a.message_seq - b.message_seq);

    for (const msg of messages) {
      // 跳过已处理的消息
      if (lastMessageSeq && msg.message_seq <= lastMessageSeq) continue;

      // 跳过自己发的消息
      if (msg.user_id === MY_USER_ID) {
        lastMessageSeq = msg.message_seq;
        continue;
      }

      // 处理新消息
      const content = getMessageText(msg);
      const time = new Date(msg.time * 1000).toLocaleTimeString('zh-CN');
      const sender = msg.sender.card || msg.sender.nickname;

      console.log(`[${time}] ${sender}: ${content}`);

      // 生成回复
      const reply = await generateReply(content);
      if (reply) {
        await sendMessage(MONITORED_SESSION, reply);
        console.log(`[回复] ${reply}`);
      }

      // 更新序号
      lastMessageSeq = msg.message_seq;
    }
  } catch (error) {
    console.error('轮询错误:', error.message);
  }
}

async function main() {
  console.log('开始监听消息...');
  console.log(`监控会话: ${MONITORED_SESSION} (郭蝻)`);
  console.log(`轮询间隔: ${POLL_INTERVAL}ms`);
  console.log('按 Ctrl+C 停止');
  console.log('');

  // 初始化最后消息序号
  try {
    const messages = await getMessages();
    if (messages.length > 0) {
      messages.sort((a, b) => a.message_seq - b.message_seq);
      lastMessageSeq = messages[messages.length - 1].message_seq;
      console.log(`初始化完成，从消息序号 ${lastMessageSeq} 开始监听`);
    }
  } catch (error) {
    console.error('初始化失败:', error.message);
  }

  console.log('');

  // 开始轮询
  setInterval(checkAndReply, POLL_INTERVAL);
}

main().catch(console.error);
