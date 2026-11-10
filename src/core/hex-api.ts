/**
 * 海克斯大乱斗战绩数据源。
 *
 * 数据来自第三方站点 hex.hexsss.com 的公开接口（不是官方 API，也不是我们自己的服务）：
 *   GET /api/search?q=<RiotID>&server=            候选玩家
 *   GET /api/player/overview?puuid=&depth=&server= 战绩总览 + 每局明细（含本局强化）
 *   GET /api/augments                             全部强化（名字 / 等级 / 效果）
 *   GET /api/heroes                               英雄表
 *
 * 边界（都实测过）：
 *   · 查人要带 #TAG；只给名字会返回一堆候选，此时用 hexSearch 让调用方挑。
 *   · /api/matches、/api/profile 需要对方客户端授权，公开访问 403，不用。
 *   · 这是别人家的服务：结果缓存 6 分钟，强化表缓存 7 天，避免打太频。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const BASE = 'https://hex.hexsss.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  Referer: `${BASE}/`,
  Accept: 'application/json',
};
const RESULT_TTL_MS = 6 * 60 * 1000;
const AUG_TTL_MS = 7 * 24 * 3600 * 1000;

export interface HexCandidate {
  puuid: string;
  gameName: string;
  tagLine: string;
  sgpServerId: string;
  iconId?: number;
  summonerLevel?: number;
}

export interface HexAugment {
  name: string;
  level?: string;
  desc?: string;
}

export interface HexMatch {
  gameId: number;
  creation: number;
  champion?: { id?: number; key?: string; name?: string };
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  queueName?: string;
  /** 这一局的 MVP 是谁（不是"我是不是 MVP"） */
  mvp?: { puuid?: string; name?: string; champion?: { id?: number; key?: string; name?: string } } | null;
  /** 本局给的称号：sabo=内鬼 / svp / mvp，附带说明 */
  award?: { key?: string; label?: string; tier?: string; hint?: string } | null;
  title?: string;
  duration?: number;
  damageToChampions?: number;
  damageTaken?: number;
  damageShare?: number;
  takenShare?: number;
  goldShare?: number;
  participationRate?: number;
  cs?: number;
  visionScore?: number;
  champLevel?: number;
  healShare?: number;
  augments?: Array<{ id: number; name?: string; rarity?: string }>;
}

export interface HexOverview {
  summoner?: { gameName?: string; tagLine?: string; summonerLevel?: number };
  summary?: {
    games?: number;
    wins?: number;
    losses?: number;
    winRate?: number;
    avgKda?: number;
    avgKills?: number;
    avgDeaths?: number;
    avgAssists?: number;
    uniqueChampions?: number;
    mostPlayedChampion?: { name?: string };
  };
  rating?: { componentsRaw?: { base?: number; pool?: number; disadv?: number } };
  matches?: HexMatch[];
}

/** 结果缓存：key → {at, value}，只在进程内，重启即失效 */
const resultCache = new Map<string, { at: number; value: unknown }>();

async function getJson<T>(url: string, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`hex 接口返回 HTTP ${res.status}（${url.replace(BASE, '')}）`);
  return (await res.json()) as T;
}

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL_MS) return Promise.resolve(hit.value as T);
  return fn().then((value) => {
    resultCache.set(key, { at: Date.now(), value });
    return value;
  });
}

/** 仅供测试：清空结果缓存 */
export function __clearHexCache(): void {
  resultCache.clear();
}

/** 按名字搜人；返回候选数组（可能为空） */
export async function hexSearch(name: string): Promise<HexCandidate[]> {
  const q = name.trim();
  if (q === '') return [];
  return cached(`search:${q}`, async () => {
    const d = await getJson<{ candidates?: HexCandidate[] }>(
      `${BASE}/api/search?q=${encodeURIComponent(q)}&server=`,
    );
    return d.candidates ?? [];
  });
}

/** 优先挑国服（TENCENT_*）候选，没有就取第一个 */
export function pickCandidate(list: HexCandidate[], prefer?: string): HexCandidate | undefined {
  if (prefer) {
    const exact = list.find(
      (c) => `${c.gameName}#${c.tagLine}`.toLowerCase() === prefer.trim().toLowerCase(),
    );
    if (exact) return exact;
  }
  return list.find((c) => String(c.sgpServerId ?? '').startsWith('TENCENT')) ?? list[0];
}

