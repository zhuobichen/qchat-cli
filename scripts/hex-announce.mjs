/**
 * 开黑播报（待确认模式）
 *
 * 默认不往群里发，而是把「草稿 + 数据」推给 DSH 会话（也就是我），
 * 由我判断这条值不值得发、要不要点名战犯，再决定发不发。
 *
 * 用法：
 *   node scripts/hex-announce.mjs            跑一轮，把新局推给我（不发群）
 *   node scripts/hex-announce.mjs --loop     常驻，每 pollSeconds 跑一轮
 *   node scripts/hex-announce.mjs --send <gameId>   我确认后，真正发这一局
 *   node scripts/hex-announce.mjs --dry      只看会推什么
 *
 * 为什么不再自动发：群里已经有我主动说话，机器再自动播报会显得吵；
 * 而且「战犯是谁」这种判断需要我加一层人味，纯规则点名容易得罪人。
 */
import fs, { appendFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadRoster, findTeamGames, renderTeamBroadcast } from '../dist/core/hex-team.js';
import { judgeCulprit, renderVerdictLine } from '../dist/core/hex-verdict.js';

const ROSTER = path.join(process.cwd(), 'private', 'hex-roster.json');
const STATE = path.join(process.cwd(), 'private', '.hex-announced.json');
const BRIDGE = path.join(process.cwd(), 'private', 'qq-watch.config.json');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const LOOP = argv.includes('--loop');
const SEND_AT = argv.indexOf('--send');

// 同时写 stdout 和文件。
// 为什么要写文件：用 host_exec detach 起的进程，stdout 会被丢弃（实测日志恒为 0 字节），
// 于是"它在不在跑、跑了几轮"完全看不到。自己落盘才查得动。
const LOG_FILE = path.join(process.cwd(), 'output', 'hex-ann.log');
// 如果目标文件被别的实例锁着（Windows 下 appendFileSync 会抛 EPERM），退到备用文件
function log(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {
    try {
      appendFileSync(path.join(process.cwd(), 'output', 'hex-announce-alt.log'), line + '\n', 'utf8');
    } catch {
      /* 两个都写不进就算了，不能拖垮主流程 */
    }
  }
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'));
  } catch {
    return { delivered: {}, sent: {} };
  }
}

function saveState(s) {
  const prune = (obj) => {
    const keys = Object.keys(obj);
    if (keys.length <= 500) return obj;
    const out = {};
    for (const k of keys.slice(-500)) out[k] = obj[k];
    return out;
  };
  s.delivered = prune(s.delivered ?? {});
  s.sent = prune(s.sent ?? {});
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2), 'utf8');
}

function loadBridge() {
  const raw = JSON.parse(fs.readFileSync(BRIDGE, 'utf8'));
  return {
    endpoint: raw.dshEndpoint ?? 'http://127.0.0.1:3080/dsh-agent-supervisor/command',
    key: raw.dshKey ?? process.env.DSH_SUPERVISOR_KEY ?? '',
    sessionId: raw.sessionId,
  };
}

/** 推给 DSH 会话（我），不直接发群 */
async function deliverToMe(text) {
  const b = loadBridge();
  if (!b.sessionId) throw new Error('qq-watch.config.json 里没有 sessionId');
  const res = await fetch(b.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(b.key ? { 'x-supervisor-key': b.key } : {}),
    },
    body: JSON.stringify({ op: 'send', sessionId: b.sessionId, text }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(JSON.stringify(json).slice(0, 200));
  return json;
}

function sendToGroup(group, text) {
  const r = spawnSync(
    process.execPath,
    ['dist/cli.js', 'send', 'group', String(group), text, '--force'],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 },
  );
  if (r.status !== 0) {
    throw new Error(`发送失败: ${(r.stderr || r.stdout || '').trim().slice(-300)}`);
  }
}

