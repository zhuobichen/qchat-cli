#!/usr/bin/env node
/**
 * qq-watch —— 定时监视 QQ 新增消息（私聊 + 群聊）
 *
 * 与 qq-bridge.mjs 的分工：
 *   qq-bridge : WebSocket 实时事件，只处理「群里 @ 我」和「好友申请」→ 低延迟
 *   qq-watch  : HTTP 轮询，覆盖全部新增消息（私聊、群里没 @ 我的、服务号）→ 补漏 + 汇总
 *
 * 投递策略（省 token）：
 *   私聊 或 群里 @我  → 立即投递一条（带最近 6 条上下文）
 *   全部消息         → 按 peer 合并后**立即投递**（不做摘要延迟）
 *
 * 可靠性（v2）：
 *   - 状态原子写入 + 崩溃恢复：断电/强杀不会丢水位，重启从上次位置继续
 *   - 投递失败自动重试（指数退避 + 抖动），超过次数进 DLQ 死信文件，不丢消息
 *   - 熔断：连续失败过多时暂停投递一段时间，避免打死下游
 *   - 关机久的消息不会被静默丢弃：水位之前的按"回补"策略重新评估
 *
 * 用法:
 *   node private/qq-watch.mjs            # 常驻
 *   node private/qq-watch.mjs --once     # 只跑一轮（调试）
 *   node private/qq-watch.mjs --status   # 打印状态后退出
 *   node private/qq-watch.mjs --replay-dlq  # 重放死信队列
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadState, saveStateAtomic, advanceCursor, isNewMessage, summarize, emptyState,
} from './lib/watch-state.mjs';
import { nowLine, looksOffline } from './time-sense.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'private', 'qq-watch.config.json');
// 状态文件路径可用环境变量覆盖。为什么要它：这台机器上有个看不见的旧实例
// （没有 node 进程，但日志每秒在写）占着原来的 state 和 log，
// 起新实例必须让它走自己的文件，否则两边互相踩、消息重复推。
const STATE_PATH = process.env.QCE_WATCH_STATE || join(ROOT, 'private', 'qq-watch.state.json');
const INBOX = join(ROOT, 'output', 'qq-inbox.jsonl');
const LOG_PATH = process.env.QCE_WATCH_LOG || join(ROOT, 'output', 'qq-watch.log');
const DLQ_PATH = join(ROOT, 'output', 'qq-watch.dlq.jsonl');
const QUEUE_SCRIPT = join(ROOT, 'scripts', 'qce-queue.mjs');

const ONCE = process.argv.includes('--once');
const STATUS = process.argv.includes('--status');
const REPLAY_DLQ = process.argv.includes('--replay-dlq');

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

function loadConfig() {
  let raw = {};
  try { raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch {}

  let token = raw.token;
  if (!token) {
    try {
      const p = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
      token = JSON.parse(readFileSync(p, 'utf8')).token ?? '';
    } catch { token = ''; }
  }

  return {
    http: raw.http ?? 'http://127.0.0.1:3000',
    token,
    dshEndpoint: raw.dshEndpoint ?? 'http://127.0.0.1:3080/dsh-agent-supervisor/command',
    dshKey: raw.dshKey ?? process.env.DSH_SUPERVISOR_KEY ?? '',
    sessionId: raw.sessionId,
    intervalSec: Math.max(raw.intervalSec ?? 1, 1),
    // 轮询间隔改成 10–15 秒随机：固定 1 秒轮询一天要打十几万次接口，
    // 又吵又容易招风控。随机间隔像人，也省资源。
    intervalMinSec: Math.max(raw.intervalMinSec ?? 10, 2),
    intervalMaxSec: Math.max(raw.intervalMaxSec ?? 15, Math.max(raw.intervalMinSec ?? 10, 2)),
    groups: Array.isArray(raw.groups) ? raw.groups.map(Number) : [],
    includePrivate: raw.includePrivate !== false,
    ignorePeers: Array.isArray(raw.ignorePeers) ? raw.ignorePeers.map(String) : [],
    contextMessages: raw.contextMessages ?? 6,
    maxPerPoll: Math.max(raw.maxPerPoll ?? 40, 1),
    // —— 可靠性参数 ——
    // 投递重试
    deliverAttempts: Math.max(raw.deliverAttempts ?? 3, 1),
    deliverTimeoutMs: Math.max(raw.deliverTimeoutMs ?? 20000, 1000),
    deliverBackoffMs: Math.max(raw.deliverBackoffMs ?? 2000, 100),
    // 熔断
    breakerThreshold: Math.max(raw.breakerThreshold ?? 5, 1),
    breakerCooldownMs: Math.max(raw.breakerCooldownMs ?? 60000, 1000),
    // 停机太久后的回补窗口：超过这个时长就不追旧消息（默认 7 天）
    catchUpHours: Math.max(raw.catchUpHours ?? 168, 1),
  };
}

const cfg = loadConfig();

// ————— 状态 —————
const loaded = loadState(STATE_PATH);
const state = loaded.state;
if (loaded.recoveredFrom) {
  log(`状态文件损坏，已备份到 ${loaded.recoveredFrom}，从零水位重新开始`);
}
state.stats.restarts += 1;
state.lastRunAt = Date.now();

if (STATUS) {
  console.log(JSON.stringify(summarize(state), null, 2));
  process.exit(0);
}

if (REPLAY_DLQ) {
  await replayDlq();
  process.exit(0);
}

// ————— 可靠性：重试 / 熔断 / DLQ —————
let consecutiveFailures = 0;
let breakerOpenedAt = 0;

function breakerOpen() {
  return breakerOpenedAt > 0 && Date.now() - breakerOpenedAt < cfg.breakerCooldownMs;
}

function breakerRecord(ok) {
  if (ok) {
    consecutiveFailures = 0;
    breakerOpenedAt = 0;
    return;
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= cfg.breakerThreshold) {
    breakerOpenedAt = Date.now();
    log(`熔断打开：连续失败 ${consecutiveFailures} 次，暂停投递 ${Math.round(cfg.breakerCooldownMs / 1000)}s`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 指数退避 + 抖动 */
