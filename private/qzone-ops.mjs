/**
 * QZone 运维脚本集合 — 从 private/config.json 读取目标
 *
 * 用法:
 *   npx tsx private/qzone-ops.mjs feeds <targetName>    查看全部说说
 *   npx tsx private/qzone-ops.mjs check <targetName>    检查点赞状态
 *   npx tsx private/qzone-ops.mjs like <targetName>     检查+补赞
 *   npx tsx private/qzone-ops.mjs export <targetName>   导出 HTML（含评论）
 */
import { QZoneClient } from '../src/core/qzone-client.ts';
import { loadConfig } from './load-config.mjs';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const TARGETS = cfg.qzoneTargets || {};

const cmd = process.argv[2];
const targetName = process.argv[3];

if (!cmd || !targetName) {
  console.log('用法: npx tsx private/qzone-ops.mjs <feeds|check|like|export> <targetName>');
  console.log(`\n可用目标: ${Object.keys(TARGETS).join(', ') || '(无，请在 config.json 的 qzoneTargets 中配置)'}`);
  process.exit(1);
}

const targetUin = TARGETS[targetName];
if (!targetUin) {
  console.error(`未知目标 "${targetName}"，请在 config.json 的 qzoneTargets 中配置`);
  process.exit(1);
}

const qzone = new QZoneClient();
if (!qzone.loadCookie()) {
  console.log('未登录 QZone，正在扫码...');
  await qzone.qrLogin();
}

// ── 拉取全部说说 ──
async function fetchAll(uin) {
  const all = [];
  let pos = 0, emptyCount = 0;
  while (emptyCount < 3) {
    const batch = await qzone.getFeeds(uin, pos, 20);
    if (!batch || batch.length === 0) { emptyCount++; pos += 20; continue; }
    emptyCount = 0;
    all.push(...batch);
    pos += batch.length;
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

// ── 检查点赞 ──
async function checkLike(tid) {
  const unikey = `http://user.qzone.qq.com/${targetUin}/mood/${tid}`;
  const lcUrl = 'https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/user/qz_opcnt2';
  const lcu = new URL(lcUrl);
  lcu.searchParams.set('g_tk', String(qzone['session'].gtk2));
  lcu.searchParams.set('unikey', unikey);
  lcu.searchParams.set('fupdate', '1');
  const res = await fetch(lcu.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': `https://user.qzone.qq.com/${qzone.uin}`,
      'Cookie': qzone['session'].cookie,
    },
  });
  const text = await res.text();
  const data = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
  return data?.data?.[0]?.current?.likedata?.ilike;
}

// ── 执行命令 ──
console.log(`目标: ${targetName} (${targetUin})\n`);
const feeds = await fetchAll(targetUin);
console.log(`共 ${feeds.length} 条说说\n`);

