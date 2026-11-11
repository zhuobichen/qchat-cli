/**
 * QQ 看门狗：定时体检，发现半死就自动重启，并把每次掉线记下来。
 *
 * 为什么需要：
 *   1. 现有证据显示会话会在登录后 1.5~2.5 小时左右静默失效
 *      （18:09 登录 → 20:30 死；20:51 登录 → 22:22 死）。
 *      具体原因还没定位，但可以先做到"自动恢复 + 留证据"。
 *   2. 之前的监视器日志被我重定向到同一文件时截断了，
 *      掉线历史全丢。所以这里每次判断都写进独立的 csv，只追加不覆盖。
 *
 * 判定用 qq-health 的同一套逻辑：friend_list 通不通，而不是 online 标志。
 *
 * 用法：
 *   node scripts/qq-watchdog.mjs            常驻，默认每 120 秒查一次
 *   node scripts/qq-watchdog.mjs --dry      只体检，不重启
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const ONCE = process.argv.includes('--once');
const INTERVAL = Number(process.env.QCE_WD_INTERVAL ?? 120) * 1000;
const ROOT = process.cwd();
const CSV = path.join(ROOT, 'output', 'qq-drops.csv');
const LOG = path.join(ROOT, 'output', 'qq-watchdog.log');
const NAPCAT_CFG = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');

function token() {
  try {
    return JSON.parse(fs.readFileSync(NAPCAT_CFG, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
  } catch {
    return '';
  }
}
const TOKEN = token();

async function api(action, params = {}, timeoutMs = 8000) {
  try {
    const res = await fetch(`http://127.0.0.1:3000/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json();
    return { ok: j?.status === 'ok', data: j?.data };
  } catch (e) {
    return { ok: false, error: String(e?.name === 'TimeoutError' ? 'timeout' : e?.message ?? e) };
  }
}

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + '\n', 'utf8');
  } catch {
    /* 写不进日志不影响主流程 */
  }
}

/**
 * 一次判定：返回 healthy / half-dead / down
 *
 * ⚠️ 判据不能只看「请求有没有报错」。2026-11-11 实测两个反例：
 *   1. get_friend_list 请求成功但返回空数组 —— 这个号固定有 2 个好友（号主和自己），
 *      变成 0 说明账号数据层已经挂了，可当时判成了 healthy，于是没重启，后来真掉线。
 *   2. get_group_member_info 返回 null —— 群成员拉不到，说明 NTQQ 内核的事件回调断了
 *      （日志里是 EventChecker Failed / fetchUserDetailInfo Timeout）。
 * 这两条都是「请求成功但拿不到数据」，比报错更隐蔽。
 */
async function health() {
  const login = await api('get_login_info');
  if (!login.ok) return { verdict: 'down', detail: 'get_login_info 失败' };

  const friends = await api('get_friend_list', {}, 8000);
  if (friends.error) return { verdict: 'half-dead', detail: `friend_list ${friends.error}` };
  const friendCount = (friends.data ?? []).length;

  // 好友列表空 = 数据层挂了（本号固定有 2 个：号主 + 自己）
  if (friendCount === 0) {
    return { verdict: 'half-dead', detail: 'friend_list 返回空（账号数据层已挂）' };
  }

  // 群成员拉不到 = NTQQ 内核事件回调断了
  const member = await api('get_group_member_info', { group_id: 913807639, user_id: 1473517806 }, 8000);
  if (member.ok && !member.data) {
    return { verdict: 'half-dead', detail: 'group_member_info 返回 null（内核回调可能已断）' };
  }

  const hist = await api('get_group_msg_history', { group_id: 913807639, count: 1 });
  const ts = hist.ok ? (hist.data?.messages ?? [])[0]?.time * 1000 : 0;
  return {
    verdict: 'healthy',
    detail: `friends=${friendCount}`,
    latestMessageAgeMin: ts ? Math.round((Date.now() - ts) / 60000) : null,
  };
}

/** 重启 NapCat：走 .launch-napcat.cmd（用 8.3 短路径，避开 cmd 的中文路径解码问题） */
function restartNapCat() {
  const shortProj = 'D:\\GITHUB~1\\ZHAOWE~1\\QCHAT-~1';
  const script = path.join(ROOT, '.launch-napcat.cmd');
  if (!fs.existsSync(script)) return { ok: false, error: '.launch-napcat.cmd 不存在' };
  try {
    // 用 cmd /c 调短路径，避免中文路径在 GBK 代码页下被解错
    const r = spawnSync('cmd', ['/c', `${shortProj}\\.launch-napcat.cmd`], { timeout: 90_000, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout ?? '').slice(0, 200), err: (r.stderr ?? '').slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 120) };
  }
}