function backoff(attempt) {
  const base = cfg.deliverBackoffMs * Math.pow(2, attempt - 1);
  const capped = Math.min(base, 60000);
  return Math.max(0, Math.round(capped * (1 + (Math.random() * 0.4 - 0.2))));
}

/** 带超时与重试地投递；全失败则进 DLQ */
async function deliver(text, { retries = cfg.deliverAttempts } = {}) {
  if (breakerOpen()) {
    const wait = cfg.breakerCooldownMs - (Date.now() - breakerOpenedAt);
    throw new Error(`熔断中，${Math.ceil(wait / 1000)}s 后再试`);
  }
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(cfg.dshEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.dshKey ? { 'x-supervisor-key': cfg.dshKey } : {}) },
        body: JSON.stringify({ op: 'send', sessionId: cfg.sessionId, text }),
        signal: AbortSignal.timeout(cfg.deliverTimeoutMs),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) throw new Error(JSON.stringify(json).slice(0, 200));
      breakerRecord(true);
      state.stats.delivered += 1;
      state.lastDeliveryAt = Date.now();   // 记"我上次确实投出去过"，时间感知拿它算自己清醒多久
      return json;
    } catch (e) {
      lastError = e;
      breakerRecord(false);
      if (attempt < retries) {
        const delay = backoff(attempt);
        log(`投递失败(${attempt}/${retries})，${delay}ms 后重试: ${e.message}`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/** 死信：投递彻底失败的任务落盘，不丢消息 */
function pushDlq(kind, payload, error) {
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      payload,
      error: String(error?.message ?? error),
      attempts: cfg.deliverAttempts,
      createdAt: Date.now(),
      sessionId: cfg.sessionId,
    };
    appendFileSync(DLQ_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
    state.stats.failed += 1;
    log(`已进入死信队列: ${kind} (${entry.id})`);
  } catch (e) {
    log(`写死信失败: ${e.message}`);
  }
}

/** 重放死信 */
async function replayDlq() {
  if (!existsSync(DLQ_PATH)) {
    console.log('没有死信');
    return;
  }
  const lines = readFileSync(DLQ_PATH, 'utf8').split('\n').filter((l) => l.trim());
  const kept = [];
  let ok = 0;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { kept.push(line); continue; }
    try {
      const text = entry.kind === 'digest'
        ? entry.payload?.text
        : entry.payload?.text;
      if (!text) { kept.push(line); continue; }
      // 同步投递（重放时不用异步）
      const res = await fetch(cfg.dshEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.dshKey ? { 'x-supervisor-key': cfg.dshKey } : {}) },
        body: JSON.stringify({ op: 'send', sessionId: entry.sessionId ?? cfg.sessionId, text }),
        signal: AbortSignal.timeout(cfg.deliverTimeoutMs),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) throw new Error(JSON.stringify(json).slice(0, 120));
      ok += 1;
    } catch (e) {
      log(`重放失败，保留: ${e.message}`);
      kept.push(line);
    }
  }
  writeFileSync(DLQ_PATH, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
  console.log(`重放完成：成功 ${ok}，保留 ${kept.length}`);
}

