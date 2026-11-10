/**
 * 凑人监听：群里陆续有人说"要打"，凑够 N 个人就私聊房主。
 *
 * 为什么需要脚本而不是我盯：我可能不在线、可能在忙别的。
 * 这个脚本常驻轮询，只做一件事——数人头。
 *
 * 判据（有意写得松，宁可多报不能漏报）：
 *   1. 最近 WINDOW 分钟内的群消息
 *   2. 每条消息里有"想打"的信号词（来/打/上号/可打/算我一个…）
 *   3. 按发送人去重（同一个人说十句只算一个）
 *   4. 排除房主自己（他本来就在等）和机器人自己
 *   5. 凑够 THRESHOLD 个不同的人 → 私聊房主
 *
 * 防刷屏：同一次凑人只提醒一次，冷却 COOLDOWN 分钟。
 *
 * 用法：
 *   node scripts/party-watch.mjs          常驻
 *   node scripts/party-watch.mjs --dry    只打印判断，不私聊、不写状态
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CFG_PATH = path.join(process.cwd(), 'private', 'qq-watch.config.json');
const ROSTER = path.join(process.cwd(), 'private', 'hex-roster.json');
const STATE = path.join(process.cwd(), 'private', '.party-state.json');

const GROUP = 913807639;
const OWNER = 1473517806;          // 房主：凑齐了通知他
const SELF = 2396130865;           // 机器人自己
const THRESHOLD = 3;               // 除房主外，多少人说要打算"凑齐"
const WINDOW_MIN = 90;             // 只看最近 90 分钟的话
const COOLDOWN_MIN = 60;           // 提醒后 60 分钟内不重复提醒
const POLL_SEC = 45;

const DRY = process.argv.includes('--dry');

// 想打的信号词。宁可多收：误报只是多一条私聊，漏报就错过一局。
const YES = [
  '来', '打', '上号', '可打', '能打', '可以', '算我一个', '我一个',
  '开车', '等我', '在路', '马上', '回去', '上线', '开黑', '组', '凑',
];
// 明确的否定，命中就当没说过（"不打""不来了"）
const NO = ['不打', '不来', '不了', '算了', '没空', '不在', '明天', '下次'];

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`);
}

function loadJson(p, dflt) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
}

function onebotToken() {
  const cfg = loadJson(CFG_PATH, {});
  if (cfg.token) return { token: cfg.token, http: cfg.http ?? 'http://127.0.0.1:3000' };
  // 退回去读 NapCat 自己的配置
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const p = path.join(home, '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
  const nc = loadJson(p, {});
  return {
    token: nc?.network?.httpServers?.[0]?.token ?? '',
    http: 'http://127.0.0.1:3000',
  };
}

async function api(action, params) {
  const { token, http } = onebotToken();
  const res = await fetch(`${http}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20_000),
  });
  return res.json();
}

/** 一个人说要打？先排除否定词 */
function saysYes(text) {
  if (NO.some((n) => text.includes(n))) return false;
  return YES.some((y) => text.includes(y));
}

async function pollOnce() {
  const d = await api('get_group_msg_history', { group_id: GROUP, count: 40 });
  const msgs = d?.data?.messages ?? [];
  const since = Date.now() - WINDOW_MIN * 60_000;

  const yes = new Map(); // qq -> {name, at, text}
  for (const m of msgs) {
    const t = (m.time ?? 0) * 1000;
    if (t < since) continue;
    const uid = Number(m.sender?.user_id ?? 0);
    if (uid === SELF || uid === OWNER) continue;
    const text = (m.message ?? [])
      .filter((s) => s.type === 'text')
      .map((s) => s.data?.text ?? '')
      .join('');
    if (!text) continue;
    if (!saysYes(text)) continue;
    const name = m.sender?.card || m.sender?.nickname || String(uid);
    const prev = yes.get(uid);
    if (!prev || t > prev.at) yes.set(uid, { name, at: t, text: text.slice(0, 30) });
  }

  return { yes, total: msgs.length };
}

async function main() {
  log(`凑人监听启动：除房主外满 ${THRESHOLD} 人说打就私聊他（窗口 ${WINDOW_MIN} 分钟）`);
  const state = loadJson(STATE, { alertedAt: 0 });

  for (;;) {
    try {
      const { yes } = await pollOnce();
      const names = [...yes.values()].map((v) => v.name);
      log(`愿意打的 ${yes.size} 人${names.length ? '：' + names.join('、') : ''}`);

      const cooled = Date.now() - (state.alertedAt ?? 0) > COOLDOWN_MIN * 60_000;
      if (yes.size >= THRESHOLD && cooled) {
        const detail = [...yes.values()].map((v) => `  · ${v.name}：${v.text}`).join('\n');
        const body =
          `凑齐了：${names.join('、')} 都说要打，加上你正好 ${yes.size + 1} 个\n\n${detail}`;
        if (DRY) {
          log(`[dry] 本该私聊房主：\n${body}`);
        } else {
          const r = await api('send_private_msg', { user_id: OWNER, message: body });
          log(`已私聊房主（${r?.status ?? '?'}）`);
          state.alertedAt = Date.now();
          fs.writeFileSync(STATE, JSON.stringify(state, null, 2), 'utf8');
        }
      }
    } catch (e) {
      log(`轮询失败: ${e.message}`);
    }

    if (DRY) return;
    await new Promise((r) => setTimeout(r, POLL_SEC * 1000));
  }
}

main().catch((e) => {
  log(`出错: ${e.message}`);
  process.exit(1);
});
