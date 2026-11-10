/**
 * 「这局战犯是谁」判定。
 *
 * 用 Jev（systemone 选择模型）做判断：它只做类型化选择 + 给置信度，
 * 不会编出一个不存在的人；把握不够或没配 key 就回落到确定性打分。
 *
 * 为什么不能让模型自由发挥：战犯是要@到具体人的，
 * 模型自由生成名字容易出现「查无此人」或者点错人，那比不评还糟。
 */

import { JEV_ENDPOINT, JEV_MODEL } from './sticker.js';
import { displayName, type TeamGame, type TeamMemberResult } from './hex-team.js';

export interface Culprit {
  qq: number;
  qqName: string;
  /** 游戏内 RiotID，播报里用它（群里认这个，不认 QQ 昵称） */
  riotId?: string;
  champion: string;
  /** 一句话理由（规则给的说法） */
  reason: string;
  /** 分数越高越像战犯 */
  score: number;
}

export interface VerdictResult {
  culprit: Culprit | null;
  source: 'jev' | 'rules';
  confidence: number;
  reason?: string;
}

/** 把一局的事实拼成给模型看的 state */
export function buildVerdictState(game: TeamGame): string {
  const dur = Math.round(((game as unknown as { duration?: number }).duration ?? 0) / 60);
  const lines = [
    `结果：${game.win ? '赢了' : '输了'}${dur ? `（${dur} 分钟）` : ''}`,
    '队友表现：',
  ];
  game.results.forEach((r, i) => {
    const bits = [
      `${r.champion}`,
      `${r.kills}/${r.deaths}/${r.assists}（KDA ${r.kda}）`,
      r.damageShare != null ? `伤害占比 ${r.damageShare}%` : '',
      r.takenShare != null ? `承伤 ${r.takenShare}%` : '',
      r.goldShare != null ? `经济 ${r.goldShare}%` : '',
      r.participationRate != null ? `参团 ${r.participationRate}%` : '',
      r.visionScore != null ? `视野 ${r.visionScore}` : '',
      r.mvp ? 'MVP' : '',
      r.award ? r.award : '',
    ].filter(Boolean);
    lines.push(`[p${i + 1}] ${r.qqName}：${bits.join(' · ')}`);
  });
  return lines.join('\n');
}

/** 给 Jev 的选项：每个玩家一条，另外允许「真挑不出来」 */
export function buildVerdictCriteria(game: TeamGame): Record<string, string> {
  const out: Record<string, string> = {};
  game.results.forEach((r, i) => {
    const bad: string[] = [];
    if (r.deaths >= 8) bad.push('死得多');
    if (r.damageShare != null && r.damageShare < 12) bad.push('伤害占比低');
    if (r.participationRate != null && r.participationRate < 45) bad.push('参团少');
    out[`p${i + 1}`] =
      `${r.qqName} 玩 ${r.champion}，${r.kills}/${r.deaths}/${r.assists}` +
      (bad.length ? `；短板：${bad.join('、')}` : '；数据上没有明显短板') +
      (r.mvp ? '；本局 MVP，不是战犯' : '');
  });
  out.none = '这局打得还行，找不出明显战犯（不许硬点）';
  return out;
}

export function buildVerdictBody(game: TeamGame): Record<string, unknown> {
  return {
    model: JEV_MODEL,
    state: buildVerdictState(game),
    questions: {
      m0: {
        type: 'choice',
        instructions:
          '你们是一起开黑的朋友。刚打完一局海克斯大乱斗，要按数据挑一个「战犯」——就是这局最该背锅的人。' +
          '只看数据，不看人情：死最多、伤害最低、参团最少、拿了资源没输出，都算。' +
          '如果有人拿了 MVP 或数据明显领先，就不要点他。' +
          '赢了也可以点评谁在拖后腿，但要说清是「赢得难看」而不是「他害我们输了」。' +
          '如果数据都还行，就选 none，不要硬点。',
        criteria: buildVerdictCriteria(game),
      },
    },
  };
}

/** 解析 Jev 的答案；choice 必须落在我们给的选项里，否则当成无效 */
export function parseVerdictAnswer(
  payload: unknown,
  game: TeamGame,
): { index: number | null; confidence: number } | null {
  const answer = (payload as { answers?: { m0?: { choice?: unknown; confidence?: unknown } } })?.answers?.m0;
  const choice = answer?.choice;
  if (typeof choice !== 'string') return null;
  const confidence = Number(answer?.confidence);
  const conf = Number.isFinite(confidence) ? confidence : 0.5;
  if (choice === 'none') return { index: null, confidence: conf };
  const m = /^p(\d+)$/.exec(choice);
  if (!m) return null;
  const index = Number(m[1]) - 1;
  if (index < 0 || index >= game.results.length) return null;
  return { index, confidence: conf };
}

