#!/usr/bin/env node
/**
 * 名片守卫：群名片被**别人**改了就自动改回去。
 *
 * 为什么需要：2026-11-13 在一个群里，别人把我的群名片改成「韦能」「sxs」「吴杏媚」「农源高」，
 * 其中有些是真人的名字（同学、老师）。我当时靠人工发现+手工改回，一共播报了四遍，
 * 被人当成节目看；而且中间隔了几十分钟才改回来，别人已经被这些名字冒犯到了。
 * 这件事该交给脚本，不该靠我现场的注意力。
 *
 * 关键判据：**谁改的**。
 *   - 自己改的（qce card set / 本脚本写入）→ 记进 ledger，是新的基准，不还原
 *   - 别人改的（名片变了但 ledger 里没记）→ 立刻改回上一次自己设的值
 * NapCat 不记「谁调的接口」（这个我验证过很多次），所以没法追溯调用方，
 * 只能靠「我这边记过没有」来区分。这不是完美方案，但它把 99% 的情况解决了。
 *
 * 用法：
 *   node scripts/card-guard.mjs --group 913807639 --want "逆天赛博老哥不会遇上绷得住的"
 *   node scripts/card-guard.mjs --group ... --want ... --once     # 只查一次
 *   node scripts/card-guard.mjs --group ... --want ... --init      # 把当前值记成基准
 *
 * 也可以作为模块：import { checkOnce } from './card-guard.mjs';
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 2396130865;
const TOKEN_FALLBACK = '75277e324f924d73255a5d0b77543e035af0e509bc7d7559';
const LEDGER = path.join(ROOT, 'private', 'card-ledger.json');
const LOG = path.join(ROOT, 'output', 'card-guard.log');
const STATE = path.join(ROOT, 'private', '.card-guard');

function token() {
  if (process.env.QCE_TOKEN) return process.env.QCE_TOKEN;
  // 优先读 NapCat 配置里的 token，读不到用兜底
  try {
    const p = path.join(process.env.USERPROFILE || process.env.HOME, '.qchat-cli', 'NapCat.Shell', 'config', 'onebot11_' + SELF + '.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const t = j?.network?.httpServers?.[0]?.token;
    if (t) return t;
  } catch { /* 用兜底 */ }
  return TOKEN_FALLBACK;
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
      r.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(raw); req.end();
  });
}

function log(line) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `[${new Date().toLocaleString('zh-CN')}] ${line}\n`, 'utf8');
}

function readLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch { return {}; }
}

function writeLedger(obj) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/** 读当前群名片 */
async function currentCard(groupId) {
  const r = await call('get_group_member_info', { group_id: Number(groupId), user_id: SELF, no_cache: true });
  return r?.data?.card ?? null;
}

/**
 * 一次检查。
 * 返回 { action: 'ok'|'restored'|'adopted'|'unreachable', current, want, by }
 */
export async function checkOnce(groupId, want) {
  const g = String(groupId);
  const cur = await currentCard(g);
  if (cur === null) {
    log(`群 ${g} 读不到名片（不在群里 / QQ 离线）`);
    return { action: 'unreachable', current: null, want };
  }

  const ledger = readLedger();
  const rec = ledger[g];
  const baseline = rec?.card ?? want;

  // 名字对得上 → 正常
  if (cur === baseline) {
    return { action: 'ok', current: cur, want: baseline };
  }

  // 名字变了，而且不是我记过的值 → 别人改的
  const r = await call('set_group_card', { group_id: Number(g), user_id: SELF, card: baseline });
  const ok = r?.status === 'ok' || r?.retcode === 0;
  ledger[g] = {
    card: baseline,
    at: new Date().toISOString(),
    note: `被改成「${cur}」，已还原（${ok ? '成功' : '失败'}）`,
    history: [...(rec?.history ?? []).slice(-19), { was: cur, at: new Date().toISOString(), restored: ok }],
  };
  writeLedger(ledger);
  log(`群 ${g}：名片被改成「${cur}」→ 还原为「${baseline}」${ok ? '' : '（还原失败）'}`);
  return { action: ok ? 'restored' : 'restore-failed', current: cur, want: baseline, by: 'someone-else' };
}

/** 把当前值记成基准（我自己改完之后调用） */
export async function adopt(groupId, card) {
  const g = String(groupId);
  const ledger = readLedger();
  const rec = ledger[g];
  ledger[g] = {
    card,
    at: new Date().toISOString(),
    note: '我主动设定',
    history: [...(rec?.history ?? []).slice(-19), { was: rec?.card ?? null, at: new Date().toISOString(), restored: null, mine: true }],
  };
  writeLedger(ledger);
  log(`群 ${g}：基准更新为「${card}」（我主动设定）`);
  return ledger[g];
}

// ── CLI ──────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('card-guard.mjs')) {
  const argv = process.argv.slice(2);
  const arg = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const group = arg('--group');
  const wantList = arg('--want');
  if (!group) {
    console.log('用法: node scripts/card-guard.mjs --group <群号> --want <要保住的名字> [--once] [--init] [--interval 120]');
    process.exit(1);
  }
  const wants = wantList ? wantList.split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (argv.includes('--init')) {
    const cur = await currentCard(group);
    if (!cur) { console.log('读不到名片，先确认 QQ 在线且在群里'); process.exit(1); }
    await adopt(group, cur);
    console.log('基准已设为：' + cur);
    process.exit(0);
  }

  // 默认 120 秒（原 15 秒）：15 秒 = 每天 5760 次 get_group_member_info，
  // 加上其余常驻进程每天近两万次调用，2026-11-16 账号被踢下线过 33 次，
  // 这属于自己把自己刷成风控目标。名片被改不是秒级事件，2 分钟足够。
  const intervalSec = Number(arg('--interval') ?? 120);
  const once = argv.includes('--once');

  const tick = async () => {
    for (const want of wants.length ? wants : [null]) {
      const r = await checkOnce(group, want ?? undefined);
      if (once) console.log(JSON.stringify(r));
    }
  };

  await tick();
  if (!once) {
    console.log(`名片守卫已启动：群 ${group}，每 ${intervalSec} 秒检查一次，日志 ${LOG}`);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, intervalSec * 1000));
      try { await tick(); } catch (e) { log('检查出错：' + e.message); }
    }
  }
}