if (cmd === 'feeds') {
  for (const f of feeds) {
    console.log(`[${f.createTime}] ${(f.content||'').slice(0, 80)}`);
  }
} else if (cmd === 'check') {
  let liked = 0, unliked = 0;
  for (const f of feeds) {
    const ilike = await checkLike(f.tid);
    const tag = ilike === 1 ? '✅' : '❌';
    if (ilike === 1) liked++; else unliked++;
    console.log(`${tag} [${f.createTime}] ${(f.content||'').slice(0, 50)}`);
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`\n已赞: ${liked}  未赞: ${unliked}`);
} else if (cmd === 'like') {
  let liked = 0, fixed = 0, failed = 0;
  for (const f of feeds) {
    const year = (f.createTime || '').slice(0, 4);
    const ilike = await checkLike(f.tid);
    if (ilike === 1) {
      liked++;
      console.log(`✅ [${f.createTime}]`);
    } else if (year === '2017') {
      failed++;
      console.log(`🚫 [${f.createTime}] (老帖限制)`);
    } else {
      await qzone.like(targetUin, f.tid);
      fixed++;
      console.log(`🔧 [${f.createTime}] → 已补赞`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n已赞: ${liked}  补赞: ${fixed}  失败: ${failed}`);
} else if (cmd === 'export') {
  // HTML 导出
  for (let i = 0; i < feeds.length; i++) {
    try {
      feeds[i]._comments = await qzone.getMessageComments(targetUin, feeds[i].tid, 0, 100);
    } catch { feeds[i]._comments = []; }
    process.stdout.write(`\r  评论 ${i + 1}/${feeds.length}`);
    await new Promise(r => setTimeout(r, 200));
  }

  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmtTime = ts => ts ? new Date(typeof ts === 'number' ? ts*1000 : ts).toLocaleString('zh-CN') : '';

  let html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${esc(targetName)} 空间说说</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,"Microsoft YaHei",sans-serif;background:#f5f5f5;color:#333}
.header{background:linear-gradient(135deg,#12b7f5,#0d8ed9);color:#fff;padding:30px 20px;text-align:center}
.header h1{font-size:24px;margin-bottom:8px}.header p{opacity:.85;font-size:14px}
.container{max-width:680px;margin:0 auto;padding:20px 15px}
.feed{background:#fff;border-radius:10px;margin-bottom:20px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.feed-body{padding:20px 20px 15px}.feed-time{font-size:12px;color:#999;margin-bottom:8px}
.feed-content{font-size:15px;line-height:1.7;word-break:break-word}
.feed-meta{padding:10px 20px;font-size:12px;color:#999;border-top:1px solid #f0f0f0;display:flex;gap:15px}
.comments{border-top:1px solid #f0f0f0;background:#fafbfc}
.comment{padding:12px 20px;border-bottom:1px solid #f0f0f0}
.comment:last-child{border-bottom:none}
.comment-head{display:flex;align-items:baseline;gap:10px;margin-bottom:4px}
.comment-name{font-size:13px;font-weight:600;color:#0d8ed9}
.comment-time{font-size:11px;color:#bbb}
.comment-text{font-size:14px;line-height:1.6;word-break:break-word}
.reply{padding:8px 12px 8px 36px;border-top:1px solid #f5f5f5}
.reply .comment-name{font-size:12px}.reply .comment-text{font-size:13px}
.empty-comments{padding:15px 20px;font-size:13px;color:#ccc;text-align:center}
.footer{text-align:center;padding:30px;font-size:12px;color:#bbb}
.source{font-size:11px;color:#aaa;margin-left:8px}</style></head><body>
<div class="header"><h1>${esc(targetName)} 的空间说说</h1><p>共 ${feeds.length} 条 · ${new Date().toLocaleString('zh-CN')}</p></div>
<div class="container">`;

  for (const f of feeds) {
    const time = f.createTime || '';
    const source = f.source_name ? ` · <span class="source">${esc(f.source_name)}</span>` : '';
    html += `<div class="feed"><div class="feed-body"><div class="feed-time">${esc(time)}${source}</div>`;
    html += `<div class="feed-content">${esc(f.content||'')
      .replace(/@\{uin:(\d+),nick:([^,}]+)[^}]*\}/g,'@$2')
      .replace(/\n/g,'<br>')}</div></div>`;
    const comments = f._comments || [];
    html += `<div class="feed-meta">👍 ${f.rt_sum||0} 评论 💬 ${comments.length}</div>`;
    if (comments.length > 0) {
      html += `<div class="comments">`;
      for (const c of comments) {
        html += `<div class="comment"><div class="comment-head"><span class="comment-name">${esc(c.poster?.name||'')}</span><span class="comment-time">${fmtTime(c.postTime)}</span></div>`;
        html += `<div class="comment-text">${esc(c.content||'').replace(/\n/g,'<br>')}</div>`;
        for (const r of c.replies||[]) {
          html += `<div class="reply"><div class="comment-head"><span class="comment-name">${esc(r.poster?.name||'')}</span><span class="comment-time">${fmtTime(r.postTime)}</span></div>`;
          html += `<div class="comment-text">${esc(r.content||'').replace(/\n/g,'<br>')}</div></div>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    } else { html += `<div class="empty-comments">暂无评论</div>`; }
    html += `</div>\n`;
  }
  html += `</div><div class="footer">由 qchat-cli 生成 · ${new Date().toLocaleString('zh-CN')}</div></body></html>`;

  const outDir = join(__dirname, '..', 'output');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `qzone-feeds-${targetUin}.html`);
  writeFileSync(outPath, html, 'utf-8');
  const totalCmt = feeds.reduce((s,f) => s + (f._comments?.length||0), 0);
  console.log(`\n已导出: ${outPath}`);
  console.log(`说说: ${feeds.length} 条  评论: ${totalCmt} 条`);
}