function csv(rec) {
  if (!fs.existsSync(CSV)) {
    fs.writeFileSync(CSV, 'at,verdict,detail,action\n', 'utf8');
  }
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  fs.appendFileSync(CSV, [new Date().toISOString(), esc(rec.verdict), esc(rec.detail), esc(rec.action)].join(',') + '\n', 'utf8');
}

/**
 * 重启后还是要扫码 → 主动把二维码推到号主那儿。
 *
 * 为什么要做：重启只能救"进程挂了"，救不了"登录失效"。
 * 而登录失效以后，如果没人知道要扫码，这号就一直躺着——
 * 19:49 那次就是这么白白断了半小时，靠人工发现。
 */
const QR_SRC = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'cache', 'qrcode.png');
const QR_OUT = path.join(ROOT, 'output', 'login-qr.png');
const OWNER = 1473517806;

function notifyNeedScan() {
  if (!fs.existsSync(QR_SRC)) return false;
  try {
    fs.copyFileSync(QR_SRC, QR_OUT);
  } catch (e) {
    log(`复制二维码失败: ${e.message}`);
    return false;
  }
  const shortProj = 'D:\\GITHUB~1\\ZHAOWE~1\\QCHAT-~1';
  const send = (args) =>
    spawnSync('cmd', ['/c', `cd /d ${shortProj} && node dist\\cli.js ${args}`], { timeout: 60_000, encoding: 'utf8' });
  send(`say user:${OWNER} "QQ 掉线了，要重新扫码。二维码在下面，扫完自己会连上。"`);
  send(`pic user:${OWNER} output/login-qr.png`);
  log('已把二维码私聊推给号主');
  return true;
}

async function tick() {
  const h = await health();
  if (h.verdict === 'healthy') {
    // 只在每 30 分钟记一次正常状态，避免 csv 膨胀
    const now = Date.now();
    if (!tick.lastOkLog || now - tick.lastOkLog > 30 * 60_000) {
      log(`健康（${h.detail}，最新消息 ${h.latestMessageAgeMin ?? '?'} 分钟前）`);
      csv({ ...h, action: 'none' });
      tick.lastOkLog = now;
    } else {
      console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] 健康（${h.detail}）`);
    }
    tick.fails = 0;
    return;
  }

  log(`⚠ ${h.verdict}：${h.detail}`);
  if (DRY) {
    log('[dry] 本该重启');
    csv({ ...h, action: 'dry' });
    return;
  }
  log('正在重启 NapCat ...');
  const r = restartNapCat();
  csv({ ...h, action: r.ok ? 'restarted' : 'restart-failed:' + (r.error ?? r.err ?? '') });
  log(r.ok ? '重启命令已发出，等 40 秒再确认' : `重启失败: ${r.error ?? r.err}`);
  await new Promise((res) => setTimeout(res, 40_000));
  const h2 = await health();
  log(`重启后：${h2.verdict}（${h2.detail}）`);
  csv({ ...h2, action: 'post-restart-check' });

  if (h2.verdict !== 'healthy') {
    tick.fails = (tick.fails ?? 0) + 1;
    // 重启救不了的事只有一件：登录失效。这时候再重启只会越搞越乱
    // （多开/反复拉起会让 QQ 服务端判定异常，反而更容易被踢）。
    if (tick.fails <= 2) notifyNeedScan();
    else log(`连续 ${tick.fails} 次没起来，不再自动重启（避免把登录态搞坏），等人工处理`);
  } else {
    tick.fails = 0;
  }
}

async function main() {
  log(`看门狗启动：${ONCE ? '单次模式' : `每 ${INTERVAL / 1000} 秒体检一次`}${DRY ? '（dry 模式，不重启）' : ''}`);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      log(`体检出错: ${e.message}`);
    }
    if (DRY || ONCE) return;
    // 连着重启不起来就把间隔拉到 10 分钟：这时候缺的是人，不是次数
    const wait = (tick.fails ?? 0) > 2 ? Math.max(INTERVAL, 600_000) : INTERVAL;
    await new Promise((r) => setTimeout(r, wait));
  }
}

main().catch((e) => {
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
