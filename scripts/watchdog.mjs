/**
 * NapCat 看门狗：检测 QQ 掉线并尝试自愈。
 *
 * 为什么需要：掉线时 NapCat 进程还在、API 还能应答缓存信息，
 * 只有 get_status.online 会变 false。表现是「进程活着、日志在滚、
 * 但一条消息都收不到」——今晚就撞上一次（22:45 掉线，23:18 才发现）。
 *
 * 自愈策略：
 *   1. online=true        → 清计数，退出
 *   2. 连续离线 < 阈值     → 只记日志，等它自己重连（QQ 有时会自恢复）
 *   3. 连续离线 >= 阈值    → 杀掉 QQ，用 -q 快速登录重启（有会话就不用扫码）
 *   4. 重启多次仍离线      → 写 ALERT 文件，说明需要人工扫码
 *
 * 用法（通常由计划任务每 5 分钟调一次）：
 *   node scripts/watchdog.mjs            # 单次检查
 *   node scripts/watchdog.mjs --status   # 看状态
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, 'private', '.watchdog');
const STATE_PATH = join(STATE_DIR, 'state.json');
const LOG_PATH = join(ROOT, 'output', 'watchdog.log');
const ALERT_PATH = join(ROOT, 'output', 'NAPCAT-OFFLINE-ALERT.txt');

const UIN = process.env.QCE_UIN ?? '2396130865';
const PORT = Number(process.env.QCE_ONEBOT_PORT ?? 3000);
/** 连续离线多少轮才重启（每轮由计划任务间隔决定，默认 5 分钟） */
const RESTART_AFTER = Number(process.env.QCE_WATCHDOG_RESTART_AFTER ?? 2);
/** 累计重启多少次后放弃并报警 */
const MAX_RESTARTS = Number(process.env.QCE_WATCHDOG_MAX_RESTARTS ?? 3);

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    appendFileSync(LOG_PATH, line + '\n', 'utf8');
  } catch { /* 写不进就算了 */ }
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { offlineCount: 0, restarts: 0, lastCheck: 0, lastOnline: 0 };
  }
}

function saveState(s) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/** 读 OneBot token */
function readToken() {
  const candidates = [
    join(homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', `onebot11_${UIN}.json`),
  ];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf8'));
      const t = cfg?.network?.httpServers?.[0]?.token;
      if (t) return String(t);
    } catch { /* 下一个 */ }
  }
  return process.env.QCE_ONEBOT_TOKEN ?? '';
}

async function getStatus(token) {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/get_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { reachable: true, online: false, httpCode: res.status };
    const json = await res.json();
    return { reachable: true, online: json?.data?.online === true };
  } catch {
    // 连不上 = NapCat 进程没了，比"离线"更严重
    return { reachable: false, online: false };
  }
}

/** 杀掉所有 QQ 进程（需要权限；低权限会失败，那就只能人工） */
function killQQ() {
  const r = spawnSync('taskkill', ['/F', '/IM', 'QQ.exe'], { encoding: 'utf8' });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

/** 用快速登录重启 NapCat（有会话就不需要扫码） */
function restartNapCat() {
  const cli = join(ROOT, 'dist', 'cli.js');
  if (!existsSync(cli)) return 'dist/cli.js 不存在，先 npm run build';
  const r = spawnSync(process.execPath, [cli, 'napcat', 'start', '-q', UIN], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  return `exit=${r.status} ${(r.stdout ?? '').slice(0, 200)}`;
}

function writeAlert(text) {
  try {
    mkdirSync(join(ROOT, 'output'), { recursive: true });
    writeFileSync(ALERT_PATH, `${new Date().toISOString()}\n${text}\n`, 'utf8');
  } catch { /* ignore */ }
}

function clearAlert() {
  try {
    if (existsSync(ALERT_PATH)) writeFileSync(ALERT_PATH, '', 'utf8');
  } catch { /* ignore */ }
}

// ————— 主流程 —————
const state = loadState();
const token = readToken();
const st = await getStatus(token);
state.lastCheck = Date.now();

if (process.argv.includes('--status')) {
  console.log(JSON.stringify({ ...state, online: st.online, reachable: st.reachable }, null, 2));
  process.exit(0);
}

if (st.online) {
  if (state.offlineCount > 0) {
    log(`[恢复] 重新在线（之前连续离线 ${state.offlineCount} 轮，重启过 ${state.restarts} 次）`);
  }
  state.offlineCount = 0;
  state.restarts = 0;
  state.lastOnline = Date.now();
  clearAlert();
  saveState(state);
  process.exit(0);
}

// —— 离线 ——
state.offlineCount += 1;
const how = st.reachable ? 'API 可达但 online=false' : `API 不可达（NapCat 进程可能已退）`;
log(`[离线] 第 ${state.offlineCount} 轮：${how}`);

if (state.offlineCount < RESTART_AFTER) {
  saveState(state);
  process.exit(0);
}

if (state.restarts >= MAX_RESTARTS) {
  const msg =
    `NapCat 连续离线 ${state.offlineCount} 轮，已重启 ${state.restarts} 次仍无效。\n` +
    `需要人工处理：右键管理员运行 start-napcat-admin.cmd，扫码重新登录。`;
  log(`[报警] ${msg.replace(/\n/g, ' ')}`);
  writeAlert(msg);
  saveState(state);
  process.exit(1);
}

log(`[自愈] 尝试第 ${state.restarts + 1}/${MAX_RESTARTS} 次重启…`);
const k = killQQ();
log(`  taskkill: ${k.trim().split('\n')[0] ?? '(无输出)'}`);
const r = restartNapCat();
log(`  restart: ${r}`);
state.restarts += 1;
state.offlineCount = 0;   // 重启后重新计数，给新实例一点时间
saveState(state);

log(`[自愈] 重启已发出，下一轮检查结果`);
