/**
 * 开黑识别与播报。
 *
 * 判定规则（写在 hex-roster.json 的 announce 里，不要在这里硬编码）：
 *   同一局 gameId 里，必须有 anchor 那位，
 *   且除他之外至少有 minOthers 名名单成员
 *   → 才算「一起开黑」，才值得播报。
 *
 * 为什么按 gameId 而不是按时间猜：hex 的每局明细自带 gameId，
 * 同一个人打同一局，gameId 必然相同。按时间窗口猜会误判两局连打。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { hexSearch, pickCandidate, hexOverview, type HexMatch } from './hex-api.js';

export interface RosterMember {
  qq: number;
  qqName: string;
  riotId: string;
  /** 首次解析后回写，避免每次重新搜人 */
  puuid?: string;
  server?: string;
  note?: string;
}

export interface AnnounceRule {
  anchor: number;
  minOthers: number;
  maxAgeMinutes: number;
  pollSeconds: number;
  /** 低于这个秒数视为重开：不播报、不评战犯 */
  minDurationSeconds?: number;
  /** 只有这个分钟数内的新局才推送给我确认（更早的靠 --send 手动补） */
  maxPushAgeMinutes?: number;
}

export interface HexRoster {
  group: number;
  announce: AnnounceRule;
  members: RosterMember[];
}

export interface TeamMemberResult {
  qq: number;
  qqName: string;
  riotId: string;
  champion: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  kda: number;
  mvp: boolean;
  augments: string[];
  /** 战犯判定要用的量化字段（可能缺） */
  damageShare?: number;
  takenShare?: number;
  goldShare?: number;
  participationRate?: number;
  visionScore?: number;
  champLevel?: number;
  /** 接口给的称号（内鬼 / SVP / MVP 等） */
  award?: string;
  /** 称号的类型键：sabo=内鬼，svp，mvp */
  awardKey?: string;
}

export interface TeamGame {
  gameId: number;
  creation: number;
  /** 对局时长（毫秒），取自 anchor 那一局 */
  duration?: number;
  /** anchor 与其余成员都在这个列表里 */
  results: TeamMemberResult[];
  /** 成员里的战绩（胜/负），整队口径取 anchor 的那一局 */
  win: boolean;
}


/**
 * 播报里用哪个名字。
 *
 * 群里认的是游戏内 RiotID（今人不见古时月 / 自己的丁ding），不是 QQ 昵称
 * （青春期彪儿不会遇上晟大爹 那种长名字放进播报里没人对得上号）。
 * 所以优先取 riotId 的 # 前面那段。
 */
export function displayName(r: { riotId?: string; qqName?: string }): string {
  const name = String(r.riotId ?? '').split('#')[0].trim();
  return name !== '' ? name : String(r.qqName ?? '?');
}

export function loadRoster(path: string): HexRoster {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as HexRoster;
  if (!raw?.members?.length) throw new Error('名单是空的（hex-roster.json）');
  if (!raw.announce) throw new Error('名单缺少 announce 配置');
  return raw;
}

export function saveRoster(path: string, roster: HexRoster): void {
  writeFileSync(path, JSON.stringify(roster, null, 2), 'utf8');
}

/** 把成员解析成 puuid + 大区；已解析过的直接复用 */
export async function resolveMember(m: RosterMember): Promise<{ puuid: string; server: string }> {
  if (m.puuid && m.server) return { puuid: m.puuid, server: m.server };
  const list = await hexSearch(m.riotId);
  if (!list.length) throw new Error(`找不到 ${m.riotId}`);
  const cand = pickCandidate(list, m.riotId);
  if (!cand) throw new Error(`${m.riotId} 没有可用候选`);
  return { puuid: cand.puuid, server: cand.sgpServerId };
}

function toResult(m: RosterMember, g: HexMatch, puuid?: string): TeamMemberResult {
  return {
    qq: m.qq,
    qqName: m.qqName,
    riotId: m.riotId,
    champion: g.champion?.name ?? '?',
    win: g.win === true,
    kills: g.kills ?? 0,
    deaths: g.deaths ?? 0,
    assists: g.assists ?? 0,
    kda: g.kda ?? 0,
    // g.mvp 是「这局的 MVP 是谁」的对象（{puuid,name,champion}），不是布尔值。
    // 早先写成 g.mvp === true 导致恒为 false，播报里再没出现过 MVP。
    mvp: Boolean(puuid) && g.mvp?.puuid === puuid,
    augments: (g.augments ?? []).map((a) => a.name ?? '').filter(Boolean),
    ...(typeof g.damageShare === 'number' ? { damageShare: g.damageShare } : {}),
    ...(typeof g.takenShare === 'number' ? { takenShare: g.takenShare } : {}),
    ...(typeof g.goldShare === 'number' ? { goldShare: g.goldShare } : {}),
    ...(typeof g.participationRate === 'number' ? { participationRate: g.participationRate } : {}),
    ...(typeof g.visionScore === 'number' ? { visionScore: g.visionScore } : {}),
    ...(typeof g.champLevel === 'number' ? { champLevel: g.champLevel } : {}),
    ...(g.award ? { award: g.award.label, awardKey: (g.award as { key?: string }).key } : {}),
  };
}

