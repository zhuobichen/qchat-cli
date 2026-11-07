#!/usr/bin/env node
/**
 * 探 OneBot 是否真的「能用」。
 *
 * 为什么不能只看端口：`get_login_info` 在离线时会返回**缓存的**账号信息，
 * 于是进程活着、端口通、接口有数据 —— 看起来一切正常，实际根本没连上。
 * 必须看 `get_status.online === true`，这是唯一可信的判据。
 *
 * 用法：
 *   node scripts/onebot-ready.mjs            # 探一次，输出 JSON
 *   node scripts/onebot-ready.mjs --wait 60  # 最多等 60 秒
 *   node scripts/onebot-ready.mjs --expect 2396130865
 *
 * 退出码：0 = 就绪，1 = 未就绪（脚本可安全用于 if 判断）
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const waitSec = Number(argOf('--wait', '0')) || 0;
const expect = argOf('--expect', '');
const endpoint = argOf('--endpoint', 'http://127.0.0.1:3000');

function readToken() {
  const p = join(homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
  } catch {
    return '';
  }
}

async function probe(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const call = async (action) => {
    const res = await fetch(`${endpoint}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: '{}',
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`${action} HTTP ${res.status}`);
    return (await res.json())?.data;
  };

  const status = await call('get_status');
  // 关键判据：online 必须是 true。good 只表示进程状态。
  if (status?.online !== true) {
    return { ready: false, reason: 'OneBot 进程在，但账号未登录（online=false）', status };
  }
  const login = await call('get_login_info');
  const uin = String(login?.user_id ?? '');
  if (expect && uin !== String(expect)) {
    return { ready: false, reason: `登录的是 ${uin}，期望 ${expect}`, status, uin };
  }
  return { ready: true, uin, nickname: login?.nickname ?? '', status };
}

const token = readToken();
const deadline = Date.now() + waitSec * 1000;
let last = { ready: false, reason: '未探测' };

for (;;) {
  try {
    last = await probe(token);
  } catch (error) {
    last = { ready: false, reason: `连不上 ${endpoint}: ${String(error?.message ?? error).slice(0, 80)}` };
  }
  if (last.ready || Date.now() >= deadline) break;
  await new Promise((r) => setTimeout(r, 2000));
}

console.log(JSON.stringify({ at: new Date().toISOString(), endpoint, ...last }, null, 2));
process.exit(last.ready ? 0 : 1);
