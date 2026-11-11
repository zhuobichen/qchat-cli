/**
 * QQ 连接体检：判断"到底通不通"。
 *
 * 为什么需要：一直用 get_status.online 当判据，但它刚登录后的一段时间
 * 就是 false（实测 online:false 的时候群消息照样在进）。据此判断会得出
 * "挂了"，然后多余地重启一次，把正常状态搞乱。
 *
 * 真正的判据是「能不能完成一个需要真实会话的操作」：
 *   半死状态下 get_friend_list 会超时，而 get_group_msg_history 还能读——
 *   所以 friend_list 才是那个能区分"活"和"半死"的探针。
 *
 * 退出码：0 正常 / 1 半死 / 2 未启动
 *
 * 用法：node scripts/qq-health.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const GROUP = 913807639;
const JSON_OUT = process.argv.includes('--json');

function token() {
  const p = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
  } catch {
    return '';
  }
}

const TOKEN = token();

async function api(action, params = {}, timeoutMs = 8000) {
  const started = Date.now();
  try {
    const res = await fetch(`http://127.0.0.1:3000/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json();
    return { ok: j?.status === 'ok', data: j?.data, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, error: String(e?.name === 'TimeoutError' ? 'timeout' : e?.message ?? e), ms: Date.now() - started };
  }
}

/** 端口有没有在监听（用 curl 探，避免依赖 net 模块的权限） */
function portListening() {
  try {
    const out = execFileSync('curl', ['-s', '-m', '3', '-o', 'NUL', '-w', '%{http_code}', 'http://127.0.0.1:3000/'], {
      encoding: 'utf8',
      timeout: 6000,
    });
    // OneBot 对 GET / 返回 404/405 都算"端口通"，000 才是没通
    return out !== '000' && out !== '';
  } catch {
    return false;
  }
}

function procCount(name) {
  // 不用 tasklist /FI：经 cmd 传参时引号会被吃掉，过滤器报 "无效参数 - eq"。
  // 直接列全部再数，慢一点但不会错。
  try {
    const out = execFileSync('tasklist', ['/NH'], { encoding: 'utf8', timeout: 15000 });
    return (out.match(new RegExp(name.replace(/[.]/g, '\\.'), 'gi')) || []).length;
  } catch {
    return 0;
  }
}

function logAge(file) {
  try {
    const st = fs.statSync(file);
    return Math.round((Date.now() - st.mtimeMs) / 1000);
  } catch {
    return null;
  }
}

async function main() {
  const r = { at: new Date().toISOString(), checks: {}, verdict: '', advice: '' };

  r.checks.port = portListening();
  // 进程数先取，保证任何分支下 finish 都有值可读
  r.checks.processes = { QQ: procCount('QQ.exe'), NapCat: procCount('NapCatWinBootMain.exe') };
  if (!r.checks.port) {
    r.verdict = 'down';
    r.advice = 'NapCat 没启动或 :3000 没监听 → 跑 start-napcat-admin-fixed.cmd';
    return finish(r, 2);
  }

  const login = await api('get_login_info');
  r.checks.login = login.ok ? { user: login.data?.nickname, uin: login.data?.user_id, ms: login.ms } : { error: login.error };

  // 关键探针：需要真实会话才会返回
  const friends = await api('get_friend_list', {}, 8000);
  r.checks.friendList = friends.ok
    ? { count: (friends.data ?? []).length, ms: friends.ms }
    : { error: friends.error, ms: friends.ms };

  // count 小的时候 NapCat 会返回空数组（实测 1/2 空、5 才有内容）（不是"没消息"），最少要 2 条才有内容。
  // 踩过：这一条让体检在明明有消息时也报「群消息为空」，看着像链路瘫了。
  const hist = await api('get_group_msg_history', { group_id: GROUP, count: 10, reverseOrder: true });
  if (hist.ok) {
    const list = (hist.data?.messages ?? []).slice().sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
    const m = list[0];
    const ts = m ? m.time * 1000 : 0;
    r.checks.latestMessage = ts
      ? { at: new Date(ts).toISOString(), ageSec: Math.round((Date.now() - ts) / 1000) }
      : { note: '群消息为空' };
  } else {
    r.checks.latestMessage = { error: hist.error };
  }

  const status = await api('get_status');
  r.checks.onlineFlag = status.ok ? status.data?.online : undefined;

  // 监视器可能跑在 v2（独立 state/log）上，取两个日志里更新的那个，
  // 不然会拿一份早就没人写的旧日志算"多久没动"。
  const ages = ['qq-watch.log', 'qq-watch-v2.log']
    .map((f) => logAge(path.join(process.cwd(), 'output', f)))
    .filter((n) => n !== null);
  r.checks.watcherLogAgeSec = ages.length ? Math.min(...ages) : null;

  // 判定：不看 online 标志，看 friend_list 通不通
  if (r.checks.friendList?.error) {
    r.verdict = 'half-dead';
    r.advice = `会话半死（friend_list ${r.checks.friendList.error}，但历史还能读）→ 重启 NapCat`;
    return finish(r, 1);
  }
  if (!r.checks.login?.user) {
    r.verdict = 'down';
    r.advice = 'get_login_info 拿不到账号 → 没登录，需要扫码';
    return finish(r, 2);
  }
  r.verdict = 'healthy';
  r.advice = '正常。注意 online 标志可能是 false，那是它滞后，不是故障。';
  return finish(r, 0);
}

function finish(r, code) {
  if (JSON_OUT) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    const icon = { healthy: '✅', 'half-dead': '⚠️', down: '❌' }[r.verdict] ?? '?';
    console.log(`${icon} ${r.verdict}`);
    console.log(`  端口 :3000      ${r.checks.port ? '通' : '不通'}`);
    console.log(`  账号            ${r.checks.login?.user ?? r.checks.login?.error ?? '?'}`);
    console.log(`  好友列表        ${r.checks.friendList?.error ? '超时/失败（半死信号）' : (r.checks.friendList?.count ?? '?') + ' 个 ✅'}`);
    const lm = r.checks.latestMessage;
    console.log(`  最新群消息      ${lm?.error ? lm.error : lm?.at ? `${new Date(lm.at).toLocaleTimeString('zh-CN', { hour12: false })}（${Math.round(lm.ageSec / 60)} 分钟前）` : lm?.note ?? '?'}`);
    console.log(`  online 标志     ${r.checks.onlineFlag}  ← 仅供参考，滞后`);
    const pr = r.checks.processes ?? {};
    console.log(`  进程            QQ ${pr.QQ ?? '?'} / NapCat ${pr.NapCat ?? '?'}`);
    console.log(`  监视器日志      ${r.checks.watcherLogAgeSec === null ? '无' : r.checks.watcherLogAgeSec + ' 秒前'}`);
    console.log(`\n  ${r.advice}`);
  }
  process.exit(code);
}

main().catch((e) => {
  console.error('体检脚本自己出错:', e.message);
  process.exit(3);
});