/** 拉某个玩家的总览（含每局明细） */
export async function hexOverview(puuid: string, server: string, depth = 20): Promise<HexOverview> {
  const d = Math.max(1, Math.min(120, Math.floor(depth)));
  return cached(`ov:${puuid}:${server}:${d}`, async () => {
    const qs = new URLSearchParams({ puuid, depth: String(d), limit: String(d), server });
    return getJson<HexOverview>(`${BASE}/api/player/overview?${qs}`);
  });
}

/** 强化表：本地缓存 7 天 */
export async function hexAugments(storePath: string, force = false): Promise<Record<string, HexAugment>> {
  if (!force) {
    try {
      const cur = JSON.parse(readFileSync(storePath, 'utf8')) as {
        at?: number;
        items?: Record<string, HexAugment>;
      };
      if (cur?.items && Date.now() - (cur.at ?? 0) < AUG_TTL_MS) return cur.items;
    } catch {
      /* 没缓存或坏了，就重新拉 */
    }
  }
  const d = await getJson<{ augments?: Array<{ id: number; name: string; levelCn?: string; desc?: string }> }>(
    `${BASE}/api/augments`,
  );
  const items: Record<string, HexAugment> = {};
  for (const a of d.augments ?? []) {
    items[String(a.id)] = { name: a.name, ...(a.levelCn ? { level: a.levelCn } : {}), ...(a.desc ? { desc: a.desc } : {}) };
  }
  try {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, JSON.stringify({ at: Date.now(), items }, null, 2), 'utf8');
  } catch {
    /* 写不了缓存不影响本次查询 */
  }
  return items;
}

/** 按名字找强化：先精确，再包含 */
export function findAugment(
  items: Record<string, HexAugment>,
  q: string,
  limit = 5,
): HexAugment[] {
  const want = q.trim();
  if (want === '') return [];
  const all = Object.values(items);
  const exact = all.filter((a) => a.name === want);
  if (exact.length) return exact;
  return all
    .filter((a) => a.name?.includes(want) || want.includes(a.name ?? ''))
    .slice(0, limit);
}

function ago(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/** 把总览渲染成群里能直接看的短卡片 */
export function renderHexCard(
  candidate: HexCandidate,
  ov: HexOverview,
  maxGames = 3,
  now = Date.now(),
): string {
  const s = ov.summary ?? {};
  const sm = ov.summoner ?? {};
  const lines: string[] = [];

  const name = `${sm.gameName ?? candidate.gameName}#${sm.tagLine ?? candidate.tagLine}`;
  const server = String(candidate.sgpServerId ?? '').replace('TENCENT_', '');
  lines.push(`【${name}】${server} · 等级 ${sm.summonerLevel ?? '?'}`);

  if (s.games) {
    lines.push(
      `近 ${s.games} 局：${s.wins ?? 0}胜${s.losses ?? 0}负  胜率 ${s.winRate ?? '?'}%  KDA ${s.avgKda ?? '?'}（${s.avgKills ?? '?'}/${s.avgDeaths ?? '?'}/${s.avgAssists ?? '?'}）`,
    );
  }
  if (s.mostPlayedChampion?.name) {
    lines.push(`最常玩：${s.mostPlayedChampion.name}（用过 ${s.uniqueChampions ?? '?'} 个英雄）`);
  }
  const r = ov.rating?.componentsRaw;
  if (typeof r?.base === 'number') {
    lines.push(
      `综合实力分：${r.base.toFixed(1)}（池深 ${r.pool?.toFixed(1) ?? '?'} / 逆风 ${r.disadv?.toFixed(1) ?? '?'}）`,
    );
  }

  const games = (ov.matches ?? []).slice(0, maxGames);
  if (games.length) {
    lines.push('');
    lines.push(`最近 ${games.length} 局：`);
    for (const g of games) {
      const flag = g.win ? '胜' : '负';
      const extra = g.mvp ? ' MVP' : g.award ? ` ${g.award}` : '';
      lines.push(
        `  ${flag} ${g.champion?.name ?? '?'}  ${g.kills}/${g.deaths}/${g.assists}  ${g.kda}  ${ago(g.creation, now)}${extra}`,
      );
      const aug = (g.augments ?? []).map((a) => a.name).filter(Boolean).join(' / ');
      if (aug) lines.push(`     强化：${aug}`);
    }
  }
  return lines.join('\n');
}
