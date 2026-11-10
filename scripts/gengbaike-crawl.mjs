/**
 * 抓梗百科网站的公开词条。
 *
 * 为什么不用转写视频：视频要下音频、要 whisper、同音字必错
 * （实测把「滑动变祖器」听成「梁子变组器」）。而这个站上就是整理好的文字，
 * 一条词条几 KB，抓一条不到一秒。
 *
 * 站点证书有问题（HTTPS 握手失败），curl 必须带 -k。这是已知且可接受的：
 * 抓的是公开词条，不涉及登录、不提交任何东西。
 *
 * 用法：
 *   node scripts/gengbaike-crawl.mjs --from 5500 --to 5561 --out .gb-out.jsonl
 *   node scripts/gengbaike-crawl.mjs --from 5400 --to 5561 --out .gb-out.jsonl --delay 400
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const FROM = Number(arg('--from', '5500'));
const TO = Number(arg('--to', '5561'));
const OUT = arg('--out', '.gb-out.jsonl');
const DELAY = Number(arg('--delay', '350'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchHtml(url) {
  // -k: 站点证书坏了；--compressed: 不压缩的话 body 是空的
  return execFileSync(
    'curl',
    ['-sk', '-m', '25', '--compressed', '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', url],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000 },
  );
}

function stripHtml(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&nbsp;/g, ' ');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return s.replace(/\s+/g, ' ').trim();
}

/** 从词条页里抠出：标题 / 释义 / 标签 / 更新时间 */
function parseDoc(html) {
  const t = /<title>([\s\S]*?)<\/title>/i.exec(html);
  let title = t ? stripHtml(t[1]) : '';
  title = title.replace(/是什么梗.*$/, '').replace(/-梗百科.*$/, '').trim();
  if (!title) return null;

  const text = stripHtml(html);
  // 释义：标题之后到「上一篇」之间那段
  const start = text.indexOf(title, text.indexOf('编辑'));
  const end = text.indexOf('上一篇');
  let meaning = start > 0 && end > start ? text.slice(start + title.length, end) : '';
  meaning = meaning.replace(/^\s*编辑\s*/, '').trim();
  // 去掉痕迹性的计数数字
  meaning = meaning.replace(/^\d+\s+/, '').trim();
  if (meaning.length > 800) meaning = meaning.slice(0, 800);

  const upd = /更新时间：\s*(\d{4}-\d{2}-\d{2})/.exec(text);
  const tagBlock = /标签\s+([\s\S]{0,120}?)词条信息/.exec(text);
  const tags = tagBlock
    ? tagBlock[1]
        .split(/\s+/)
        .map((x) => x.trim())
        .filter((x) => x && x !== title)
    : [];

  return {
    term: title,
    meaning,
    tags: [...new Set(tags)].slice(0, 6),
    updatedAt: upd ? upd[1] : '',
  };
}

async function main() {
  // 断点续抓：先把已经抓到的 id 读出来，跳过。
  // 之前是「全抓完再一次性写文件」，中途被打断就全丢——实测丢过一整轮 3000 条。
  const done = new Set();
  const existing = [];
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        if (d?.id) done.add(d.id);
        existing.push(line);
      } catch {
        /* 坏行跳过 */
      }
    }
    if (done.size) console.log(`续抓：已有 ${done.size} 条，跳过`);
  }
  const out = fs.openSync(OUT, 'a');
  const writeLine = (obj) => fs.writeSync(out, JSON.stringify(obj) + '\n');

  let ok = 0;
  let skip = 0;
  for (let id = FROM; id <= TO; id += 1) {
    if (done.has(id)) continue;
    const url = `https://gengbaike.cn/doc-view-${id}.html`;
    try {
      const html = fetchHtml(url);
      const d = parseDoc(html);
      if (!d || !d.meaning) {
        skip += 1;
      } else {
        writeLine({ id, ...d, url });
        ok += 1;
        if (ok % 20 === 0) console.log(`  已抓 ${ok} 条（当前 id=${id}）`);
      }
    } catch (e) {
      skip += 1;
      console.log(`  id=${id} 失败: ${String(e.message).slice(0, 60)}`);
    }
    await sleep(DELAY);
  }
  fs.closeSync(out);
  console.log(`\n完成：本轮成功 ${ok} 条，跳过 ${skip} 条 → ${OUT}`);
}

main().catch((e) => {
  console.error('出错:', e.message);
  process.exit(1);
});
