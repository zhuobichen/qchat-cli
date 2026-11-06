#!/usr/bin/env node
/**
 * qq-bridge —— 把 QQ（NapCat / OneBot 11 WebSocket）接到本地 DSH 会话
 *
 * 能力：
 *   1. 群消息 @ 机器人 → 投递到 DSH 会话（附带最近上下文）
 *   2. 好友申请 → 自动通过（白名单，默认只放行配置里的 autoAcceptFriends）
 *   3. 入群申请 → 默认不自动通过（打印日志）
 *
 * 用法:
 *   node private/qq-bridge.mjs             # 常驻
 *   node private/qq-bridge.mjs --dry       # 只打印事件，不投递/不处理
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'private', 'qq-bridge.config.json');
const STATE_PATH = join(ROOT, 'private', 'qq-bridge.state.json');
const LOG_PATH = join(ROOT, 'output', 'qq-bridge.log');
const DRY = process.argv.includes('--dry');

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

function loadConfig() {
  let conf = {};
  try {
    conf = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    conf = {};
  }
  const token = conf.token
    ?? (() => {
      try {
        const p = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
        return JSON.parse(readFileSync(p, 'utf8')).token ?? '';
      } catch { return ''; }
    })();
  return {
    http: conf.http ?? 'http://127.0.0.1:3000',
    ws: conf.ws ?? 'ws://127.0.0.1:3000/',
    token,
    dshEndpoint: conf.dshEndpoint ?? 'http://127.0.0.1:3080/dsh-agent-supervisor/command',
    dshKey: conf.dshKey ?? process.env.DSH_SUPERVISOR_KEY ?? '',
    sessionId: conf.sessionId,
    groups: Array.isArray(conf.groups) ? conf.groups.map(Number) : [],
    contextMessages: conf.contextMessages ?? 8,
    autoAcceptFriends: Array.isArray(conf.autoAcceptFriends) ? conf.autoAcceptFriends.map(Number) : [],
    autoAcceptAllFriends: conf.autoAcceptAllFriends === true,
    mentionOnly: conf.mentionOnly !== false,
  };
}

const cfg = loadConfig();
const cfgDsh = cfg;

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return { seen: {} }; }
}
function saveState(s) {
  const ids = Object.keys(s.seen);
  if (ids.length > 3000) for (const id of ids.slice(0, ids.length - 3000)) delete s.seen[id];
  try { writeFileSync(STATE_PATH, JSON.stringify(s), 'utf8'); } catch {}
}
const state = loadState();

async function api(action, params = {}) {
  const res = await fetch(`${cfg.http}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

function flatten(msg) {
  if (typeof msg === 'string') return msg;
  if (!Array.isArray(msg)) return String(msg ?? '');
  return msg.map((s) => {
    const t = s.type;
    if (t === 'text') return s.data?.text ?? '';
    if (t === 'image') return '[图片]';
    if (t === 'face') return '[表情]';
    if (t === 'mface') return '[表情包]';
    if (t === 'at') return `@${s.data?.qq === 'all' ? '全体' : s.data?.qq}`;
    if (t === 'record') return '[语音]';
    if (t === 'video') return '[视频]';
    if (t === 'file') return '[文件]';
    if (t === 'reply') return '[回复]';
    if (t === 'json' || t === 'xml') return '[卡片]';
    if (t === 'forward') return '[合并转发]';
    return `[${t}]`;
  }).join('');
}

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function deliverToDsh(text) {
  const res = await fetch(cfgDsh.dshEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfgDsh.dshKey ? { 'x-supervisor-key': cfgDsh.dshKey } : {}) },
    body: JSON.stringify({ op: 'send', sessionId: cfgDsh.sessionId, text }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(JSON.stringify(json).slice(0, 300));
  return json;
}

let selfUin = 0;
let selfName = '';

function isMentioned(event) {
  if (!Array.isArray(event.message)) return false;
  return event.message.some((s) => s.type === 'at' && (String(s.data?.qq) === String(selfUin)
    || (selfName && String(s.data?.text ?? s.data?.name ?? '').replace(/^@/, '').trim() === selfName)));
}

async function handleGroupMessage(event) {
  const gid = Number(event.group_id);
  if (cfg.groups.length && !cfg.groups.includes(gid)) return;

  const key = `g${gid}:${event.message_id}`;
  if (state.seen[key]) return;
  state.seen[key] = 1;
  saveState(state);

  if (String(event.user_id) === String(selfUin)) return;
  if (cfg.mentionOnly && !isMentioned(event)) return;

  const text = [
    '【QQ 群消息 · 需要你处理】',
    `群：${event.group_id}`,
    `时间：${fmtTime(event.time)}`,
    `发送者：${event.sender?.card || event.sender?.nickname || event.user_id}（${event.user_id}）`,
    `内容：${flatten(event.message).slice(0, 800)}`,
    '',
    `如需回话：cd 到 qchat-cli 项目目录，执行  qce send group ${gid} "回复内容"`,
    '（若不需要回复，忽略本条，不要硬回。）',
  ].join('\n');

  if (DRY) { log(`[DRY] 命中 @：${text.split('\n').slice(0, 4).join(' | ')}`); return; }

  try {
    const out = await deliverToDsh(text);
    log(`已投递群 ${gid} 消息 ${event.message_id} → ${out.session_id ?? cfgDsh.sessionId}`);
  } catch (e) {
    log(`投递失败: ${e.message}`);
    delete state.seen[key];
    saveState(state);
  }
}

async function handleFriendRequest(event) {
  const uin = Number(event.user_id);
  const flag = event.flag;
  const allowed = cfg.autoAcceptAllFriends || cfg.autoAcceptFriends.includes(uin);
  log(`好友申请: ${event.user_id} (${event.comment ?? ''}) flag=${flag} → ${allowed ? '通过' : '忽略'}`);
  if (!allowed || DRY) return;
  const r = await api('set_friend_add_request', { flag, approve: true });
  log(`批准结果: ${JSON.stringify(r).slice(0, 200)}`);
  try {
    await deliverToDsh(`【QQ 好友申请已通过】${event.user_id}（${event.comment ?? '无留言'}）已加为好友。`);
  } catch {}
}

function connect() {
  const url = cfg.token ? `${cfg.ws}?access_token=${encodeURIComponent(cfg.token)}` : cfg.ws;
  log(`[pid ${process.pid}] 连接 ${cfg.ws}`);  const ws = new WebSocket(url);

  ws.onopen = () => log('WebSocket 已连接，开始收事件');
  ws.onclose = () => {
    log('WebSocket 断开，10 秒后重连');
    setTimeout(connect, 10000);
  };
  ws.onerror = (e) => log(`WebSocket 错误: ${e?.message ?? 'unknown'}`);
  ws.onmessage = async (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }

    if (data.post_type === 'message' && data.message_type === 'group') {
      await handleGroupMessage(data).catch((e) => log(`处理群消息失败: ${e.message}`));
      return;
    }
    if (data.post_type === 'request' && data.request_type === 'friend') {
      await handleFriendRequest(data).catch((e) => log(`处理好友申请失败: ${e.message}`));
      return;
    }
    if (data.post_type === 'notice' && data.notice_type === 'friend_recall') {
      log(`好友撤回: ${data.user_id} ${data.message_id}`);
    }
  };
}

(async () => {
  const info = await api('get_login_info');
  if (info?.status !== 'ok') {
    log(`登录检查失败: ${JSON.stringify(info).slice(0, 200)}`);
    process.exit(1);
  }
  selfUin = info.data.user_id;
  selfName = String(info.data.nickname ?? '');
  log(`已登录：${selfName}(${selfUin})｜目标会话 ${cfgDsh.sessionId}`);
  connect();
})();
