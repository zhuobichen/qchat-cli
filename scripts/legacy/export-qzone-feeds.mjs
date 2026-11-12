/**
 * QZone 说说导出为 HTML（含评论）
 * 用法: npx tsx export-qzone-feeds.mjs [QQ号]
 */
import { QZoneClient } from './src/core/qzone-client.ts';
import { writeFileSync } from 'fs';
import { join } from 'path';

const qzone = new QZoneClient();
if (!qzone.loadCookie()) { console.log('未登录 QZone'); process.exit(1); }

const TARGET = parseInt(process.argv[2] || String(qzone.uin));
const OUT_DIR = join(import.meta.dirname, 'output');

// ── 拉取全部说说 ──
console.log('正在拉取全部说说...');
const all = [];
let pos = 0, emptyCount = 0;
while (emptyCount < 3) {
  const batch = await qzone.getFeeds(TARGET, pos, 20);
  if (!batch || batch.length === 0) { emptyCount++; pos += 20; continue; }
  emptyCount = 0;
  all.push(...batch);
  pos += batch.length;
  process.stdout.write(`\r  已拉取 ${all.length} 条...`);
  await new Promise(r => setTimeout(r, 200));
}

// ── 拉取每条说说的评论 ──
console.log(`\n\n共 ${all.length} 条说说，拉取评论中...`);
for (let i = 0; i < all.length; i++) {
  const f = all[i];
  try {
    const comments = await qzone.getMessageComments(TARGET, f.tid, 0, 100);
    f._comments = comments || [];
  } catch { f._comments = []; }
  process.stdout.write(`\r  评论 ${i + 1}/${all.length}`);
  await new Promise(r => setTimeout(r, 200));
}

// ── 生成 HTML ──
console.log('\n\n生成 HTML...');

const esc = (s) => {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

const fmtTime = (ts) => {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  return d.toLocaleString('zh-CN');
};

const formatContent = (text, extra) => {
  let html = esc(text || '')
    .replace(/@\{uin:(\d+),nick:([^,}]+)[^}]*\}/g, '@$2')
    .replace(/\[em\]e(\d+)\[\/em\]/g, (_, id) => `<span class="emoji">[${id}]</span>`)
    .replace(/\[img\](.*?)\[\/img\]/g, '<img src="$1" class="comment-img" loading="lazy">')
    .replace(/\n/g, '<br>');

  // Comment pic field (image attachment)
  if (extra?.pic) {
    const pics = Array.isArray(extra.pic) ? extra.pic : [extra.pic];
    for (const p of pics) {
      const url = p.url || p.hd_url || p.big_url || p.curlikekey || '';
      if (url) html += `<br><img src="${esc(url)}" class="comment-img" loading="lazy">`;
    }
  }
  return html;
};

let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QQ 空间说说导出 — ${esc(all[0]?.name || '')} (${TARGET})</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; background: #f5f5f5; color: #333; }
  .header { background: linear-gradient(135deg, #12b7f5, #0d8ed9); color: white; padding: 30px 20px; text-align: center; }
  .header h1 { font-size: 24px; margin-bottom: 8px; }
  .header p { opacity: 0.85; font-size: 14px; }
  .container { max-width: 680px; margin: 0 auto; padding: 20px 15px; }
  .feed { background: white; border-radius: 10px; margin-bottom: 20px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .feed-body { padding: 20px 20px 15px; }
  .feed-time { font-size: 12px; color: #999; margin-bottom: 8px; }
  .feed-content { font-size: 15px; line-height: 1.7; word-break: break-word; }
  .feed-meta { padding: 10px 20px; font-size: 12px; color: #999; border-top: 1px solid #f0f0f0; display: flex; gap: 15px; }
  .comments { border-top: 1px solid #f0f0f0; background: #fafbfc; padding: 0; }
  .comment { padding: 12px 20px; border-bottom: 1px solid #f0f0f0; }
  .comment:last-child { border-bottom: none; }
  .comment-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
  .comment-name { font-size: 13px; font-weight: 600; color: #0d8ed9; }
  .comment-time { font-size: 11px; color: #bbb; }
  .comment-text { font-size: 14px; line-height: 1.6; word-break: break-word; }
  .reply { padding: 8px 12px 8px 36px; border-top: 1px solid #f5f5f5; }
  .reply .comment-name { font-size: 12px; }
  .reply .comment-text { font-size: 13px; }
  .empty-comments { padding: 15px 20px; font-size: 13px; color: #ccc; text-align: center; }
  .footer { text-align: center; padding: 30px; font-size: 12px; color: #bbb; }
  .source { font-size: 11px; color: #aaa; margin-left: 8px; }
  .comment-img { max-width: 200px; max-height: 200px; border-radius: 6px; margin-top: 6px; }
  .emoji { font-size: 11px; color: #bbb; }
</style>
</head>
<body>
<div class="header">
  <h1>${esc(all[0]?.name || '')} 的空间说说</h1>
  <p>共 ${all.length} 条说说 · 导出时间 ${new Date().toLocaleString('zh-CN')}</p>
</div>
<div class="container">
`;

for (const f of all) {
  const time = f.createTime || fmtTime(f.created_time);
  const source = f.source_name ? ` · <span class="source">${esc(f.source_name)}</span>` : '';
  const comments = f._comments || [];

  html += `<div class="feed">`;
  html += `<div class="feed-body">`;
  html += `<div class="feed-time">${esc(time)}${source}</div>`;
  html += `<div class="feed-content">${formatContent(f.content || '')}</div>`;
  html += `</div>`;
  html += `<div class="feed-meta">👍 ${f.rt_sum || 0} 评论 💬 ${comments.length}</div>`;

  if (comments.length > 0) {
    html += `<div class="comments">`;
    for (const c of comments) {
      const cname = c.poster?.name || c.nickname || c.name || '';
      const ctime = fmtTime(c.postTime || c.createTime);
      html += `<div class="comment">`;
      html += `<div class="comment-head"><span class="comment-name">${esc(cname)}</span><span class="comment-time">${ctime}</span></div>`;
      html += `<div class="comment-text">${formatContent(c.content || '', c)}</div>`;

      // Replies
      const replies = c.replies || [];
      for (const r of replies) {
        const rname = r.poster?.name || r.nickname || '';
        const rtime = fmtTime(r.postTime || r.createTime);
        html += `<div class="reply">`;
        html += `<div class="comment-head"><span class="comment-name">${esc(rname)}</span><span class="comment-time">${rtime}</span></div>`;
        html += `<div class="comment-text">${formatContent(r.content || '', r)}</div>`;
        html += `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="empty-comments">暂无评论</div>`;
  }
  html += `</div>\n`;
}

html += `</div>
<div class="footer">由 qchat-cli 生成 · ${new Date().toLocaleString('zh-CN')}</div>
</body>
</html>`;

const outPath = join(OUT_DIR, `qzone-feeds-${TARGET}.html`);
const { mkdirSync, existsSync } = await import('fs');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(outPath, html, 'utf-8');

console.log(`已导出: ${outPath}`);
console.log(`说说: ${all.length} 条`);
const totalComments = all.reduce((s, f) => s + (f._comments?.length || 0), 0);
console.log(`评论: ${totalComments} 条`);
