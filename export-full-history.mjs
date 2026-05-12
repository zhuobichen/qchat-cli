/**
 * 通过 qce-bridge 导出完整聊天记录
 * 用法: node export-full-history.mjs [QQ号] [chatType]
 */
import { writeFileSync } from 'fs';

const BRIDGE = 'http://127.0.0.1:3001';
if (!process.argv[2]) { console.log('用法: npx tsx export-full-history.mjs <QQ号> [chatType]'); process.exit(1); }
const PEER_UID = process.argv[2];
const CHAT_TYPE = parseInt(process.argv[3]) || 1; // 1=私聊 2=群聊
const OUTPUT = `E:/CodeProject/qchat-cli/output/full-history-${PEER_UID}.md`;

async function fetchAllMessages(peerUid, chatType) {
  const allMessages = [];
  let cursor = null;
  let hasMore = true;
  let batchCount = 0;
  const maxBatches = 500;

  while (hasMore && batchCount < maxBatches) {
    batchCount++;
    process.stdout.write(`\r  获取第 ${batchCount} 批...`);

    const res = await fetch(`${BRIDGE}/get_full_msg_history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        peerUid,
        chatType,
        count: 5000,
        startMsgId: cursor,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`\n  错误: ${data.error}`);
      break;
    }

    const msgs = data.messages || [];
    allMessages.push(...msgs);
    hasMore = data.hasMore;
    cursor = msgs.length > 0 ? msgs[0].msgId : null;

    if (msgs.length === 0) break;
  }

  return allMessages;
}

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

function extractText(msg) {
  return (msg.elements || []).map(el => {
    if (el.textElement?.content) return el.textElement.content;
    if (el.picElement) return '[图片]';
    if (el.pttElement) return '[语音]';
    if (el.videoElement) return '[视频]';
    if (el.fileElement) return '[文件]';
    if (el.faceElement) return '[表情]';
    if (el.marketFaceElement) return '[动态表情]';
    if (el.replyElement) return '[回复]';
    if (el.arkElement) {
      try {
        const ark = JSON.parse(el.arkElement.bytesData);
        return `[分享: ${ark.meta?.detail_1?.desc || ark.prompt || ''}]`;
      } catch { return '[分享]'; }
    }
    if (el.grayTipElement) return '[系统提示]';
    if (el.multiForwardMsgElement) return '[合并转发]';
    return '';
  }).filter(Boolean).join('');
}

function buildMarkdown(messages, peerUid, chatType) {
  const sorted = [...messages].sort((a, b) => a.msgTime - b.msgTime);

  // Deduplicate
  const seen = new Set();
  const unique = sorted.filter(m => {
    if (seen.has(m.msgId)) return false;
    seen.add(m.msgId);
    return true;
  });

  const lines = [];
  const title = chatType === 1 ? `与 ${peerUid} 的私聊记录` : `群 ${peerUid} 的聊天记录`;
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> 导出时间: ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`> 消息总数: ${unique.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  let lastDate = '';
  for (const msg of unique) {
    const date = new Date(msg.msgTime * 1000).toLocaleDateString('zh-CN');
    if (date !== lastDate) {
      lastDate = date;
      lines.push(`## ${date}`);
      lines.push('');
    }

    const time = formatTime(msg.msgTime);
    const sender = msg.sendNickName || msg.sendMemberName || msg.senderUid;
    const text = extractText(msg);

    if (text.trim()) {
      lines.push(`**${sender}** (${time})`);
      lines.push('');
      lines.push(text);
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function main() {
  console.log(`开始导出聊天记录...`);
  console.log(`  peerUid: ${PEER_UID}`);
  console.log(`  chatType: ${CHAT_TYPE === 1 ? '私聊' : '群聊'}`);
  console.log('');

  const messages = await fetchAllMessages(PEER_UID, CHAT_TYPE);
  console.log(`\n  共获取 ${messages.length} 条消息`);

  console.log('  生成 Markdown...');
  const md = buildMarkdown(messages, PEER_UID, CHAT_TYPE);

  writeFileSync(OUTPUT, md, 'utf-8');
  console.log(`  已保存到: ${OUTPUT}`);
  console.log(`  文件大小: ${(Buffer.byteLength(md, 'utf-8') / 1024).toFixed(1)} KB`);
}

main().catch(e => {
  console.error('导出失败:', e.message);
  process.exit(1);
});
