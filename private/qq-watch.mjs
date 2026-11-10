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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'private', 'qq-watch.config.json');
const STATE_PATH = join(ROOT, 'private', 'qq-watch.state.json');
const INBOX = join(ROOT, 'output', 'qq-inbox.jsonl');
const LOG_PATH = join(ROOT, 'output', 'qq-watch.log');
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

      fresh.push({
        at: new Date().toISOString(),
        kind: isGroup ? 'group' : 'private',
        peer,
        peerName: `${peerName}(${peer})`,
        time: m.time,
        senderId: m.sender?.user_id,
        sender: m.sender?.card || m.sender?.nickname || String(m.sender?.user_id),
        text: flatten(m.message).slice(0, 500),
        mentioned: mentionsSelf(m, selfUin),
        context: msgs.filter((x) => x.time <= m.time).slice(-(cfg.contextMessages + 1), -1).map((x) => ({
          time: x.time,
          sender: x.sender?.card || x.sender?.nickname || String(x.sender?.user_id),
          senderId: x.sender?.user_id,
          text: flatten(x.message).slice(0, 200),
        })),
      });

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

    if (head.kind === 'private') {
      lines.push(`【私聊 ${head.sender}】`);
    } else {
      const at = batch.some((m) => m.mentioned);
      const senders = [...new Set(batch.map((m) => m.sender))].join('、');
      lines.push(`【群 ${head.peerName}】${senders}${at ? ' 提及你' : ''}：`);
    }

    if (batch.length === 1) {
      lines.push(head.text);
      if (head.context?.length) {
        lines.push('（最近上下文）');
        for (const c of head.context) lines.push(`${c.sender}(${c.senderId ?? '?'}): ${c.text}`);
      }
    } else {
      for (const m of batch) {
        const t = new Date(m.time * 1000).toLocaleTimeString('zh-CN', { hour12: false });
        // 带 QQ 号：显示名会改、会重名，光看名字迟早认错人
        lines.push(`[${t}] ${m.sender}(${m.senderId ?? '?'}): ${m.text}`);
      }
    }

    lines.push('');
    // 每次都钉一遍：不读人格就开口，等于换了个 AI 在替我说话。
    // 号主 2026-11-10 明确要求「每次回复都要读人格文档」，所以不靠自觉，写进投递文本里。
    lines.push('回复前先读 private/personas/global.md（178 行）——那是我说话的样子，不是参考资料。不读就别开口。');
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
log(`监视启动：${selfUin || '?'} 每 ${cfg.intervalSec}s 轮询，全部消息即时投递`);
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
  await sleep(cfg.intervalSec * 1000);
}
