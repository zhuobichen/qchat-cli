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
 * 用法:
 *   node private/qq-watch.mjs            # 常驻
 *   node private/qq-watch.mjs --once     # 只跑一轮（调试）
 *   node private/qq-watch.mjs --status   # 打印状态后退出
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'private', 'qq-watch.config.json');
const STATE_PATH = join(ROOT, 'private', 'qq-watch.state.json');
const INBOX = join(ROOT, 'output', 'qq-inbox.jsonl');
const LOG_PATH = join(ROOT, 'output', 'qq-watch.log');

const ONCE = process.argv.includes('--once');
const STATUS = process.argv.includes('--status');

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
  };
}

const cfg = loadConfig();

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return { initialized: false, lastTime: {}, seen: {}, pending: [], lastDigestAt: 0 }; }
}
function saveState(s) {
  const ids = Object.keys(s.seen);
  if (ids.length > 5000) for (const id of ids.slice(0, ids.length - 5000)) delete s.seen[id];
  try { writeFileSync(STATE_PATH, JSON.stringify(s), 'utf8'); } catch {}
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

const pad = (n) => String(n).padStart(2, '0');
function fmtTime(ts) {
  const d = new Date(ts * 1000);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function mentionsSelf(msg, selfUin) {
  if (!Array.isArray(msg.message)) return false;
  return msg.message.some((s) => s.type === 'at' && String(s.data?.qq) === String(selfUin));
}

async function deliver(text) {
  const res = await fetch(cfg.dshEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.dshKey ? { 'x-supervisor-key': cfg.dshKey } : {}) },
    body: JSON.stringify({ op: 'send', sessionId: cfg.sessionId, text }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(JSON.stringify(json).slice(0, 200));
  return json;
}

function appendInbox(records) {
  if (!records.length) return;
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    appendFileSync(INBOX, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  } catch (e) { log('写 inbox 失败: ' + e.message); }
}

const state = loadState();

async function collectOnce(selfUin) {
  const contacts = await api('get_recent_contact', { count: 50 });
  const fresh = [];

  for (const c of contacts ?? []) {
    const chatType = Number(c.chatType);
    const peer = String(c.peerUin ?? '');
    if (!peer || cfg.ignorePeers.includes(peer)) continue;

    const isPrivate = chatType === 1;
    const isGroup = chatType === 2;
    if (isPrivate && !cfg.includePrivate) continue;
    if (isGroup && cfg.groups.length && !cfg.groups.includes(Number(peer))) continue;
    if (!isPrivate && !isGroup) continue; // 服务号/系统消息等跳过

    const key = `${isGroup ? 'g' : 'p'}${peer}`;
    const lastSeen = Number(state.lastTime[key] ?? 0);
    const msgTime = Number(c.msgTime ?? 0);
    if (msgTime <= lastSeen) continue;

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

    for (const m of msgs) {
      if (m.time <= lastSeen) continue;
      const id = String(m.message_id ?? `${m.time}:${m.message_seq}`);
      if (state.seen[id]) continue;
      state.seen[id] = 1;
      if (String(m.sender?.user_id) === String(selfUin)) continue;

      fresh.push({
        at: new Date().toISOString(),
        kind: isGroup ? 'group' : 'private',
        peer,
        peerName: isGroup ? `${c.peerName ?? peer}(${peer})` : `${c.peerName ?? peer}(${peer})`,
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

    // 陈旧消息：watcher 停过一段时间后，水位之前的历史不该被当成"刚发生"
    const newestTime = msgs.length ? msgs[msgs.length - 1].time : 0;
    const cutoff = Math.floor(Date.now() / 1000) - cfg.maxAgeHours * 3600;
    const fresh = msgs.filter((m) => m.time > cutoff);
    if (fresh.length !== msgs.length) log(`${key}: 跳过 ${msgs.length - fresh.length} 条陈旧消息（>${cfg.maxAgeHours}h）`);
    msgs = fresh;

    // 水位始终按"看到过的最新时间"推进，否则陈旧消息每轮都会被重新扫一遍
    if (newestTime) state.lastTime[key] = Math.max(lastSeen, newestTime);
    if (fresh.length >= cfg.maxPerPoll) break;
  }

  return fresh;
}

async function flush(fresh, selfUin) {
  if (!fresh.length && !(state.pendingUrgent?.length)) return;
  appendInbox(fresh);

  const urgentNow = fresh.filter((m) => m.kind === 'private' || m.mentioned);
  // 重试队列：投递失败的消息留在这里，下一轮继续尝试（DSH 暂时不可用时不会丢）
  const queue = [...(state.pendingUrgent ?? []), ...urgentNow];
  const stillPending = [];
  for (const m of queue) {
    const ctx = m.context?.length
      ? '\n最近上下文：\n' + m.context.map((x) => `  ${fmtTime(x.time)} ${x.sender}: ${x.text}`).join('\n')
      : '';
    const text = [
      `【QQ ${m.kind === 'private' ? '私聊' : '群里 @ 你'}】`,
      `${m.kind === 'private' ? '来自' : '群'}: ${m.peerName}`,
      `时间: ${fmtTime(m.time)}`,
      `发送者: ${m.sender}(${m.senderId})`,
      `内容: ${m.text}`,
      ctx,
      '',
      m.kind === 'private'
        ? `如需回复: qce send msg ${m.peer} "内容"`
        : `如需回复: qce send group ${m.peer} "内容"`,
    ].join('\n');
    try {
      await deliver(text);
      log(`立即投递: ${m.kind} ${m.peer} ${m.sender}: ${String(m.text).slice(0, 40)}`);
    } catch (e) {
      log(`投递失败(${m.kind} ${m.peer})，转入重试队列: ${e.message}`);
      stillPending.push(m);
    }
  }
  state.pendingUrgent = stillPending.slice(-50);
  if (stillPending.length) log(`重试队列积压 ${stillPending.length} 条`);

  const others = fresh.filter((m) => !(m.kind === 'private' || m.mentioned));
  if (others.length) state.pending.push(...others);

  const due = Date.now() - Number(state.lastDigestAt ?? 0) >= cfg.digestMin * 60_000;
  if (state.pending.length && due) {
    const batch = state.pending.splice(0, 200);
    const byPeer = new Map();
    for (const m of batch) {
      const arr = byPeer.get(m.peer) ?? [];
      arr.push(m);
      byPeer.set(m.peer, arr);
    }
    const lines = [`【QQ 消息汇总】${fmtTime(batch[0].time)} → ${fmtTime(batch[batch.length - 1].time)}，共 ${batch.length} 条（无需逐条回复）`];
    for (const [peer, arr] of byPeer) {
      lines.push(`\n群/会话 ${arr[0].peerName}: ${arr.length} 条`);
      for (const m of arr.slice(-8)) lines.push(`  ${fmtTime(m.time)} ${m.sender}: ${m.text.slice(0, 120)}`);
    }
    try { await deliver(lines.join('\n')); state.lastDigestAt = Date.now(); log(`汇总投递 ${batch.length} 条`); }
    catch (e) { log('汇总投递失败: ' + e.message); state.pending.unshift(...batch); }
  }
}

async function main() {
  if (STATUS) {
    const s = loadState();
    console.log(JSON.stringify({
      intervalSec: cfg.intervalSec,
      digestMin: cfg.digestMin,
      tracked: Object.keys(s.lastTime).length,
      pending: (s.pending ?? []).length,
      lastDigestAgoMin: s.lastDigestAt ? Math.round((Date.now() - s.lastDigestAt) / 60000) : null,
    }, null, 2));
    return;
  }

  const info = await api('get_login_info');
  const selfUin = info?.user_id;
  log(`监视启动：${info?.nickname}(${selfUin}) 每 ${cfg.intervalSec}s 轮询，汇总间隔 ${cfg.digestMin}min`);
  log(`覆盖：私聊${cfg.includePrivate ? '开' : '关'}，群 ${cfg.groups.length ? cfg.groups.join(',') : '全部'}`);

  // 首轮只记录基线，不投递历史
  let baseline = state.initialized !== true;
  if (baseline) log('首次运行：先建立基线（不投递历史消息）');

  do {
    let fresh = [];
    try {
      fresh = await collectOnce(selfUin);
    } catch (e) {
      log(`轮询失败: ${e.message}`);
    }

    if (baseline) {
      state.initialized = true;
      baseline = false;
      state.lastDigestAt = Date.now();
      saveState(state);
      log(`基线建立完成（跳过 ${fresh.length} 条历史）`);
      if (ONCE) break;
    } else {
      await flush(fresh, selfUin);
      saveState(state);
      if (ONCE) { log(`本轮新增 ${fresh.length} 条`); break; }
    }

    await new Promise((r) => setTimeout(r, cfg.intervalSec * 1000));
  } while (true);
}

main().catch((e) => {
  log('致命错误: ' + (e?.stack || e?.message || e));
  process.exit(1);
});
