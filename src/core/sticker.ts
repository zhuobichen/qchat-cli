/**
 * 表情包选择：把「想表达什么」变成「发哪一个表情」。
 *
 * 两条路：
 *   1. Jev（TypeSafe System One）决策模型：给候选 + 每条的描述，让它按意图选一个，
 *      返回类型化 choice + 校准置信度 —— 不做自然语言生成，也不存在"选到不存在的 id"。
 *   2. 关键词兜底：Jev 没配/超时/失败时，用 manifest 里的 label 做子串匹配。
 *
 * 纯逻辑（候选构造、请求体、结果解析）与网络分开，便于单测。
 */
import { searchEmojiLibrary, emojiPath } from './emoji-library.js';
import { searchMemes } from './memesource.js';

export const JEV_ENDPOINT = 'https://api.302ai.cn/typesafeai/v1/systemone';
export const JEV_MODEL = 'jev-latest';

export interface StickerCandidate {
  id: string;
  label: string;
}

export interface JevChoice {
  id: string;
  confidence: number;
}

/** 从库里取候选（复用已有搜索，最多 5 个） */
export function candidatesFor(intent: string, limit = 5): StickerCandidate[] {
  return searchEmojiLibrary(intent, limit).map((e) => ({ id: e.id, label: e.label }));
}

/**
 * 构造 Jev 请求体：一个 state（意图）+ 一个 choice 问题（候选 id → 描述）。
 */
export function buildJevBody(intent: string, candidates: StickerCandidate[]): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const c of candidates) criteria[c.id] = c.label;

  return {
    model: JEV_MODEL,
    state: `用户想表达：${intent}`,
    questions: {
      m0: {
        type: 'choice',
        instructions: '从候选里选出最贴合这个表达意图的表情包；都不贴合也不要硬选。',
        criteria,
      },
    },
  };
}

/** 解析 Jev 返回；choice 必须是候选之一，否则判为无效 */
export function parseJevAnswer(payload: unknown, candidates: StickerCandidate[]): JevChoice | null {
  const answer = (payload as any)?.answers?.m0;
  const choice = answer?.choice;
  if (typeof choice !== 'string') return null;
  if (!candidates.some((c) => c.id === choice)) return null;
  const confidence = Number(answer?.confidence);
  return { id: choice, confidence: Number.isFinite(confidence) ? confidence : 0.5 };
}

export interface PickOptions {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * 用 Jev 选一个表情；任何失败都返回 null（由调用方回退到关键词）。
 */
export async function chooseWithJev(
  intent: string,
  candidates: StickerCandidate[],
  options: PickOptions = {},
): Promise<JevChoice | null> {
  if (candidates.length === 0) return null;
  const apiKey = options.apiKey ?? process.env.JEV_API_KEY ?? '';
  if (!apiKey) return null;

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(options.endpoint ?? JEV_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildJevBody(intent, candidates)),
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    if (!res.ok) return null;
    return parseJevAnswer(await res.json(), candidates);
  } catch {
    return null;
  }
}

export interface PickedSticker extends StickerCandidate {
  source: 'jev' | 'keyword';
  confidence?: number;
}

/**
 * 选表情：先 Jev，失败或没把握就回退关键词；都没有就返回 null。
 */
export async function pickSticker(intent: string, options: PickOptions = {}): Promise<PickedSticker | null> {
  const candidates = candidatesFor(intent);
  if (candidates.length === 0) return null;

  const jev = await chooseWithJev(intent, candidates, options);
  if (jev) {
    const hit = candidates.find((c) => c.id === jev.id)!;
    return { ...hit, source: 'jev', confidence: jev.confidence };
  }
  return { ...candidates[0], source: 'keyword' };
}

/** 校验 id 并返回本地文件路径（不存在返回 null） */
export function stickerFile(id: string): string | null {
  return emojiPath(id);
}

/** memecub 找回来的表情（远端 URL，用之前要下载） */
export interface RemoteSticker {
  title: string;
  url: string;
  /** 是否允许商用（memecub 每条都给） */
  commercialUse?: boolean;
}

/**
 * 本地库没有合适表情时，去 memecub 找。
 *
 * 为什么要兜底：本地库只有 232 张，而且是我手动/半自动攒的；
 * memecub 有几千条（facepalm 552 条、cat 5000 条），覆盖面大得多。
 *
 * 注意：只返回 URL，下载由调用方做（这里不该有副作用）。
 */
export async function findRemoteSticker(
  intent: string,
  options: { limit?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<RemoteSticker[]> {
  const hits = await searchMemes(intent, {
    limit: options.limit ?? 5,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  return hits.map((h) => ({
    title: h.title,
    url: h.url,
    ...(typeof h.commercialUse === 'boolean' ? { commercialUse: h.commercialUse } : {}),
  }));
}

/** 合并候选：本地库 + memecub，交给 Jev 一起挑 */
export interface MergedCandidate extends StickerCandidate {
  origin: 'local' | 'memecub';
  remoteUrl?: string;
}

export interface MergedPick extends StickerCandidate {
  origin: 'local' | 'memecub';
  remoteUrl?: string;
  source: 'jev' | 'keyword';
  confidence?: number;
}

/**
 * 从「本地库 + memecub」合并候选后挑一张。
 *
 * 为什么不写成「本地失败再上网」：Jev 太听话，给它任何候选它都会挑一个"最不差的"，
 * 于是 fallback 永远触发不了。正确做法是把两边候选一起给它，让它横向比较。
 */
export async function pickStickerMerged(
  intent: string,
  options: PickOptions & { remoteLimit?: number; allowRemote?: boolean } = {},
): Promise<MergedPick | null> {
  const locals: MergedCandidate[] = candidatesFor(intent).map((c) => ({ ...c, origin: 'local' }));

  let remotes: MergedCandidate[] = [];
  if (options.allowRemote !== false) {
    const found = await findRemoteSticker(intent, {
      limit: options.remoteLimit ?? 4,
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    remotes = found.map((r, i) => ({
      id: `meme:${i}`,
      label: r.title || '（在线表情）',
      origin: 'memecub' as const,
      remoteUrl: r.url,
    }));
  }

  const all = [...locals, ...remotes];
  if (all.length === 0) return null;

  const jev = await chooseWithJev(intent, all, options);
  if (jev) {
    const hit = all.find((c) => c.id === jev.id)!;
    return { ...hit, source: 'jev', confidence: jev.confidence };
  }
  return { ...all[0], source: 'keyword' };
}