/** 规则打分：分越高越像战犯 */
export function scoreMember(r: TeamMemberResult): { score: number; reason: string } {
  let score = 0;
  const why: string[] = [];

  score += r.deaths * 2;
  if (r.deaths >= 8) why.push(`死了 ${r.deaths} 次`);

  if (r.damageShare != null) {
    score += (20 - r.damageShare) * 1.2;
    if (r.damageShare < 12) why.push(`伤害只占 ${r.damageShare}%`);
  }
  if (r.participationRate != null) {
    score += (55 - r.participationRate) * 0.5;
    if (r.participationRate < 45) why.push(`参团 ${r.participationRate}%`);
  }
  if (r.goldShare != null && r.damageShare != null && r.goldShare - r.damageShare > 8) {
    score += 10;
    why.push(`吃了 ${r.goldShare}% 经济却只打 ${r.damageShare}% 伤害`);
  }
  if (r.mvp) score -= 40;
  if (r.kda >= 4) score -= 8;

  return { score: Math.round(score * 10) / 10, reason: why.join('，') || '数据平平' };
}

/** 纯规则兜底：永不失败，也不需要网络 */
export function rulesVerdict(game: TeamGame): VerdictResult {
  // 接口自己判了「内鬼」的话直接用——它的算法看了 34 个统计字段，
  // 比我这几条手写的阈值靠谱得多。
  const sabo = game.results.find((r) => r.awardKey === 'sabo');
  if (sabo) {
    return {
      culprit: {
        qq: sabo.qq,
        qqName: sabo.qqName,
        riotId: sabo.riotId,
        champion: sabo.champion,
        reason: `${sabo.kills}/${sabo.deaths}/${sabo.assists}，被点内鬼`,
        score: 999,
      },
      source: 'rules',
      confidence: 1,
      reason: '接口标注 sabo（内鬼）',
    };
  }

  let best: Culprit | null = null;
  for (const r of game.results) {
    const { score, reason } = scoreMember(r);
    if (!best || score > best.score) {
      best = { qq: r.qq, qqName: r.qqName, riotId: r.riotId, champion: r.champion, reason, score };
    }
  }
  return { culprit: best, source: 'rules', confidence: 1 };
}

export interface VerdictOptions {
  apiKey?: string;
  endpoint?: string;
  minConfidence?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 判定入口：先问 Jev，置信度不够或失败就回落规则。
 * 回落不是兜底敷衍——规则打分用的是同一批数据，只是没有语义理解。
 */
export async function judgeCulprit(game: TeamGame, options: VerdictOptions = {}): Promise<VerdictResult> {
  if (game.results.length < 2) {
    return { culprit: null, source: 'rules', confidence: 1, reason: '人太少，不评战犯' };
  }

  const apiKey = options.apiKey ?? process.env.JEV_API_KEY ?? '';
  if (!apiKey) return { ...rulesVerdict(game), reason: '未配 JEV_API_KEY，用规则打分' };

  const minConfidence = options.minConfidence ?? 0.5;
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const res = await fetchImpl(options.endpoint ?? JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildVerdictBody(game)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!res.ok) return { ...rulesVerdict(game), reason: `Jev 返回 ${res.status}，用规则打分` };

    const parsed = parseVerdictAnswer(await res.json(), game);
    if (!parsed) return { ...rulesVerdict(game), reason: 'Jev 答案无法解析，用规则打分' };
    if (parsed.confidence < minConfidence) {
      return {
        ...rulesVerdict(game),
        reason: `Jev 只有 ${parsed.confidence.toFixed(2)} 把握，用规则打分`,
      };
    }
    if (parsed.index === null) {
      return { culprit: null, source: 'jev', confidence: parsed.confidence, reason: '这局没明显战犯' };
    }
    const r = game.results[parsed.index]!;
    const { score, reason } = scoreMember(r);
    return {
      culprit: { qq: r.qq, qqName: r.qqName, riotId: r.riotId, champion: r.champion, reason, score },
      source: 'jev',
      confidence: parsed.confidence,
    };
  } catch {
    return { ...rulesVerdict(game), reason: 'Jev 调用失败，用规则打分' };
  }
}

/** 渲染成一行点评（放在播报末尾） */
export function renderVerdictLine(v: VerdictResult, game: TeamGame): string {
  // 赢的局不点战犯：赢了还要揪一个人出来背锅，既没说服力也容易得罪人。
  // 改成「这局靠谁撑的」——同样有内容，但方向是正的。
  if (game.win) {
    const carry = pickCarry(game);
    if (!carry) return '';
    const bits: string[] = [];
    if (carry.damageShare != null) bits.push(`伤害 ${carry.damageShare}%`);
    if (carry.participationRate != null) bits.push(`参团 ${carry.participationRate}%`);
    if (carry.mvp) bits.push('MVP');
    return `点评：这局是 ${displayName(carry)}（${carry.champion}）撑的——${bits.join('、') || `${carry.kills}/${carry.deaths}/${carry.assists}`}`;
  }
  if (!v.culprit) return v.reason ? `点评：${v.reason}` : '';
  const who = `${displayName(v.culprit)}（${v.culprit.champion}）`;
  return `战犯：${who}——${v.culprit.reason}。这锅他得背`;
}

/** 赢局里挑「谁撑起来的」：优先伤害占比，其次参团 */
export function pickCarry(game: TeamGame): TeamMemberResult | null {
  let best: TeamMemberResult | null = null;
  let bestScore = -Infinity;
  for (const r of game.results) {
    const score = (r.damageShare ?? 0) * 2 + (r.participationRate ?? 0) * 0.4 + (r.mvp ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
