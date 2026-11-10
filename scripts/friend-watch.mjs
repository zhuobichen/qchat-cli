#!/usr/bin/env node
/**
 * friend-watch —— 盯一个 QQ 号有没有被加成好友。
 *
 * 为什么只能轮询：NapCat 没有"好友申请列表"这个 API
 * （实测 get_friend_request_list 直接回「不支持的Api」）。
 * 所以判据只能是：目标号有没有出现在 get_friend_list 里。
 * 没出现就继续等；超时就报「还没通过/可能被拒」。
 *
 * 为什么自己写日志：用 host_exec detach 起的进程 stdout 会被丢弃（实测日志恒为 0 字节），
 * 所以所有事件都同时 append 到 output/friend-watch.log。
 *
 * 用法：
 *   node scripts/friend-watch.mjs --uin 1441816738
 *   node scripts/friend-watch.mjs --uin 1441816738 --interval 30 --timeout 3600 --notify
 *   --timeout 0 表示一直盯到天亮
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes('--' + name);

const UIN = String(arg('uin', '')).trim();
if (!/^\d{5,12}$/.test(UIN)) {
  console.log('用法: node scripts/friend-watch.mjs --uin <QQ号> [--interval 30] [--timeout 3600] [--notify]');
  process.exit(1);
}
const INTERVAL = Math.max(10, Number(arg('interval', 30)) || 30);
const TIMEOUT = Math.max(0, Number(arg('timeout', 3600)) || 0); // 0 = 无限
const NOTIFY = flag('notify');
const OWNER = String(arg('owner', '1473517806'));

const ROOT = process.cwd();
const LOG = path.join(ROOT, 'output', 'friend-watch.log');
const STATE = path.join(ROOT, 'output', 'friend-watch.json');
const CFG = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + '\n', 'utf8');
  } catch {
    /* 日志写不进去不影响监控 */
  }
}

function token() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    return cfg?.network?.httpServers?.[0]?.token ?? '';
  } catch {
    return '';
  }
}

async function api(action, body = {}) {
  const res = await fetch('http://127.0.0.1:3000/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

function save(state) {
  try {
    fs.writeFileSync(STATE, JSON.stringify({ uin: UIN, ...state, at: Date.now() }, null, 2), 'utf8');
  } catch {}
}

async function friendList() {
  const r = await api('get_friend_list');
  return Array.isArray(r?.data) ? r.data : [];
}

async function notifyOwner(text) {
  if (!NOTIFY) return;
  try {
    await api('send_private_msg', { user_id: Number(OWNER), message: text });
    log('已私聊房主');
  } catch (e) {
    log('私聊房主失败: ' + (e?.message || e));
  }
}

const started = Date.now();
log(`开始盯 ${UIN}，每 ${INTERVAL}s 查一次${TIMEOUT ? `，最多 ${Math.round(TIMEOUT / 60)} 分钟` : '，不限时'}`);

let lastCount = -1;
let loops = 0;

for (;;) {
  loops += 1;
  let list = [];
  try {
    list = await friendList();
  } catch (e) {
    log(`查询失败（第 ${loops} 轮）: ${(e?.message || String(e)).slice(0, 60)}，${INTERVAL}s 后重试`);
    save({ status: 'error', loops, error: String(e?.message || e).slice(0, 120) });
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
    continue;
  }

  const hit = list.find((f) => String(f.user_id) === UIN);
  if (hit) {
    log(`✅ 已通过：${hit.nickname || ''}${hit.remark ? ' / 备注 ' + hit.remark : ''}（好友数 ${list.length}）`);
    save({ status: 'accepted', nickname: hit.nickname || '', total: list.length });
    await notifyOwner(`加好友通过：${hit.nickname || UIN}（${UIN}）。当前好友 ${list.length} 个。`);
    process.exit(0);
  }

  if (list.length !== lastCount) {
    log(`好友数 ${list.length}（目标 ${UIN} 还不在列表里）`);
    lastCount = list.length;
  }
  save({ status: 'pending', loops, total: list.length });

  if (TIMEOUT && Date.now() - started > TIMEOUT * 1000) {
    log(`⏱ 等了 ${Math.round((Date.now() - started) / 60000)} 分钟仍未通过——对方没点、或点了拒绝。`);
    save({ status: 'timeout', loops, total: list.length });
    await notifyOwner(`加好友超时：${UIN} 一直没通过（等了 ${Math.round((Date.now() - started) / 60000)} 分钟）。`);
    process.exit(2);
  }

  await new Promise((r) => setTimeout(r, INTERVAL * 1000));
}
