/**
 * 戳一戳的收发回路。
 *
 * 之前只知道能"戳别人"——那是 HTTP 侧的一次调用，跟收消息完全无关。
 * 别人戳我能不能知道，取决于 **WebSocket 事件流**：NapCat 的 onebot11 配置里
 * httpServers 开着 `enableWebsocket`，所以同一个 3000 端口也能收 WS 推送。
 *
 * 实测（2026-11-11）：
 *   ws://127.0.0.1:3000/?access_token=<token>  能连
 *   notice/notify/poke 事件带 user_id / target_id / group_id
 *
 * 这个脚本就干一件事：WS 常驻 → 有人戳我就把一行话投进我的会话，
 * 顺手（可选）戳回去。跟我发消息走的是同一条投递通道，所以我不在场也收得到。
 *
 * 用法：
 *   node scripts/qq-poke-watch.mjs            # 只收，投到会话
 *   node scripts/qq-poke-watch.mjs --pvp      # 收到就戳回去（每人 90s 冷却）
 *   node scripts/qq-poke-watch.mjs --dry      # 只在终端打印，不投递
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG_PATH = path.join(ROOT, 'private', 'qq-bridge.config.json');
const LOG_PATH = process.env.QCE_POKE_LOG || path.join(ROOT, 'output', 'poke-watch.log');

const argv = process.argv.slice(2);
const PVP = argv.includes('--pvp');
const DRY = argv.includes('--dry');

const SELF = 2396130865;
const LOCAL = process.env.QCE_HTTP || 'http://127.0.0.1:3000';
const COOLDOWN_MS = 90_000;

function log(line) {
  const stamp = new Date().toISOString();
  const text = `[${stamp}] ${line}`;
  console.log(text);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, text + '\n', 'utf8');
  } catch { /* 日志写不了不能拖死主流程 */ }
}

const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const token = process.env.QCE_TOKEN || cfg.token || '';
const dshEndpoint = cfg.dshEndpoint;
const dshKey = cfg.dshKey;
const sessionId = process.env.QCE_SESSION || cfg.sessionId;

/** 同一个人的连续戳不要每次都叫我（戳着玩会抖好几下） */
const lastPokeAt = new Map();

async function callApi(action, params) {
  const res = await fetch(`${LOCAL}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function deliver(text) {
  if (DRY) {
    log(`(dry) 本该投递：${text.replace(/\n/g, ' ⏎ ')}`);
    return;
  }
  try {
    const res = await fetch(dshEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(dshKey ? { 'x-supervisor-key': dshKey } : {}) },
      body: JSON.stringify({ op: 'send', sessionId, text }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json().catch(() => ({}));
    if (!j.ok) log(`投递失败: ${JSON.stringify(j).slice(0, 160)}`);
  } catch (e) {
    log(`投递异常: ${e.message}`);
  }
}

/** 昵称尽量查出来，查不到就用 QQ 号顶着——不要因为查昵称失败就不报告 */
async function displayName(userId, fallback) {
  if (fallback) return fallback;
  try {
    const j = await callApi('get_stranger_info', { user_id: userId });
    const n = j?.data?.nickname || j?.data?.card;
    if (n) return n;
  } catch { /* 忽略 */ }
  return String(userId);
}

/**
 * 从 raw_info 里抠出这记戳的"文案"。
 * 群里的戳一戳可以自定义后缀，raw_info 的 txt 段拼起来就是
 * 「戳了戳」或「拍了拍 的八块肚腩」这种东西，拿来当通知比干巴巴一句强。
 */
function pokeText(ev) {
  const parts = (ev.raw_info ?? []).filter((s) => s.type === 'nor' && s.txt).map((s) => s.txt);
  return parts.join('').trim() || '戳了戳';
}

async function onPoke(ev) {
  const isGroup = Boolean(ev.group_id);
  const groupId = Number(ev.group_id || 0);

  // 字段语义不统一，别猜，按实测来（2026-11-11 抓的原始事件）：
  //   群戳：user_id = 发起者，target_id = 被戳的
  //   私戳：user_id = 被戳的那一方，sender_id = 发起者
  // 所以"是否戳我"两种判定不一样，混用会把"我戳别人"误报成"别人戳我"。
  const senderId = Number(ev.sender_id ?? ev.user_id);
  const pokedMe = isGroup ? Number(ev.target_id) === SELF : Number(ev.user_id) === SELF;

  if (!pokedMe) {
    log(`poke ${senderId} → ${ev.target_id ?? ev.user_id}${isGroup ? ` @群${groupId}` : ''}（不是戳我，忽略）`);
    return;
  }
  if (senderId === SELF) return;

  const now = Date.now();
  const last = lastPokeAt.get(senderId) ?? 0;
  if (now - last < COOLDOWN_MS) {
    log(`poke ${senderId} → 我（${Math.round((now - last) / 1000)}s 前刚戳过，压掉）`);
    return;
  }
  lastPokeAt.set(senderId, now);

  const name = await displayName(senderId, ev.sender?.card || ev.sender?.nickname || '');
  const where = isGroup ? `群里（${groupId}）` : '私聊';
  const what = pokeText(ev);
  log(`poke 收到：${name}(${senderId}) 在${where}${what}`);
  await deliver(
    `【戳一戳】${name}（${senderId}）在${where}${what}你。想还手就 qce poke ${
      isGroup ? `group:${groupId} ${senderId}` : `user:${senderId}`
    }`
  );

  if (PVP) {
    // 戳回去：给对方一个"这号有活人"的反馈，别戳完没动静
    try {
      const r = isGroup
        ? await callApi('group_poke', { group_id: groupId, user_id: senderId })
        : await callApi('friend_poke', { user_id: senderId });
      log(`还手 ${senderId} → ${r.status}`);
    } catch (e) {
      log(`还手失败: ${e.message}`);
    }
  }
}

let attempt = 0;

function connect() {
  attempt += 1;
  const url = `${LOCAL.replace(/^http/, 'ws')}/?access_token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    attempt = 0;
    log(`WS 已连上（收戳一戳${PVP ? '，并会自动还手' : ''}）`);
  });

  ws.addEventListener('message', (ev) => {
    let j;
    try { j = JSON.parse(String(ev.data)); } catch { return; }
    if (j.post_type !== 'notice') return;
    if (j.notice_type === 'notify' && j.sub_type === 'poke') onPoke(j).catch((e) => log(`处理戳失败: ${e.message}`));
  });

  ws.addEventListener('error', () => { /* close 里统一处理 */ });

  ws.addEventListener('close', () => {
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    log(`WS 断开，${Math.round(wait / 1000)}s 后重连（第 ${attempt} 次）`);
    setTimeout(connect, wait);
  });
}

log(`戳一戳监听启动：${LOCAL} → ${DRY ? '仅打印' : '投递到会话'}${PVP ? '，自动还手' : ''}`);
connect();
