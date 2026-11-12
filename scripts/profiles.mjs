/**
 * 群友档案：把"这个人是谁、怎么说话、最近在忙什么"沉淀下来。
 *
 * 为什么需要：群里有 41 个人，我每次被投递都只看到最近几条消息。
 * 于是每轮都在重新认识同一个人——他说一句"又加班"，我根本不知道他这周已经提过三次。
 * 档案就是把这些稳定特征留下来，投递时带一行，省得我每回都从零开始。
 *
 * 两层内容：
 *   stats  —— 从本地索引自动算（条数、活跃时段、消息长度、图/表情比例），机器事实
 *   traits —— 我手动写的判断（"爱怼糯米天师""在出差"），带时间戳，可过期
 *
 * 用法：
 *   node scripts/profiles.mjs build                 # 从 .qce-index 重算 stats
 *   node scripts/profiles.mjs list [--top 12]
 *   node scripts/profiles.mjs show 1473517806       # 也可用名字片段
 *   node scripts/profiles.mjs set 1441816738 "最近在出差，38.5 度还去吃烧烤"
 *   node scripts/profiles.mjs drop 1441816738 "出差"  # 删掉含关键词的 traits
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_DIR = path.join(ROOT, '.qce-index');
const STORE = path.join(ROOT, 'private', 'profiles.json');
const SELF = 2396130865;

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return { updatedAt: '', people: {} };
  }
}

function save(data) {
  data.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function allMessages() {
  const out = [];
  if (!fs.existsSync(INDEX_DIR)) return out;
  for (const f of fs.readdirSync(INDEX_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const body = fs.readFileSync(path.join(INDEX_DIR, f), 'utf8');
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* 跳过坏行 */ }
    }
  }
  return out;
}

/** 一屏能读的时段描述 */
function activeHours(hours) {
  const entries = Object.entries(hours).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return entries.map(([h]) => `${h}点`).join(' / ');
}

export function buildProfiles() {
  const data = load();
  const msgs = allMessages();
  const byUid = new Map();

  for (const m of msgs) {
    const uid = String(m.senderId);
    if (!uid || uid === String(SELF)) continue;
    let p = byUid.get(uid);
    if (!p) {
      p = { name: m.senderName || uid, count: 0, chars: 0, images: 0, firstAt: m.time, lastAt: m.time, hours: {}, days: new Set() };
      byUid.set(uid, p);
    }
    p.count += 1;
    const text = String(m.text ?? '');
    p.chars += text.length;
    if (/\[图片\]|\[表情\]|\[image\]|\[face\]/.test(text)) p.images += 1;
    if (m.time < p.firstAt) p.firstAt = m.time;
    if (m.time > p.lastAt) { p.lastAt = m.time; p.name = m.senderName || p.name; }
    const h = new Date(m.time * 1000).getHours();
    p.hours[h] = (p.hours[h] ?? 0) + 1;
    p.days.add(new Date(m.time * 1000).toLocaleDateString('sv-SE'));
  }

  for (const [uid, p] of byUid) {
    const prev = data.people[uid] ?? {};
    data.people[uid] = {
      name: p.name,
      ...(prev.note ? { note: prev.note } : {}),
      stats: {
        messages: p.count,
        avgChars: Math.round(p.chars / p.count),
        imageRatio: Number((p.images / p.count).toFixed(2)),
        activeDays: p.days.size,
        activeHours: activeHours(p.hours),
        firstAt: new Date(p.firstAt * 1000).toISOString(),
        lastAt: new Date(p.lastAt * 1000).toISOString(),
      },
      traits: prev.traits ?? [],
    };
  }
  save(data);
  return { people: Object.keys(data.people).length, messages: msgs.length };
}

function resolve(data, key) {
  const k = String(key).trim();
  if (data.people[k]) return [k, data.people[k]];
  const lower = k.toLowerCase();
  for (const [uid, p] of Object.entries(data.people)) {
    if (String(p.name).toLowerCase().includes(lower)) return [uid, p];
  }
  return [null, null];
}

