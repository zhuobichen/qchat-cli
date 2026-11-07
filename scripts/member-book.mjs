#!/usr/bin/env node
/**
 * 群成员档案：名字 ↔ QQ 号的映射，带最后一次见到的名字。
 *
 * 为什么需要：群里的人会改群名片。只记名字的话，
 * 一个人改个马甲我就认不出来了；反过来，两个人重名我也分不清。
 *
 * QQ 号是稳定的，名字不是。所以档案以 QQ 号为主键，名字只是"最近一次见到叫什么"。
 *
 * 用法：
 *   node scripts/member-book.mjs sync          # 从 OneBot 拉群成员，写入档案
 *   node scripts/member-book.mjs list [群号]   # 列出来
 *   node scripts/member-book.mjs who 1441816738
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BOOK = join(process.cwd(), 'private', 'member-book.json');
const ENDPOINT = process.env.QCE_ONEBOT ?? 'http://127.0.0.1:3000';

function readToken() {
  const p = join(homedir(), '.qchat-cli', 'NapCat.Shell', 'napcat', 'config', 'onebot11_2396130865.json');
  try {
    return JSON.parse(readFileSync(p, 'utf8'))?.network?.httpServers?.[0]?.token ?? '';
  } catch {
    return '';
  }
}

async function api(action, params = {}) {
  const token = readToken();
  const res = await fetch(`${ENDPOINT}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json();
  if (json?.status !== 'ok') throw new Error(`${action} 失败: ${JSON.stringify(json).slice(0, 120)}`);
  return json.data;
}

function load() {
  try {
    if (!existsSync(BOOK)) return { groups: {}, members: {} };
    const raw = JSON.parse(readFileSync(BOOK, 'utf8'));
    return { groups: raw.groups ?? {}, members: raw.members ?? {} };
  } catch {
    return { groups: {}, members: {} };
  }
}

function save(book) {
  mkdirSync(join(process.cwd(), 'private'), { recursive: true });
  writeFileSync(BOOK, JSON.stringify(book, null, 2), 'utf8');
}

const [sub, arg] = process.argv.slice(2);

if (sub === 'sync') {
  const groups = await api('get_group_list');
  const book = load();
  let total = 0;
  for (const g of groups ?? []) {
    const gid = String(g.group_id);
    const members = await api('get_group_member_list', { group_id: g.group_id });
    book.groups[gid] = { name: g.group_name, syncedAt: Date.now(), count: (members ?? []).length };
    for (const m of members ?? []) {
      const uin = String(m.user_id);
      const name = m.card || m.nickname || uin;
      const prev = book.members[uin] ?? {};
      // 记下所有见过的名字，改名后还能倒查
      const aliases = new Set(prev.aliases ?? []);
      aliases.add(name);
      if (m.nickname) aliases.add(m.nickname);
      book.members[uin] = {
        uin,
        name,
        nickname: m.nickname ?? '',
        aliases: [...aliases].slice(-8),
        groups: [...new Set([...(prev.groups ?? []), gid])],
        lastSeenAt: Date.now(),
      };
      total += 1;
    }
    console.log(`  ${g.group_name}(${gid}): ${(members ?? []).length} 人`);
  }
  save(book);
  console.log(`档案已更新：${Object.keys(book.groups).length} 个群，${Object.keys(book.members).length} 个人（本次扫描 ${total}）`);
  process.exit(0);
}

if (sub === 'list') {
  const book = load();
  const gid = arg;
  const rows = Object.values(book.members).filter((m) => !gid || (m.groups ?? []).includes(gid));
  for (const m of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${m.uin}\t${m.name}${m.aliases.length > 1 ? '  (曾用: ' + m.aliases.filter((x) => x !== m.name).join('/') + ')' : ''}`);
  }
  console.log(`共 ${rows.length} 人`);
  process.exit(0);
}

if (sub === 'who') {
  const book = load();
  const m = book.members[String(arg)];
  if (!m) {
    console.log(`档案里没有 ${arg}`);
    process.exit(1);
  }
  console.log(JSON.stringify(m, null, 2));
  process.exit(0);
}

console.log('用法: member-book.mjs sync | list [群号] | who <QQ号>');
process.exit(2);
