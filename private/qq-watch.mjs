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
 *   其他群消息       → 累积，每 digestMin 分钟投一次摘要；无新消息不投
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
    intervalSec: Math.max(raw.intervalSec ?? 30, 10),
    digestMin: Math.max(raw.digestMin ?? 10, 1),
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
const fresh = [];

async function poll() {
  const contacts = await api('get_friend_list', {});
  const friendList = Array.isArray(contacts) ? contacts : [];
  const groupList = (await api('get_group_list', {})) ?? [];
  const peers = [];

  for (const c of friendList) {
    const peer = String(c.peerUin ?? '');
    if (!peer || cfg.ignorePeers.includes(peer)) continue;
    if (!cfg.includePrivate) continue;
    peers.push({ isGroup: false, peer, peerName: c.peerName ?? peer });
  }
  for (const c of groupList) {
    const peer = String(c.peerUin ?? c.group_id ?? '');
    if (!peer || cfg.ignorePeers.includes(peer)) continue;
    if (cfg.groups.length && !cfg.groups.includes(Number(peer))) continue;
    peers.push({ isGroup: true, peer, peerName: c.group_name ?? peer });
  }

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
      log(`取 ${key} 历史失败: ${e.message}`);
      continue;
    }

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

  // 立即投递：私聊或群里 @我
  const urgent = fresh.filter((m) => m.kind === 'private' || m.mentioned);
  const rest = fresh.filter((m) => !(m.kind === 'private' || m.mentioned));

  for (const m of urgent) {
    const lines = [];
    if (m.kind === 'group') lines.push(`【群 ${m.peerName}】${m.sender} 提及你：`);
    else lines.push(`【私聊 ${m.sender}】`);
    lines.push(m.text);
    if (m.context?.length) {
      lines.push('（最近上下文）');
      for (const c of m.context) lines.push(`${c.sender}: ${c.text}`);
    }
    const text = lines.join('\n');
    appendInbox([m]);
    try {
      await deliver(text);
      log(`立即投递: ${m.kind} ${m.peer} ${m.sender}: ${String(m.text).slice(0, 40)}`);
    } catch (e) {
      pushDlq('urgent', { text, message: m }, e);
      log(`立即投递失败(已入死信): ${m.kind} ${m.peer}: ${e.message}`);
    }
  }

  // 其余消息：攒进摘要队列
  if (rest.length) {
    state.pending.push(...rest);
    log(`累积 ${rest.length} 条待汇总`);
  }

  // 汇总投递（每 digestMin 分钟一次）
  const due = Date.now() - state.lastDigestAt >= cfg.digestMin * 60_000;
  if (state.pending.length && (due || ONCE)) {
    const batch = state.pending.slice(0, 100);
    const lines = [`【群消息汇总】${batch.length} 条`];
    for (const m of batch) {
      const d = new Date(m.time * 1000);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      lines.push(`${hh}:${mm} ${m.peerName} ${m.sender}: ${m.text.slice(0, 80)}`);
    }
    try {
      await deliver(lines.join('\n'));
      state.pending = state.pending.slice(batch.length);
      state.lastDigestAt = Date.now();
      log(`汇总投递 ${batch.length} 条`);
    } catch (e) {
      pushDlq('digest', { text: lines.join('\n'), count: batch.length }, e);
      log(`汇总投递失败(已入死信): ${e.message}`);
    }
  }

  saveStateAtomic(STATE_PATH, state);
  log(`本轮新增 ${fresh.length} 条`);
  fresh.length = 0;
}

// ————— 启动 —————
log(`监视启动：${selfUin || '?'} 每 ${cfg.intervalSec}s 轮询，汇总间隔 ${cfg.digestMin}min`);
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