/** 给投递层用：一句话档案 */
export function profileLine(uid) {
  const data = load();
  const p = data?.people?.[String(uid)];
  if (!p) return '';
  const bits = [];
  if (p.stats?.messages) bits.push(`说过 ${p.stats.messages} 条`);
  if (p.stats?.activeHours) bits.push(`常在 ${p.stats.activeHours}`);
  if (p.stats?.avgChars) bits.push(`平均 ${p.stats.avgChars} 字`);
  if (Array.isArray(p.traits) && p.traits.length) {
    bits.push(p.traits.slice(-2).map((t) => t.text).join('；'));
  }
  return bits.join('，');
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name, def = '') => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? (process.argv[i + 1] ?? def) : def;
  };

  if (cmd === 'build') {
    const r = buildProfiles();
    console.log(`ok  ${r.people} 人，来自 ${r.messages} 条消息`);
    return;
  }

  if (cmd === 'list') {
    const data = load();
    const top = Number(flag('top', '12'));
    const rows = Object.entries(data.people)
      .sort((a, b) => (b[1].stats?.messages ?? 0) - (a[1].stats?.messages ?? 0))
      .slice(0, top);
    for (const [uid, p] of rows) {
      const t = (p.traits ?? []).slice(-1)[0]?.text ?? '';
      console.log(`${String(p.stats?.messages ?? 0).padStart(4)} 条  ${String(uid).padEnd(11)} ${p.name}${t ? `  · ${t}` : ''}`);
    }
    console.log(`\n共 ${Object.keys(data.people).length} 人，更新于 ${data.updatedAt || '—'}`);
    return;
  }

  if (cmd === 'show') {
    const data = load();
    const [uid, p] = resolve(data, rest[0]);
    if (!uid) {
      console.log(`没有这个人：${rest[0]}（先跑 build）`);
      return;
    }
    console.log(`${p.name}（${uid}）`);
    console.log(`  消息 ${p.stats.messages} 条 · 活跃 ${p.stats.activeDays} 天 · 平均 ${p.stats.avgChars} 字 · 图 ${Math.round(p.stats.imageRatio * 100)}%`);
    console.log(`  常在 ${p.stats.activeHours}，最后 ${p.stats.lastAt.slice(0, 16).replace('T', ' ')}`);
    for (const t of p.traits ?? []) console.log(`  · [${t.at.slice(0, 10)}] ${t.text}`);
    return;
  }

  if (cmd === 'set') {
    const data = load();
    const [uid, p] = resolve(data, rest[0]);
    if (!uid) {
      console.log('没有这个人，先 build 或检查名字');
      return;
    }
    const text = rest.slice(1).join(' ').trim();
    if (!text) {
      console.log('要写什么？例：set 1441816738 "最近在出差"');
      return;
    }
    p.traits = p.traits ?? [];
    p.traits.push({ at: new Date().toISOString(), text });
    p.traits = p.traits.slice(-8);          // 一个人最多留 8 条，旧的挤掉
    save(data);
    console.log(`ok  ${p.name} 加了一条：${text}`);
    return;
  }

  if (cmd === 'drop') {
    const data = load();
    const [uid, p] = resolve(data, rest[0]);
    if (!uid) return console.log('没有这个人');
    const kw = rest.slice(1).join(' ');
    const before = (p.traits ?? []).length;
    p.traits = (p.traits ?? []).filter((t) => !t.text.includes(kw));
    save(data);
    console.log(`ok  删掉 ${before - p.traits.length} 条`);
    return;
  }

  if (cmd === 'line') {
    console.log(profileLine(rest[0]));
    return;
  }

  console.log(`用法:
  node scripts/profiles.mjs build
  node scripts/profiles.mjs list --top 12
  node scripts/profiles.mjs show <QQ号或名字>
  node scripts/profiles.mjs set <QQ号或名字> "一句判断"
  node scripts/profiles.mjs drop <QQ号或名字> 关键词
  node scripts/profiles.mjs line <QQ号>        # 投递层用`);
}

if (process.argv[1] && process.argv[1].endsWith('profiles.mjs')) main();
