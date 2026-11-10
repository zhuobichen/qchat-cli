/**
 * 海克斯大乱斗战绩查询
 *
 * 数据来源：https://hex.hexsss.com 的公开接口（第三方站点，非官方）
 *   /api/search?q=<RiotID>&server=             → 候选玩家（puuid + 大区）
 *   /api/player/overview?puuid=&depth=&server= → 总览（段位/胜率/KDA/评分）与每局明细
 *   /api/augments                              → 237 条强化（名字 + 效果）
 *
 * 用法：
 *   node scripts/hex-stats.mjs "Faker#0520"
 *   node scripts/hex-stats.mjs "Faker#0520" --games 5
 *   node scripts/hex-stats.mjs --refresh-augments   只更新强化表
 *
 * 注意：这是别人家的接口，别打太频。脚本里做了 6 分钟的结果缓存。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://hex.hexsss.com';
const CACHE_DIR = path.join(process.cwd(), 'private');
const AUG_FILE = path.join(CACHE_DIR, 'hex-augments.json');
const RESULT_CACHE = path.join(CACHE_DIR, '.hex-stats-cache.json');
const RESULT_TTL_MS = 6 * 60 * 1000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  Referer: BASE + '/',
  Accept: 'application/json',
};

async function getJson(url, timeoutMs = 60000) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(BASE, '')}`);
  return res.json();
}

function readJson(p, dflt) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8');
}

/** 强化表：只存 id → {name, levelCn, desc} */
async function ensureAugments(force = false) {
  if (!force) {
    const cur = readJson(AUG_FILE, null);
    if (cur?.items && Date.now() - (cur.at || 0) < 7 * 24 * 3600 * 1000) return cur.items;
  }
  const d = await getJson(`${BASE}/api/augments`);
  const items = {};
  for (const a of d.augments ?? []) items[a.id] = { name: a.name, level: a.levelCn, desc: a.desc };
  writeJson(AUG_FILE, { at: Date.now(), total: d.total, items });
  return items;
}

async function search(q) {
  const d = await getJson(`${BASE}/api/search?q=${encodeURIComponent(q)}&server=`);
  const list = d.candidates ?? [];
  if (!list.length) return null;
  // 优先腾讯大区
  return list.find((c) => String(c.sgpServerId || '').startsWith('TENCENT')) ?? list[0];
}

async function overview(puuid, server, depth) {
  const qs = new URLSearchParams({ puuid, depth: String(depth), limit: String(depth), server });
  return getJson(`${BASE}/api/player/overview?${qs}`);
}

function fmtDuration(ms) {
  const s = Math.round((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒`;
}

function ago(ts) {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function render(player, ov, augments, maxGames) {
  const s = ov.summary ?? {};
  const sum = ov.summoner ?? {};
  const lines = [];

  lines.push(`【${sum.gameName ?? player.gameName}#${sum.tagLine ?? player.tagLine}】${player.sgpServerId?.replace('TENCENT_', '') ?? ''}  · 等级 ${sum.summonerLevel ?? '?'}`);

  if (s.games) {
    lines.push(
      `近 ${s.games} 局：${s.wins}胜${s.losses}负  胜率 ${s.winRate}%  KDA ${s.avgKda}（${s.avgKills}/${s.avgDeaths}/${s.avgAssists}）`
    );
  }
  if (s.mostPlayedChampion) {
    lines.push(`最常玩：${s.mostPlayedChampion.name}（用了 ${s.uniqueChampions} 个英雄）`);
  }
  const rating = ov.rating?.componentsRaw;
  if (rating) {
    lines.push(`综合实力分：${rating.base?.toFixed(1)}（池深 ${rating.pool?.toFixed(1)} / 逆风 ${rating.disadv?.toFixed(1)}）`);
  }

  const games = (ov.matches ?? []).slice(0, maxGames);
  if (games.length) {
    lines.push('');
    lines.push(`最近 ${games.length} 局：`);
    for (const g of games) {
      const flag = g.win ? '胜' : '负';
      const aug = (g.augments ?? [])
        .map((a) => a.name)
        .filter(Boolean)
        .join(' / ');
      const extra = g.mvp ? ' MVP' : g.award ? ` ${g.award}` : '';
      lines.push(
        `  ${flag} ${g.champion?.name ?? '?'}  ${g.kills}/${g.deaths}/${g.assists}  ${g.kda}  ${ago(g.creation)}${extra}`
      );
      if (aug) lines.push(`     强化：${aug}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh-augments');
  const ai = args.indexOf('--augment');
  const gi = args.indexOf('--games');
  const maxGames = gi >= 0 ? Number(args[gi + 1]) || 3 : 3;
  const name = args.find((a) => !a.startsWith('--') && a !== String(maxGames) && a !== args[ai + 1]);

  if (refresh) {
    const items = await ensureAugments(true);
    console.log(`强化表已更新：${Object.keys(items).length} 条 → ${AUG_FILE}`);
    return;
  }

  // 查某个强化的效果：--augment 牙仙子
  if (ai >= 0) {
    const want = args[ai + 1] ?? '';
    if (!want) {
      console.log('用法: node scripts/hex-stats.mjs --augment 牙仙子');
      return;
    }
    const items = await ensureAugments();
    const all = Object.values(items);
    const hit =
      all.filter((a) => a.name === want) .length ? all.filter((a) => a.name === want)
      : all.filter((a) => a.name?.includes(want) || want.includes(a.name ?? ''));
    if (!hit.length) {
      console.log(`没找到「${want}」。共 ${all.length} 条强化，换个关键词试试`);
      return;
    }
    for (const a of hit.slice(0, 5)) {
      console.log(`【${a.name}】${a.level ?? ''}`);
      console.log(`  ${a.desc ?? '(无描述)'}`);
    }
    return;
  }

  if (!name) {
    console.log('用法: node scripts/hex-stats.mjs "名字#TAG" [--games 3]');
    console.log('      node scripts/hex-stats.mjs --augment 牙仙子');
    console.log('      node scripts/hex-stats.mjs --refresh-augments');
    return;
  }

  // 结果缓存
  const cache = readJson(RESULT_CACHE, {});
  const key = `${name}|${maxGames}`;
  if (cache[key] && Date.now() - cache[key].at < RESULT_TTL_MS) {
    console.log(cache[key].text);
    console.error('（缓存）');
    return;
  }

  const augments = await ensureAugments();
  const player = await search(name);
  if (!player) {
    console.log(`没找到「${name}」。要带 #TAG 一起，比如 名字#1234`);
    return;
  }
  const ov = await overview(player.puuid, player.sgpServerId, Math.max(maxGames, 10));
  const text = render(player, ov, augments, maxGames);
  console.log(text);

  cache[key] = { at: Date.now(), text };
  writeJson(RESULT_CACHE, cache);
}

main().catch((e) => {
  console.error('查询失败:', e.message);
  process.exit(1);
});