/** 把消息放进待回复队列（会话里的我按队列处理） */
function enqueue(payload) {
  try {
    spawnSync(process.execPath, [QUEUE_SCRIPT, 'add', JSON.stringify(payload)], { encoding: 'utf8' });
  } catch (e) { log('入队失败: ' + e.message); }
}

async function api(action, params = {}) {
  const res = await fetch(`${cfg.http}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(`${action}: ${json.message ?? json.wording ?? 'failed'}`);
  return json.data;
}

/**
 * 看清一张图：拿本地文件 → read-image.mjs 分流（文字走 OCR / 画面走千问）。
 *
 * 为什么要自动做：我自己的模型不收图片输入，群里发图原本只能靠 OCR 刮字，
 * 表情包刮出个「O」就没了。之前对着冷峰发的一张 GIF 只能说"猜不出啥意思"。
 *
 * 为什么不在这里 await 太久：视觉模型 2-3 秒。一条消息最多看 2 张，够用且不拖。
 */
async function describeImage(file) {
  if (!file) return '';
  try {
    const info = await api('get_image', { file });
    const local = typeof info?.file === 'string' ? info.file : '';
    if (!local || !existsSync(local)) return '';
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'read-image.mjs'), local], {
      encoding: 'utf8',
      timeout: 120000,
    });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    if (!out) return '';
    // 太长的截断，投递文本要省 token
    return out.replace(/\s+/g, ' ').slice(0, 180);
  } catch {
    return '';
  }
}

function flatten(message) {
  if (typeof message === 'string') return message;
  if (!Array.isArray(message)) return '';
  return message.map((s) => {
    switch (s?.type) {
      case 'text': return s.data?.text ?? '';
      case 'image': return '[图片]';
      case 'face': case 'mface': return '[表情]';
      case 'record': return '[语音]';
      case 'video': return '[视频]';
      case 'file': return '[文件]';
      case 'at': return `@${s.data?.qq === 'all' ? '全体' : s.data?.qq}`;
      case 'reply': return '';
      case 'json': case 'xml': return '[卡片]';
      default: return `[${s?.type ?? '?'}]`;
    }
  }).join('').trim();
}

/** 取出这条消息引用了哪条（reply 段里的 message_id），没有就返回空 */
function replyIdOf(msg) {
  if (!Array.isArray(msg?.message)) return '';
  const seg = msg.message.find((s) => s?.type === 'reply');
  return seg?.data?.id ? String(seg.data.id) : '';
}

/**
 * 把被引用的那条捞出来。
 *
 * 为什么必须捞：只看 `[回复]` 标记等于没看见引用的内容。
 * 实测踩过——冷峰引用了自己「手机掉进坑里」那段，我只看到「太恶心了，屎干了」，
 * 于是猜成「宠物拉的」，猜错方向，还先回了句错的。
 * OneBot 的 reply 段只给 message_id，正文要再调 get_msg 拿。
 */
async function fetchQuoted(messageId) {
  if (!messageId) return null;
  try {
    const q = await api('get_msg', { message_id: Number(messageId) });
    if (!q) return null;
    const who = q.sender?.card || q.sender?.nickname || String(q.sender?.user_id ?? '');
    const text = flatten(q.message).slice(0, 300);
    if (!text) return null;
    return { who, text };
  } catch {
    return null;
  }
}

function mentionsSelf(msg, selfUin) {
  if (!Array.isArray(msg.message)) return false;
  return msg.message.some((s) => s.type === 'at' && String(s.data?.qq) === String(selfUin));
}

function appendInbox(records) {
  if (!records.length) return;
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    appendFileSync(INBOX, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  } catch (e) { log('写 inbox 失败: ' + e.message); }
}

let selfUin = 0;
let offlinePolls = 0;
const historyErrors = {};
const fresh = [];

/**
 * 好友/群列表缓存。
 *
 * 为什么要缓存：1 秒轮询时每秒都拉这两个列表纯属浪费——它们几分钟才变一次。
 * 缓 60 秒，能减少 2/3 的 API 调用。
 */
let peerCache = { at: 0, peers: [] };
const PEER_CACHE_MS = 60_000;

async function listPeers() {
  const now = Date.now();
  if (now - peerCache.at < PEER_CACHE_MS && peerCache.peers.length) return peerCache.peers;

  const contacts = await api('get_friend_list', {});
  const friendList = Array.isArray(contacts) ? contacts : [];
  const groupList = (await api('get_group_list', {})) ?? [];
  const peers = [];

  for (const c of friendList) {
    // 注意：OneBot 的 get_friend_list 返回的是 user_id / nickname，
    // **不是** peerUin / peerName。早先按 peerUin 读，结果永远拿不到好友，
    // 表现就是私聊消息一条都收不到（群里正常，所以不容易发现）。
    const peer = String(c.user_id ?? c.peerUin ?? '');
    if (!peer || cfg.ignorePeers.includes(peer)) continue;
    if (cfg.includePrivate !== true) continue;
    // 好友列表里会包含机器人自己（用来给自己发消息/设备同步），跳过
    if (selfUin && peer === String(selfUin)) continue;
    peers.push({ isGroup: false, peer, peerName: c.remark || c.nickname || c.peerName || peer });
  }
  for (const c of groupList) {
    const peer = String(c.group_id ?? c.peerUin ?? '');
    if (!peer || cfg.ignorePeers.includes(peer)) continue;
    if (cfg.groups.length && !cfg.groups.includes(Number(peer))) continue;
    peers.push({ isGroup: true, peer, peerName: c.group_name ?? peer });
  }

  peerCache = { at: now, peers };
  return peers;
}

async function poll() {
  const peers = await listPeers();

  for (const { isGroup, peer, peerName } of peers) {
    const key = `${isGroup ? 'g' : 'p'}${peer}`;
    const cursor = state.cursors[key];
    const lastSeen = cursor?.lastTime ?? 0;

    let msgs = [];
    try {
      const hist = await api(isGroup ? 'get_group_msg_history' : 'get_friend_msg_history', {
        ...(isGroup ? { group_id: Number(peer) } : { user_id: Number(peer) }),
        count: 30,
      });
      msgs = (hist?.messages ?? []).sort((a, b) => a.time - b.time);
    } catch (e) {
      // 同一条错误每秒刷一次会把日志淹掉，只在首次和每 100 次时记
      historyErrors[key] = (historyErrors[key] ?? 0) + 1;
      if (historyErrors[key] === 1 || historyErrors[key] % 100 === 0) {
        log(`取 ${key} 历史失败（第 ${historyErrors[key]} 次）: ${e.message}`);
      }
      continue;
    }
    if (historyErrors[key]) delete historyErrors[key];

    // 停机很久之后的回补窗口：超过 catchUpHours 的旧消息不追（避免刚开机就倾泻历史）
    const cutoff = Math.floor(Date.now() / 1000) - cfg.catchUpHours * 3600;

    for (const m of msgs) {
      const id = String(m.message_id ?? `${m.time}:${m.message_seq}`);
      if (state.seen[id]) continue;
      if (!isNewMessage(state, key, m.time, m.message_id)) {
        // 水位之前：如果是停机期间漏的（在窗口内）也要处理
        if (m.time < cutoff) continue;
        if (lastSeen && m.time <= lastSeen) continue;
      }
      if (m.time < cutoff) continue;

      state.seen[id] = 1;
      if (String(m.sender?.user_id) === String(selfUin)) continue;

      const ownText = flatten(m.message).slice(0, 500);

      // 图里有啥：文字图走 OCR、画面走千问（read-image.mjs 自己分流）。
      // 一条消息最多看 2 张，多的不管——够用，也不会把投递拖太久。
      const imageSeen = [];
      if (Array.isArray(m.message)) {
        const imgs = m.message.filter((s) => s?.type === 'image').slice(0, 2);
        for (const seg of imgs) {
          const d = await describeImage(seg.data?.file);
          if (d) imageSeen.push(d);
        }
      }
      // 引用要单独捞：reply 段只有 message_id，正文得再调 get_msg。
      // 不捞的话我只能看到「太恶心了」这种半句话，方向会猜错（踩过一次）。
      const quoted = await fetchQuoted(replyIdOf(m));

      // 上下文只补"这条对话里**还没推给过**的那些"。
      //
      // 为什么这么算：以前固定带最近 6 条，可这个会话本身就有记忆——上一条推过的
      // 内容我这边还留着，再推一遍纯属重复烧 token（一天几十条消息，每条都配 6 条历史，
      // 等于同一段对话被反复抄了六七遍）。
      // 现在改成：从这条往前收，**碰到第一条已经推过的就停**，只带中间那段新的。
      const ctx = [];
      const curIdx = msgs.indexOf(m);
      for (let i = curIdx - 1; i >= 0; i -= 1) {
        const x = msgs[i];
        const xid = String(x.message_id ?? `${x.time}:${x.message_seq}`);
        if (state.pushed && state.pushed[xid]) break;   // 已经在我记忆里，往回全是旧料
        if (ctx.length >= cfg.contextMessages) break;
        ctx.unshift({
          time: x.time,
          sender: x.sender?.card || x.sender?.nickname || String(x.sender?.user_id),
          senderId: x.sender?.user_id,
          text: flatten(x.message).slice(0, 200),
        });
      }

      fresh.push({
        at: new Date().toISOString(),
        kind: isGroup ? 'group' : 'private',
        peer,
        peerName: `${peerName}(${peer})`,
        time: m.time,
        senderId: m.sender?.user_id,
        sender: m.sender?.card || m.sender?.nickname || String(m.sender?.user_id),
        text: ownText,
        ...(imageSeen.length ? { imageDesc: imageSeen.join(' / ') } : {}),
        ...(quoted ? { quotedFrom: quoted.who, quotedText: quoted.text } : {}),
        mentioned: mentionsSelf(m, selfUin),
        context: ctx,
      });
      if (!state.pushed) state.pushed = {};
      state.pushed[id] = 1;                             // 记为"给过了"，下次不再当上下文带

      if (fresh.length >= cfg.maxPerPoll) break;
    }

    // 水位推进到本次看到的最新一条
    if (msgs.length) {
      const newest = msgs[msgs.length - 1];
      advanceCursor(state, key, newest.time, newest.message_id);
    }
  }
}

async function runOnce() {
  state.stats.polls += 1;
  // 掉线检测：get_login_info 掉线时仍返回缓存信息，只有 get_status.online 会变 false。
  // 不检测的话，表现就是"进程活着、日志在滚、但一条消息都收不到"。
  try {
    const st = await api('get_status', {});
    if (st?.online !== true) {
      offlinePolls += 1;
      // 不要因为这一条就停。
      // 实测（2026-11-07）：get_status 报 online=false 时，发消息、读历史全都正常，
      // 是 NapCat/NTQQ 的状态位不准。之前一见 false 就 return，结果"进程活着却一条不收"。
      // 现在的做法：报一次，然后继续轮询——真掉线时轮询自然收不到东西，代价只是几行日志。
      if (offlinePolls === 1 || offlinePolls % 60 === 0) {
        log(
          `[疑似掉线] get_status.online=false（连续 ${offlinePolls} 轮）——继续轮询，若确实收不到再扫码`
        );
      }
    } else if (offlinePolls > 0) {
      log(`[恢复] NapCat 重新在线（之前 ${offlinePolls} 轮报 false）`);
      offlinePolls = 0;
    }
  } catch (e) {
    log('取在线状态失败: ' + e.message);
    return;
  }

  try {
    const login = await api('get_login_info', {});
    selfUin = Number(login?.user_id ?? 0);
  } catch (e) {
    log('取登录信息失败: ' + e.message);
  }

  try {
    await poll();
  } catch (e) {
    log('轮询失败: ' + e.message);
  }

  // 全部消息即时投递（按 peer 合并，同一批到达的拼成一条）
  //
  // 为什么按 peer 合并而不是逐条发：一分钟来 5 条会变成 5 个独立请求，
  // 每次都要重新读上下文。合并成一条，一次看全，回复也更连贯。
  const byPeer = new Map();
  for (const m of fresh) {
    const key = `${m.kind}:${m.peer}`;
    if (!byPeer.has(key)) byPeer.set(key, []);
    byPeer.get(key).push(m);
  }

  for (const [, batch] of byPeer) {
    const head = batch[0];
    const lines = [];

    // 时间先摆出来。为什么要它：今早我把"14 小时没新消息"判成"群里没人说话"，
    // 实际是 QQ 掉了。光有分钟数不够，得有时段语义 + 掉线提示。
        // 群友档案：投递前给每个发言人补一行"这个人是谁"。
    // 以前每轮都在重新认识同一个人——他说"又加班"，我不知道这周已经第三次。
    // 档案缺失就跳过，不让投递因为档案没建而失败。
    try {
      const senders = [...new Set(batch.map((m) => m.senderId).filter(Boolean))];
      const profiles = [];
      for (const uid of senders.slice(0, 6)) {
        const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'profiles.mjs'), 'line', String(uid)], {
          encoding: 'utf8',
          timeout: 4000,
        });
        const text = (r.stdout || '').trim();
        if (text) profiles.push(`${uid}：${text}`);
      }
      if (profiles.length) {
        lines.push('（群友档案）');
        for (const p of profiles) lines.push(`· ${p}`);
        lines.push('');
      }
    } catch { /* 档案出错不影响投递 */ }

const lastSeenMs = (head.time ? head.time * 1000 : Date.now()) - 0;
    const line = nowLine(Date.now(), {
      lastSeenMs: lastSeenMs,
      selfAwakeMs: state.lastDeliveryAt ?? 0,
    });
    lines.push(`（${line}）`);

    if (head.kind === 'private') {
      lines.push(`【私聊 ${head.sender}】`);
    } else {
      const at = batch.some((m) => m.mentioned);
      const senders = [...new Set(batch.map((m) => m.sender))].join('、');
      lines.push(`【群 ${head.peerName}】${senders}${at ? ' 提及你' : ''}：`);
    }

    if (batch.length === 1) {
      // 引用先摆出来，再摆他说的话——顺序反了会让人以为引用是正文
      if (head.quotedText) {
        lines.push(`（${head.sender} 引用了 ${head.quotedFrom}：${head.quotedText}）`);
      }
      lines.push(head.text);
      if (head.imageDesc) {
        lines.push(`（图里是：${head.imageDesc}）`);
      }
      if (head.context?.length) {
        lines.push('（最近上下文）');
        for (const c of head.context) lines.push(`${c.sender}(${c.senderId ?? '?'}): ${c.text}`);
      }
    } else {
      for (const m of batch) {
        const t = new Date(m.time * 1000).toLocaleTimeString('zh-CN', { hour12: false });
        if (m.quotedText) {
          lines.push(`[${t}] （引用 ${m.quotedFrom}：${m.quotedText}）`);
        }
        // 带 QQ 号：显示名会改、会重名，光看名字迟早认错人
        lines.push(`[${t}] ${m.sender}(${m.senderId ?? '?'}): ${m.text}`);
        if (m.imageDesc) lines.push(`[${t}] （图里是：${m.imageDesc}）`);
      }
    }

    lines.push('');
    // 每次都钉一遍：不读人格就开口，等于换了个 AI 在替我说话。
    // 号主 2026-11-10 明确要求「每次回复都要读人格文档」，所以不靠自觉，写进投递文本里。
    lines.push('回复前先读 private/personas/global.md ——那是我说话的样子，不是参考资料。不读就别开口。');
    // 派活规则也钉在投递里：只写进 rules.md 容易忘，聊天里根本想不起去翻。
    lines.push('（对方要的是"做软件"——写脚本/改代码/做工具/清洗数据——按 private/rules.md 第 11 节派活，别在聊天会话里现做。）');
    // 行数写死过一次，人格一改就变成假情报（写 178 行时实际已经 198 行），所以只给路径。
    lines.push('（要发弱智吧那种段子，再打开仓库根目录的 identity_弱智吧.md，别凭印象现编。）');
    lines.push(head.kind === 'private'
      ? '要回就回，不想回可以 skip。'
      : (batch.some((m) => m.mentioned)
        ? '群里有人 @你，判断怎么回。'
        : '没 @你；要不要接话由你判断，不接就 skip。'));

    const text = lines.join(String.fromCharCode(10));
    appendInbox(batch);
    try {
      await deliver(text);
      log(`即时投递 ${batch.length} 条: ${head.kind} ${head.peer}`);
    } catch (e) {
      pushDlq('urgent', { text, message: head }, e);
      log(`投递失败(已入死信): ${head.kind} ${head.peer}: ${e.message}`);
    }
  }

  // 全部入待回复队列（要不要回由会话里的我判断）
  for (const m of fresh) {
    enqueue({
      kind: m.kind,
      peer: m.peer,
      peerName: m.peerName,
      sender: m.sender,
      senderId: m.senderId,
      text: m.text,
      mentioned: m.mentioned,
      time: m.time,
      context: m.context,
      replyHint: m.mentioned ? '群里@了你，需要判断怎么回' : '没@你；要不要接话由你判断',
    });
  }

  // 摘要模式已废弃：现在全部消息即时投递（见上方 byPeer 合并投递）

  saveStateAtomic(STATE_PATH, state);
  log(`本轮新增 ${fresh.length} 条`);
  fresh.length = 0;
}

// ————— 启动 —————
log(`监视启动：${selfUin || '?'} 每 ${cfg.intervalMinSec}~${cfg.intervalMaxSec}s 随机轮询，全部消息即时投递`);
log(`覆盖：私聊${cfg.includePrivate ? '开' : '关'}，群 ${cfg.groups.length ? cfg.groups.join(',') : '全部'}`);
log(`回补窗口 ${cfg.catchUpHours}h，熔断阈值 ${cfg.breakerThreshold}，重试 ${cfg.deliverAttempts} 次`);

if (ONCE) {
  await runOnce();
  process.exit(0);
}

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  log('收到退出信号，保存状态…');
  saveStateAtomic(STATE_PATH, state);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => { try { saveStateAtomic(STATE_PATH, state); } catch {} });

while (!stopping) {
  try {
    await runOnce();
  } catch (e) {
    log('轮询异常: ' + e.message);
  }
  // 每轮重新抽一个间隔：10~15 秒之间随机。
  // 固定间隔的请求节奏太规整，长期看像脚本；随机一点更像人在刷。
  const waitSec = cfg.intervalMinSec + Math.random() * (cfg.intervalMaxSec - cfg.intervalMinSec);
  await sleep(waitSec * 1000);
}
