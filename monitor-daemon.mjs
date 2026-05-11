/**
 * 消息监听守护进程
 * 监听消息并写入日志文件，供 Claude 读取
 */

import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'fs';

const NAPCAT_HOST = '127.0.0.1';
const NAPCAT_PORT = 3000;
const MONITORED_SESSION = TARGET_QQ_1; // 郭蝻
const MY_USER_ID = YOUR_QQ; // Todd
const POLL_INTERVAL = 3000;
const LOG_FILE = 'E:/CodeProject/qchat-cli/messages.log';
const STATE_FILE = 'E:/CodeProject/qchat-cli/monitor-state.json';

let lastMessageSeq = null;

// 加载状态
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      const state = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
      lastMessageSeq = state.lastMessageSeq;
    }
  } catch (e) {}
}

// 保存状态
function saveState() {
  writeFileSync(STATE_FILE, JSON.stringify({ lastMessageSeq }));
}

// 写入日志
function logMessage(msg, content) {
  const time = new Date(msg.time * 1000).toLocaleString('zh-CN');
  const sender = msg.sender.card || msg.sender.nickname;
  const line = `[${time}] ${sender}(${msg.user_id}): ${content}\n`;
  appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
}

async function getMessages() {
  const response = await fetch(`http://${NAPCAT_HOST}:${NAPCAT_PORT}/get_friend_msg_history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: MONITORED_SESSION, count: 10 }),
  });
  const data = await response.json();
  return data.data?.messages || [];
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

async function checkMessages() {
  try {
    const messages = await getMessages();
    if (messages.length === 0) return;

    messages.sort((a, b) => a.message_seq - b.message_seq);

    for (const msg of messages) {
      if (lastMessageSeq && msg.message_seq <= lastMessageSeq) continue;
      if (msg.user_id === MY_USER_ID) {
        lastMessageSeq = msg.message_seq;
        continue;
      }

      const content = getMessageText(msg);
      logMessage(msg, content);
      lastMessageSeq = msg.message_seq;
      saveState();
    }
  } catch (error) {
    // 静默处理错误
  }
}

// 初始化日志文件
writeFileSync(LOG_FILE, `=== 消息监听日志 ===\n监控会话: ${MONITORED_SESSION} (郭蝻)\n启动时间: ${new Date().toLocaleString('zh-CN')}\n\n`);

loadState();
console.log('消息监听守护进程已启动');
console.log(`日志文件: ${LOG_FILE}`);
console.log(`轮询间隔: ${POLL_INTERVAL}ms`);

setInterval(checkMessages, POLL_INTERVAL);
checkMessages();
