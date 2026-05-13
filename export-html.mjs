/**
 * 通过 qce-bridge 导出完整聊天记录为 HTML（含图片）
 * 用法: node export-html.mjs [QQ号] [chatType]
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename } from 'path';

const BRIDGE = 'http://127.0.0.1:3001';
if (!process.argv[2]) { console.log('用法: npx tsx export-html.mjs <QQ号> [chatType]'); process.exit(1); }
const PEER_UID = process.argv[2];
const CHAT_TYPE = parseInt(process.argv[3]) || 1;
const OUT_DIR = './output';
const OUT_FILE = join(OUT_DIR, `full-history-${PEER_UID}.html`);

async function fetchAllMessages(peerUid, chatType) {
  const all = [];
  let cursor = null, hasMore = true, batchCount = 0;
  while (hasMore && batchCount < 500) {
    batchCount++;
    process.stdout.write(`\r  获取第 ${batchCount} 批...`);
    const res = await fetch(`${BRIDGE}/get_full_msg_history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerUid, chatType, count: 5000, startMsgId: cursor }),
    });
    const data = await res.json();
    if (!data.ok) { console.error(`\n  错误: ${data.error}`); break; }
    const msgs = data.messages || [];
    all.push(...msgs);
    hasMore = data.hasMore;
    cursor = msgs.length > 0 ? msgs[0].msgId : null;
    if (msgs.length === 0) break;
  }
  return all;
}

function imageToDataUri(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const buf = readFileSync(filePath);
    const ext = basename(filePath).split('.').pop()?.toLowerCase() || 'jpg';
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[ext] || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

function renderMessageContent(msg) {
  const parts = [];
  for (const el of (msg.elements || [])) {
    if (el.textElement?.content) {
      parts.push(escapeHtml(el.textElement.content));
    } else if (el.picElement) {
      const src = el.picElement.sourcePath;
      const dataUri = imageToDataUri(src);
      if (dataUri) {
        parts.push(`<img src="${dataUri}" class="msg-img" loading="lazy" title="${basename(src || '')}">`);
      } else {
        parts.push(`<div class="img-placeholder">[图片: ${basename(src || '未知')}]</div>`);
      }
    } else if (el.faceElement) {
      parts.push('<span class="face">[表情]</span>');
    } else if (el.marketFaceElement) {
      parts.push('<span class="face">[动态表情]</span>');
    } else if (el.pttElement) {
      parts.push('<span class="media">[语音]</span>');
    } else if (el.videoElement) {
      parts.push('<span class="media">[视频]</span>');
    } else if (el.fileElement) {
      parts.push('<span class="media">[文件]</span>');
    } else if (el.replyElement) {
      parts.push('<span class="reply">[回复]</span>');
    } else if (el.arkElement) {
      try {
        const ark = JSON.parse(el.arkElement.bytesData);
        parts.push(`<span class="share">[分享: ${escapeHtml(ark.meta?.detail_1?.desc || '')}]</span>`);
      } catch { parts.push('<span class="share">[分享]</span>'); }
    } else if (el.grayTipElement) {
      parts.push('<span class="system">[系统提示]</span>');
    }
  }
  return parts.join('');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts) {
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

function buildHtml(messages, peerUid) {
  const sorted = [...messages].sort((a, b) => a.msgTime - b.msgTime);
  const seen = new Set();
  const unique = sorted.filter(m => { if (seen.has(m.msgId)) return false; seen.add(m.msgId); return true; });

  const title = `与 ${peerUid} 的私聊记录`;
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; background: #f5f5f5; color: #333; }
.header { position: sticky; top: 0; z-index: 100; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 20px 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
.header h1 { font-size: 20px; margin-bottom: 4px; }
.header .meta { font-size: 13px; opacity: 0.85; }
.container { max-width: 800px; margin: 0 auto; padding: 20px; }
.date-sep { text-align: center; margin: 24px 0 16px; }
.date-sep span { background: #e0e0e0; color: #666; padding: 4px 16px; border-radius: 20px; font-size: 13px; }
.msg-block { margin-bottom: 12px; }
.msg-info { font-size: 12px; color: #999; margin-bottom: 4px; }
.msg-info .name { font-weight: 600; color: #555; }
.msg-body { display: inline-block; max-width: 75%; padding: 10px 14px; border-radius: 12px; line-height: 1.6; word-break: break-word; font-size: 15px; }
.msg-from-me .msg-body { background: #d0e6ff; margin-left: auto; display: block; }
.msg-from-other .msg-body { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
.msg-img { max-width: 300px; max-height: 300px; border-radius: 8px; cursor: pointer; display: block; transition: transform 0.2s; }
.msg-img:hover { transform: scale(1.02); }
.img-placeholder { background: #eee; padding: 20px; border-radius: 8px; color: #999; font-size: 13px; text-align: center; }
.face, .media, .reply, .share, .system { color: #999; font-size: 13px; }
/* Lightbox */
.lightbox { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 999; justify-content: center; align-items: center; cursor: pointer; }
.lightbox img { max-width: 95vw; max-height: 95vh; object-fit: contain; }
.lightbox.active { display: flex; }
</style>
</head>
<body>
<div class="header">
  <h1>${title}</h1>
  <div class="meta">导出时间: ${new Date().toLocaleString('zh-CN')} | 消息数: ${unique.length}</div>
</div>
<div class="container">
`;

  let lastDate = '';
  for (const msg of unique) {
    const date = new Date(msg.msgTime * 1000).toLocaleDateString('zh-CN');
    if (date !== lastDate) {
      lastDate = date;
      html += `<div class="date-sep"><span>${date}</span></div>\n`;
    }

    const isMe = msg.sendType === 2;
    const cls = isMe ? 'msg-from-me' : 'msg-from-other';
    const sender = msg.sendNickName || msg.sendMemberName || msg.senderUid;
    const time = formatTime(msg.msgTime);
    const content = renderMessageContent(msg);

    if (content.trim()) {
      html += `<div class="msg-block ${cls}">
  <div class="msg-info"><span class="name">${escapeHtml(sender)}</span> ${time}</div>
  <div class="msg-body">${content}</div>
</div>\n`;
    }
  }

  html += `</div>
<div class="lightbox" id="lightbox" onclick="this.classList.remove('active')"><img id="lightbox-img"></div>
<script>
document.querySelectorAll('.msg-img').forEach(img => {
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    const lb = document.getElementById('lightbox');
    document.getElementById('lightbox-img').src = img.src;
    lb.classList.add('active');
  });
});
</script>
</body>
</html>`;

  return html;
}

async function main() {
  console.log(`导出 HTML（含图片）...`);
  console.log(`  peerUid: ${PEER_UID}`);
  console.log('');

  mkdirSync(OUT_DIR, { recursive: true });

  const messages = await fetchAllMessages(PEER_UID, CHAT_TYPE);
  console.log(`\n  共获取 ${messages.length} 条消息`);

  console.log('  生成 HTML（处理图片...）');
  const html = buildHtml(messages, PEER_UID);

  writeFileSync(OUT_FILE, html, 'utf-8');
  const sizeKB = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
  const sizeMB = (sizeKB / 1024).toFixed(1);
  console.log(`  已保存到: ${OUT_FILE}`);
  console.log(`  文件大小: ${sizeKB > 1024 ? sizeMB + ' MB' : sizeKB + ' KB'}`);
}

main().catch(e => { console.error('导出失败:', e.message); process.exit(1); });
