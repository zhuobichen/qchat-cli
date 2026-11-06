#!/usr/bin/env node
/**
 * dsh-bridge —— 把 QQ 群消息接到本地 DSH 会话
 *
 * 工作方式：
 *   1. 轮询 OneBot（NapCat）：只看白名单群（空 = 全部群，但只响应被 @ 的）
 *   2. 发现「被 @ 机器人」的新消息 → 组装上下文
 *   3. POST 到 DSH：/dsh-agent-supervisor/command {op:send, sessionId, text}
 *      → 本地会话被唤醒，用真实工具处理，并可自行 `qce send group` 回群
 *
 * 用法:
 *   node private/dsh-bridge.mjs            # 前台跑
 *   node private/dsh-bridge.mjs --once     # 只扫一轮（调试）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(ROOT, 'private', 'dsh-bridge.config.json');
const STATE_PATH = join(ROOT, 'private', 'dsh-bridge.state.json');
const LOG_PATH = join(ROOT, 'output', 'dsh-bridge.log');

const ONCE = process.argv.includes('--once');

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  console.log(line);
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) throw new Error(`缺少 ${CONFIG_PATH}`);
  const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

  // OneBot 连接信息默认复用 qce 的配置
  let host = raw.onebot?.host;
  let port = raw.onebot?.port;
  let token = raw.onebot?.token;
  if (!host || !port) {
    const confPath = join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'qchat-cli-nodejs', 'Config', 'config.json');
    const conf = JSON.parse(readFileSync(confPath, 'utf8'));
    host = host ?? conf.connection?.host ?? '127.0.0.1';
    port = port ?? conf.connection?.port ?? 3000;
    token = token ?? conf.token ?? '';
  }

  return {
    onebot: { host, port, token },
    dshEndpoint: raw.dshEndpoint ?? 'http://127.0.0.1:3080/dsh-agent-supervisor/command',
    dshKey: raw.dshKey ?? process.env.DSH_SUPERVISOR_KEY ?? '',
    sessionId: raw.sessionId,
    groups: Array.isArray(raw.groups) ? raw.groups.map(Number) : [],
    pollMs: Math.max(raw.pollMs ?? 3000, 1500),
    contextMessages: Math.max(raw.contextMessages ?? 8, 0),
    selfUin: raw.selfUin ? Number(raw.selfUin) : 0,
  };
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { seen: {}, lastCheck: {} };
  }
}

function saveState(state) {
  // 只保留最近 3000 条 message_id，防止无限增长
  const ids = Object.keys(state.seen);
  if (ids.length > 3000) {
    for (const id of ids.slice(0, ids.length - 3000)) delete state.seen[id];
  }
  writeFileSync(STATE_PATH, JSON.stringify(state), 'utf8');
}

const cfg = loadConfig();
const base = `http://${cfg.onebot.host}:${cfg.onebot.port}`;

async function api(action, params = {}) {
  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.onebot.token ? { Authorization: `Bearer ${cfg.onebot.token}` } : {}),
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15000),
  });
  const json = await res.json();
  if (json.status !== 'ok' && json.retcode !== 0) throw new Error(`${action}: ${json.message ?? json.wording ?? 'failed'}`);
  return json.data;
}

function flatten(msg) {
  if (typeof msg === 'string') return msg;
  if (!Array.isArray(msg)) return String(msg ?? '');
  return msg
    .map((s) => {
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
    })
    .join('');
}

function mentionsSelf(msg, selfUin, selfName) {
  if (Array.isArray(msg.message)) {
    for (const seg of msg.message) {
      if (seg.type !== 'at') continue;
      if (String(seg.data?.qq) === String(selfUin)) return true;
      const label = String(seg.data?.text ?? seg.data?.name ?? '').replace(/^@/, '').trim();
      if (selfName && label && label === selfName) return true;
    }
  }
  const raw = String(msg.raw_message ?? '');
  if (new RegExp(`\\[CQ:at,qq=${selfUin}`).test(raw)) return true;
  return false;
}

function fmtTime(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function deliverToDsh(text) {
  const res = await fetch(cfg.dshEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.dshKey ? { 'x-supervisor-key': cfg.dshKey } : {}),
    },
    body: JSON.stringify({ op: 'send', sessionId: cfg.sessionId, text }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(JSON.stringify(json).slice(0, 300));
  return json;
}

async function main() {
  const state = loadState();
  log(`启动：OneBot ${base} → DSH ${cfg.dshEndpoint}`);
  log(`会话 ${cfg.sessionId}｜群白名单 ${cfg.groups.length ? cfg.groups.join(',') : '（全部，仅 @ 触发）'}`);

  const self = await api('get_login_info');
  const selfUin = cfg.selfUin || self?.user_id;
  const selfName = String(self?.nickname ?? '').trim();
  log(`登录中：${selfName}(${selfUin})`);

  const groups = cfg.groups.length
    ? cfg.groups.map((id) => ({ group_id: id, group_name: String(id) }))
    : (await api('get_group_list')) ?? [];

  const nameOfGroup = new Map(groups.map((g) => [Number(g.group_id), g.group_name]));

  do {
    for (const g of groups) {
      const gid = Number(g.group_id);
      let history;
      try {
        history = await api('get_group_msg_history', { group_id: gid, count: 30 });
      } catch (e) {
        log(`取群 ${gid} 失败: ${e.message}`);
        continue;
      }
      const msgs = (history?.messages ?? []).sort((a, b) => a.time - b.time);

      for (const m of msgs) {
        const key = `g${gid}:${m.message_id}`;
        if (state.seen[key]) continue;
        state.seen[key] = 1;

        const senderId = m.sender?.user_id;
        if (String(senderId) === String(selfUin)) continue;
        if (!mentionsSelf(m, selfUin, selfName)) continue;

        const recent = msgs.filter((x) => x.time <= m.time).slice(-cfg.contextMessages - 1, -1);
        const ctx = recent
          .map((x) => `  ${fmtTime(x.time)} ${x.sender?.card || x.sender?.nickname || x.sender?.user_id}: ${flatten(x.message).slice(0, 200)}`)
          .join('\n');

        const text = [
          '【QQ 群消息 · 需要你处理】',
          `群：${nameOfGroup.get(gid) ?? gid}（${gid}）`,
          `时间：${fmtTime(m.time)}`,
          `发送者：${m.sender?.card || m.sender?.nickname || senderId}（${senderId}）`,
          `内容：${flatten(m.message).slice(0, 800)}`,
          ctx ? `\n最近上下文（旧→新）：\n${ctx}` : '',
          '',
          `如需回话：cd 到 qchat-cli 项目目录，执行  qce send group ${gid} "回复内容"`,
          '（若只是记录不需要回复，就忽略本条，不要硬回。）',
        ]
          .filter(Boolean)
          .join('\n');

        try {
          const out = await deliverToDsh(text);
          log(`已投递群 ${gid} 消息 ${m.message_id} → 会话 ${out.session_id ?? cfg.sessionId}`);
        } catch (e) {
          log(`投递失败（群 ${gid} 消息 ${m.message_id}）: ${e.message}`);
          delete state.seen[key]; // 下轮重试
        }
      }
      state.lastCheck[gid] = Math.floor(Date.now() / 1000);
    }

    saveState(state);
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  } while (true);
}

main().catch((e) => {
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
