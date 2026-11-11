#!/usr/bin/env node
/**
 * friend-watch —— 盯若干个 QQ 号有没有被加成好友（支持同时盯多个）。
 *
 * 为什么只能轮询：NapCat 没有"好友申请列表"这个 API
 * （实测 get_friend_request_list 直接回「不支持的Api」）。
 * 所以判据只能是：目标号有没有出现在 get_friend_list 里。
 *
 * 为什么自己写日志：用 host_exec detach 起的进程 stdout 会被丢弃（实测日志恒为 0 字节）。
 *
 * 为什么每个号一个状态文件：只用一个状态文件时，两个号各起一个进程会互相覆盖，
 * 表现就是"明明在盯 A，文件里写的是 B"（踩过）。
 *
 * 用法：
 *   node scripts/friend-watch.mjs --uin 1004416001
 *   node scripts/friend-watch.mjs --uin 1004416001,1441816738 --interval 30 --notify
 *   --timeout 0 表示一直盯
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

// --uin 可以重复给，也可以逗号分隔
const UINS = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--uin' && argv[i + 1]) {
    for (const u of String(argv[i + 1]).split(',')) {
      const t = u.trim();
      if (/^\d{5,12}$/.test(t) && !UINS.includes(t)) UINS.push(t);
    }
  }
}
if (!UINS.length) {
  console.log('用法: node scripts/friend-watch.mjs --uin <QQ号>[,<QQ号>...] [--interval 30] [--timeout 3600] [--notify]');
  process.exit(1);
}

const INTERVAL = Math.max(10, Number(arg('interval', 30)) || 30);
const TIMEOUT = Math.max(0, Number(arg('timeout', 3600)) || 0);
const NOTIFY = flag('notify');
const OWNER = String(arg('owner', '1473517806'));

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'output');
const LOG = path.join(OUT, 'friend-watch.log');
const STATE_DIR = path.join(OUT, 'friend-watch');
const CFG = path.join(os.homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');

function log(msg) {
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + '\n', 'utf8');
  } catch {}
}

function token() {
  try {
    return JSON.parse(fs.readFileSync(CFG, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
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

function saveState(uin, state) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, `${uin}.json`), JSON.stringify({ uin, ...state, at: Date.now() }, null, 2), 'utf8');
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
const pending = new Set(UINS);
log(`开始盯 ${UINS.join(' / ')}，每 ${INTERVAL}s 查一次${TIMEOUT ? `，最多 ${Math.round(TIMEOUT / 60)} 分钟` : '，不限时'}`);

let loops = 0;

for (;;) {
  loops += 1;
  let list = [];
  try {
    list = await friendList();
  } catch (e) {
    log(`查询失败（第 ${loops} 轮）: ${(e?.message || String(e)).slice(0, 60)}`);
    for (const u of pending) saveState(u, { status: 'error', loops });
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
    continue;
  }

  const total = list.length;
  for (const uin of [...pending]) {
    const hit = list.find((f) => String(f.user_id) === uin);
    if (hit) {
      pending.delete(uin);
      log(`✅ ${uin} 已通过：${hit.nickname || ''}${hit.remark ? ' / 备注 ' + hit.remark : ''}（好友数 ${total}）`);
      saveState(uin, { status: 'accepted', nickname: hit.nickname || '', total });
      await notifyOwner(`加好友通过：${hit.nickname || uin}（${uin}）。当前好友 ${total} 个。`);
    } else {
      saveState(uin, { status: 'pending', loops, total });
    }
  }

  if (!pending.size) {
    log(`全部通过，退出（共 ${loops} 轮，好友 ${total} 个）`);
    process.exit(0);
  }

  if (loops === 1 || loops % 10 === 0) {
    log(`仍待通过：${[...pending].join(' / ')}（好友数 ${total}）`);
  }

  if (TIMEOUT && Date.now() - started > TIMEOUT * 1000) {
    log(`⏱ 超时未通过：${[...pending].join(' / ')}`);
    for (const u of pending) saveState(u, { status: 'timeout', loops, total });
    await notifyOwner(`加好友超时：${[...pending].join('、')} 一直没通过。`);
    process.exit(2);
  }

  await new Promise((r) => setTimeout(r, INTERVAL * 1000));
}
