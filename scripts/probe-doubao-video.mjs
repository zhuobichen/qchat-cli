// 探豆包当前页面的 UI：有哪些功能入口，特别是视频生成。
// 只读：连上去 evaluate 一段 JS，不改任何状态。
const CDP = process.env.DOUBAO_CDP_URL || 'http://127.0.0.1:9333';

const targets = await (await fetch(`${CDP}/json/list`)).json();
const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
console.log(`页面数: ${pages.length}`);
for (const p of pages) {
  console.log(`  - ${p.title} | ${p.url.slice(0, 70)}`);
}

const chat = pages.find((p) => p.url.includes('doubao-chat')) ?? pages[0];
if (!chat) {
  console.log('没有可用的页面');
  process.exit(1);
}
console.log(`\n连到: ${chat.title}`);

const ws = new WebSocket(chat.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
    setTimeout(() => {
      if (pending.has(msgId)) {
        pending.delete(msgId);
        reject(new Error(`${method} 超时`));
      }
    }, 15000);
  });
}

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});

await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const expr = (() => ({
  // 页面上所有可见文字（去重、截断），用来找功能入口
  texts: (() => {
    const set = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (el.children.length > 0) continue;
      const t = (el.textContent || '').trim();
      if (t && t.length <= 12) set.add(t);
    }
    return [...set].slice(0, 120);
  })(),
  // 按钮/可点元素的 aria-label / title
  labels: [...document.querySelectorAll('[aria-label],[title]')]
    .map((e) => e.getAttribute('aria-label') || e.getAttribute('title'))
    .filter(Boolean)
    .slice(0, 60),
  videoHints: [...document.querySelectorAll('body *')]
    .filter((e) => e.children.length === 0 && /视频|video|即梦|生成/.test(e.textContent || ''))
    .map((e) => (e.textContent || '').trim().slice(0, 20))
    .slice(0, 40),
}));

const r = await send('Runtime.evaluate', {
  expression: `JSON.stringify((${expr.toString()})())`,
  returnByValue: true,
});

const data = JSON.parse(r.result.value);
console.log('\n=== 含「视频/generate」的字 ===');
console.log(data.videoHints.length ? data.videoHints.join(' | ') : '(没有)');
console.log('\n=== 可点元素标签 ===');
console.log(data.labels.length ? data.labels.join(' | ') : '(没有)');
console.log('\n=== 页面短文字（前 60）===');
console.log(data.texts.slice(0, 60).join(' / '));

ws.close();