/**
 * 拉每个成员最近的对局，按 gameId 归组，挑出满足播报规则的那些局。
 * depth 决定往前看多少局：太小会漏掉刚打完又被新局顶掉的。
 */
export async function findTeamGames(
  roster: HexRoster,
  options: { depth?: number; now?: number; saveBack?: (r: HexRoster) => void } = {},
): Promise<TeamGame[]> {
  const now = options.now ?? Date.now();
  const depth = options.depth ?? 5;
  const rule = roster.announce;
  const primary = roster.members.filter((m) => m.qq === rule.anchor);
  if (primary.length === 0) throw new Error(`名单里没有 anchor（QQ ${rule.anchor}）`);
  const others = roster.members.filter((m) => m.qq !== rule.anchor);

  const byGame = new Map<number, { creation: number; results: TeamMemberResult[]; duration?: number }>();
  let dirty = false;

  const collect = async (m: RosterMember) => {
    let resolved: { puuid: string; server: string };
    try {
      resolved = await resolveMember(m);
    } catch {
      return; // 单个成员查不到不影响整体
    }
    if (!m.puuid) {
      m.puuid = resolved.puuid;
      m.server = resolved.server;
      dirty = true;
    }
    let ov;
    try {
      ov = await hexOverview(resolved.puuid, resolved.server, Math.max(depth, 10));
    } catch {
      return;
    }
    for (const g of (ov.matches ?? []).slice(0, depth)) {
      const entry = byGame.get(g.gameId) ?? { creation: g.creation, results: [], duration: g.duration };
      entry.results.push(toResult(m, g, resolved.puuid));
      byGame.set(g.gameId, entry);
    }
  };

  for (const m of primary) await collect(m);
  for (const m of others) await collect(m);

  if (dirty && options.saveBack) options.saveBack(roster);

  const out: TeamGame[] = [];
  for (const [gameId, entry] of byGame) {
    const hasAnchor = entry.results.some((r) => r.qq === rule.anchor);
    if (!hasAnchor) continue;
    const otherCount = entry.results.filter((r) => r.qq !== rule.anchor).length;
    if (otherCount < rule.minOthers) continue;
    const ageMin = (now - entry.creation) / 60_000;
    if (ageMin > rule.maxAgeMinutes) continue;

    // 重开局不播报：2 分多钟的对局谁都没打，评战犯只会闹笑话。
    // 阈值来自名单配置（默认 300 秒）。
    const minDur = rule.minDurationSeconds ?? 300;
    if (typeof entry.duration === 'number' && entry.duration < minDur) continue;

    const anchorResult = entry.results.find((r) => r.qq === rule.anchor)!;
    // 按「胜/负 → MVP → KDA」排序，播报里好读
    const results = [...entry.results].sort(
      (a, b) => Number(b.win) - Number(a.win) || Number(b.mvp) - Number(a.mvp) || b.kda - a.kda,
    );
    out.push({
      gameId,
      creation: entry.creation,
      results,
      win: anchorResult.win,
      ...(typeof entry.duration === 'number' ? { duration: entry.duration } : {}),
    });
  }

  return out.sort((a, b) => b.creation - a.creation);
}

function ago(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`;
}

/** 渲染成群里能直接发的一段 */
export function renderTeamBroadcast(game: TeamGame, now = Date.now()): string {
  const n = game.results.length;
  const lines: string[] = [];
  lines.push(`【开黑播报】${n} 人一队 · ${ago(game.creation, now)} · ${game.win ? '赢了' : '输了'}`);

  for (const r of game.results) {
    const tag = r.mvp ? ' MVP' : '';
    lines.push(`  ${r.win ? '胜' : '负'} ${displayName(r)} · ${r.champion}  ${r.kills}/${r.deaths}/${r.assists}（KDA ${r.kda}）${tag}`);
    if (r.augments.length) lines.push(`     强化：${r.augments.join(' / ')}`);
  }
  return lines.join('\n');
}