/** 拼一条「待我确认」的推送 */
async function buildProposal(game, roster) {
  let verdict = null;
  let verdictLine = '';
  try {
    verdict = await judgeCulprit(game);
    verdictLine = renderVerdictLine(verdict, game);
  } catch (e) {
    log(`  战犯判定失败: ${e.message}`);
  }

  const draft = [renderTeamBroadcast(game), verdictLine].filter(Boolean).join('\n');
  const hint = [
    `【开黑待确认】gameId=${game.gameId}`,
    '',
    draft,
    '',
    `--- 判定来源：${verdict?.source ?? '无'}${verdict?.reason ? `（${verdict.reason}）` : ''}`,
    `确认发送：node scripts/hex-announce.mjs --send ${game.gameId}`,
    '觉得不该发就忽略；要改口吻告诉我。',
  ].join('\n');

  return { draft, hint };
}

async function once() {
  const roster = loadRoster(ROSTER);
  const state = loadState();

  let games = [];
  try {
    games = await findTeamGames(roster, {
      depth: 8,
      saveBack: (r) => fs.writeFileSync(ROSTER, JSON.stringify(r, null, 2), 'utf8'),
    });
  } catch (e) {
    log(`拉战绩失败: ${e.message}`);
    return;
  }

  // 新鲜度闸门：超过 maxPushAgeMinutes 的局不再推送。
  // 理由：播报的价值在于"刚打完"的现场感，两小时前的局推过来只会变成复读。
  // 真想补发就手动 --send <gameId>。
  const maxAge = (roster.announce.maxPushAgeMinutes ?? 20) * 60_000;
  const now = Date.now();
  const fresh = games.filter(
    (g) => !state.delivered?.[String(g.gameId)] && now - g.creation <= maxAge,
  );
  if (fresh.length === 0) {
    log(`本轮没有新开黑（符合条件 ${games.length} 局，都已推送过）`);
    return;
  }
  fresh.sort((a, b) => a.creation - b.creation);

  // 只推最新的一条：一次性把当天积压全推过来会淹掉会话，
  // 而且旧局早过时了，推了也不会发。
  const toPush = fresh.slice(-1);

  for (const g of toPush) {
    const { hint } = await buildProposal(g, roster);
    if (DRY) {
      log(`[dry] 将推送:\n${hint}`);
    } else {
      try {
        await deliverToMe(hint);
        log(`已推送待确认 gameId=${g.gameId}（${g.results.length} 人 · ${g.win ? '胜' : '负'}）`);
      } catch (e) {
        log(`推送失败，下轮重试: ${e.message}`);
        continue;
      }
    }
    state.delivered ??= {};
    state.delivered[String(g.gameId)] = { at: Date.now(), creation: g.creation };
  }
  if (!DRY) saveState(state);
}

/** 我确认后，真正发某一局 */
async function sendGame(gameId) {
  const roster = loadRoster(ROSTER);
  const state = loadState();
  const games = await findTeamGames(roster, { depth: 8 });
  const g = games.find((x) => x.gameId === gameId);
  if (!g) {
    log(`没有 gameId=${gameId} 的开黑局（可能超出时间窗）`);
    return;
  }
  const verdict = await judgeCulprit(g);
  const text = [renderTeamBroadcast(g), renderVerdictLine(verdict, g)].filter(Boolean).join('\n');
  sendToGroup(roster.group, text);
  state.sent ??= {};
  state.sent[String(gameId)] = { at: Date.now(), creation: g.creation };
  saveState(state);
  log(`已发群 gameId=${gameId}（判定来源 ${verdict.source}）`);
}

async function main() {
  if (SEND_AT >= 0) {
    const id = Number(argv[SEND_AT + 1]);
    if (!Number.isFinite(id)) {
      log('用法: node scripts/hex-announce.mjs --send <gameId>');
      return;
    }
    await sendGame(id);
    return;
  }
  if (!LOOP) {
    await once();
    return;
  }
  const roster = loadRoster(ROSTER);
  const interval = Math.max(60, roster.announce.pollSeconds || 180) * 1000;
  log(`常驻模式（待确认），每 ${interval / 1000}s 一轮`);
  for (;;) {
    await once();
    await new Promise((r) => setTimeout(r, interval));
  }
}

main().catch((e) => {
  log(`出错: ${e.message}`);
  process.exit(1);
});
