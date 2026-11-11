/**
 * 摸一下 NapCat 的 WebSocket 事件流到底能不能收到「戳一戳」这类 notice。
 * 只跑 25 秒，把收到的事件原样打印；不发任何东西。
 *
 * 用法：node scripts/poke-probe.mjs [秒数]
 */
const TOKEN = process.env.QCE_TOKEN || '75277e324f924d73255a5d0b77543e035af0e509bc7d7559';
const URL = `ws://127.0.0.1:3000/?access_token=${TOKEN}`;
const secs = Number(process.argv[2] ?? 25);

const ws = new WebSocket(URL);
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

ws.addEventListener('open', () => {
  console.log(`[${stamp()}] ws 已连上 ${URL.replace(TOKEN, '***')}`);
  // OneBot 的 WS 事件是服务端推送，不需要订阅；这里只看能不能收到
});

ws.addEventListener('message', (ev) => {
  let j;
  try { j = JSON.parse(String(ev.data)); } catch { return; }
  if (j.post_type === 'meta_event') {
    console.log(`[${stamp()}] meta ${j.meta_event_type}`);
    return;
  }
  const who = j.sender?.card || j.sender?.nickname || j.user_id;
  const what = (j.message ?? [])
    .map((s) => (s.type === 'text' ? s.data.text : `[${s.type}]`))
    .join('')
    .slice(0, 50);
  console.log(`[${stamp()}] ${j.post_type}/${j.notice_type ?? ''}/${j.sub_type ?? ''} from=${who} target=${j.target_id ?? '-'} ${what}`);
});

ws.addEventListener('error', (e) => console.log(`[${stamp()}] ws 错误: ${e.message || e.type}`));
ws.addEventListener('close', (e) => console.log(`[${stamp()}] ws 关闭 code=${e.code} reason=${e.reason}`));

setTimeout(() => {
  console.log(`[${stamp()}] 结束，${secs}s 内没有新事件就说明这条链路没通`);
  process.exit(0);
}, secs * 1000);
