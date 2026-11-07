// 细探：找到「变视频」等视频相关入口，看它们是什么元素、能点什么。
const CDP = process.env.DOUBAO_CDP_URL || 'http://127.0.0.1:9333';
const targets = await (await fetch(`${CDP}/json/list`)).json();
const chat = targets.find((t) => t.type === 'page' && t.url.includes('doubao-chat')) ?? targets.find((t) => t.type === 'page');
if (!chat) process.exit(1);

const ws = new WebSocket(chat.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
    setTimeout(() => { if (pending.has(msgId)) { pending.delete(msgId); reject(new Error('timeout')); } }, 15000);
  });
}
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

const descriptor = (el) => {
  const path = [];
  let cur = el;
  for (let i = 0; i < 4 && cur; i += 1) {
    path.push(cur.tagName.toLowerCase() + (cur.getAttribute?.('class') ? '.' + String(cur.getAttribute('class')).split(/\s+/).slice(0, 2).join('.') : ''));
    cur = cur.parentElement;
  }
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    aria: el.getAttribute('aria-label') || '',
    title: el.getAttribute('title') || '',
    cls: String(el.getAttribute('class') || '').slice(0, 60),
    path,
    text: (el.textContent || '').trim().slice(0, 20),
  };
};

const expr = `
(() => {
  const out = { videoEntries: [], modeTabs: [], mediaButtons: [] };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const t = (el.textContent || '').trim();
    if (!t || t.length > 20) continue;
    if (!/视频|video/i.test(t)) continue;
    // 只取最内层
    if ([...el.children].some(c => /视频|video/i.test((c.textContent||'').trim()))) continue;
    const key = t + '|' + el.tagName;
    if (seen.has(key)) continue;
    seen.add(key);
    out.videoEntries.push(${descriptor.toString()}(el));
    if (out.videoEntries.length >= 12) break;
  }
  // 顶部/底部的模式切换（图像生成、图片与视频 等）
  for (const el of document.querySelectorAll('[role="tab"],[role="radio"],button')) {
    const t = (el.textContent || '').trim();
    if (t && t.length <= 8) out.modeTabs.push({ text: t, role: el.getAttribute('role') || '', cls: String(el.getAttribute('class')||'').slice(0,50) });
  }
  out.modeTabs = out.modeTabs.slice(0, 30);
  return JSON.stringify(out);
})()
`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const data = JSON.parse(r.result.value);
console.log('=== 视频相关元素 ===');
for (const v of data.videoEntries) {
  console.log(`  「${v.text}」 <${v.tag}> role=${v.role} aria=${v.aria} title=${v.title}`);
  console.log(`     path: ${v.path.join(' < ')}`);
}
console.log('\n=== 模式/标签按钮 ===');
console.log(data.modeTabs.map((x) => `「${x.text}」${x.role ? '(' + x.role + ')' : ''}`).join(' '));
ws.close();
