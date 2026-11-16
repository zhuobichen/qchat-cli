// 扫码守望：等 QQ 登录成功，自动验证并落一份状态文件。
//
// 为什么需要：每次扫码之后都要人提醒我「扫完了」，我再手动跑一遍体检——
// 这个等待完全是机械的。脚本在这里盯着就行：登录态一出现，
// 它把健康检查、群列表、名片、常驻进程全跑一遍写进状态文件，
// 我（或任何人）读那一份就知道结果，不用再问「扫好了吗」。
//
// 运行环境：必须在 host_exec 下跑（要读 ~/.qchat-cli 的配置、进程；沙箱读不到宿主机进程）。
//
// 用法：
//   node scripts/watch-login.cjs                # 盯 10 分钟，登录成功即退出
//   node scripts/watch-login.cjs --timeout 1800 # 自定义秒数
//   node scripts/watch-login.cjs --once         # 只查一次当前状态

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SELF = 2396130865;
const OUT = path.join(ROOT, 'output', 'login-watch.json');
const LOG = path.join(ROOT, 'output', 'login-watch.log');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const TIMEOUT = Number(arg('--timeout', 600));
const ONCE = argv.includes('--once');

function log(line) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const s = `[${new Date().toLocaleString('zh-CN')}] ${line}`;
  fs.appendFileSync(LOG, s + '\n', 'utf8');
  console.log(s);
}

function token() {
  // 三个来源都要试：env → NapCat 配置 → 兜底常量。
  // 踩过：配置读不到时发了空 Bearer，服务端 401，脚本报「没登录」，
  // 而过一会儿人再跑又好了——看起来像"登录慢"，其实是自己的鉴权漏了。
  if (process.env.QCE_TOKEN) return process.env.QCE_TOKEN;
  try {
    const cfgDir = path.join(process.env.USERPROFILE || process.env.HOME, '.qchat-cli', 'NapCat.Shell', 'config');
    for (const f of fs.readdirSync(cfgDir)) {
      if (!f.startsWith('onebot11')) continue;
      const j = JSON.parse(fs.readFileSync(path.join(cfgDir, f), 'utf8'));
      const t = j?.network?.httpServers?.[0]?.token;
      if (t) return t;
    }
  } catch { /* 落到兜底 */ }
  return '75277e324f924d73255a5d0b77543e035af0e509bc7d7559';
}

function call(action, body = {}) {
  const tk = token();
  return new Promise((resolve) => {
    const raw = JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port: 3000, path: '/' + action, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + tk,
        'Content-Length': Buffer.byteLength(raw),
      },
    }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(raw); req.end();
  });
}

/** 判定登录是否成功：看好友列表能不能拿到（online 标志会骗人，不用它） */
async function probe() {
  const info = await call('get_login_info');
  const friends = await call('get_friend_list');
  const groups = await call('get_group_list');
  const ok = info?.status === 'ok' && friends?.status === 'ok'
    && Array.isArray(friends.data) && friends.data.length > 0;
  return {
    ok,
    account: info?.data?.nickname ? `${info.data.nickname}(${info.data.user_id})` : null,
    friends: Array.isArray(friends?.data) ? friends.data.length : null,
    groups: Array.isArray(groups?.data) ? groups.data.map((g) => `${g.group_id} ${g.group_name}`) : null,
  };
}

function watchdogs() {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.CommandLine }",
    ], { encoding: 'utf8', timeout: 20000 });
    const keys = ['qq-watch.mjs', 'qq-watchdog.mjs', 'qq-poke-watch.mjs', 'diary-scheduler.mjs'];
    const seen = {};
    for (const k of keys) seen[k] = out.includes(k);
    return seen;
  } catch { return null; }
}

function writeState(payload) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

(async () => {
  const started = Date.now();
  log(`开始盯扫码：最长 ${TIMEOUT} 秒${ONCE ? '（只查一次）' : ''}`);

  for (;;) {
    const p = await probe();
    if (p.ok || ONCE) {
      const wd = watchdogs();
      const state = {
        at: new Date().toISOString(),
        waitedSec: Math.round((Date.now() - started) / 1000),
        ok: p.ok,
        account: p.account,
        friends: p.friends,
        groups: p.groups,
        residents: wd,
      };
      writeState(state);
      log(p.ok
        ? `✅ 登录成功：${p.account}，好友 ${p.friends} 个，群 ${state.groups.length} 个`
        : `❌ 仍然没登录（好友列表拿不到）`);
      if (wd) {
        const dead = Object.entries(wd).filter(([, v]) => !v).map(([k]) => k);
        log(dead.length ? `⚠ 常驻进程缺：${dead.join(', ')}` : '常驻进程都在');
      }
      if (p.groups) for (const g of state.groups) log('  群 ' + g);
      log('状态已写入 output/login-watch.json');
      process.exit(p.ok ? 0 : 1);
    }
    if ((Date.now() - started) / 1000 > TIMEOUT) {
      writeState({ at: new Date().toISOString(), ok: false, reason: 'timeout' });
      log('⏱ 超时，仍未见登录态');
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
})();
