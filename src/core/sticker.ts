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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { searchEmojiLibrary, emojiPath } from './emoji-library.js';
import { cosine, decodeVector, embedTexts, resolveApiKey as resolveEmbeddingApiKey } from './embeddings.js';
import { feedbackMultiplier, recordStickerSent, statsBySticker } from './sticker-feedback.js';
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
/**
 * 把中文意图切成二元组。
 *
 * 为什么需要：`searchEmojiLibrary` 按空格分词后做子串匹配，
 * 中文整句（"哈哈哈哈哈太惨了"）匹配不上任何标签，于是它退回"最近导入"的条目——
 * 结果就是给"笑到不行"配了一张"雪地轮椅上瘫坐"。
 * 中文没空格，得自己切。
 */
export function bigrams(text: string): string[] {
  const clean = String(text ?? '').replace(/[\s，。！？、,.!?~～…—\-""''（）()\[\]【】]+/g, '');
  const out: string[] = [];
  for (let i = 0; i + 1 < clean.length; i += 1) {
    out.push(clean.slice(i, i + 2));
  }
  // 单字意图（如"笑"）也保留，否则两字以下永远无候选
  if (out.length === 0 && clean.length === 1) out.push(clean);
  return out;
}

/**
 * 取候选表情：只保留**真的有匹配**的。
 *
 * 绝不返回"没匹配但凑数"的条目——配一张不搭的表情比不配更糟。
 */
/**
 * 情绪同义词扩展。
 *
 * 为什么要它：库里标签是"哈哈哈哈哈，我直接笑出声"，而回复是"笑死我了"——
 * 二元组对不上（笑死 vs 笑出）。等价说法在聊天里太常见，纯字面匹配召回太低。
 * 这里是确定性映射，不加延迟、不花钱。
 */
const EMOTION_SYNONYMS: Array<[RegExp, string[]]> = [
  [/笑|哈哈|乐|233|搞笑|太惨|憋不住/i, ['笑', '哈哈', '嘲讽', '无语']],
  [/无语|服了|离谱|绝了|无奈|摆烂|崩了/i, ['无语', '震惊', '呆滞', '无奈', '摆烂']],
  [/怒|生气|火大|气死|怼|滚|骂/i, ['生气', '愤怒', '怼人', '警告']],
  [/哭|委屈|难过|难受|惨|破防|emo/i, ['委屈', '哭', '难过', '求安慰']],
  [/震惊|惊|傻|懵|卧槽|我操|啊这/i, ['震惊', '懵圈', '呆滞']],
  [/开心|高兴|爽|好耶|棒|不错/i, ['开心', '高兴', '庆祝']],
  [/累|困|睡|躺|瘫|摆/i, ['累', '睡', '瘫', '躺平']],
  [/可爱|萌|亲亲|抱抱|喜欢|爱/i, ['可爱', '抱抱', '撒娇']],
  [/吃|饿|饭|喝|奶茶/i, ['吃', '饭', '美食']],
  [/钱|穷|加班|工作|老板/i, ['钱', '加班', '穷']],
];

/** 从一句话里推可能的表情标签关键词（原句 + 命中的同义词组） */
export function emotionHints(intent: string): string[] {
  const hints = new Set<string>([intent]);
  for (const [re, words] of EMOTION_SYNONYMS) {
    if (re.test(intent)) {
      for (const w of words) hints.add(w);
    }
  }
  return [...hints];
}

export function candidatesFor(intent: string, limit = 5): StickerCandidate[] {
  const seeds = emotionHints(intent);
  const grams = seeds.flatMap((s2) => bigrams(s2));
  if (grams.length === 0) return [];

  const pool = new Map<string, { id: string; label: string }>();
  for (const seed of seeds.slice(0, 6)) {
    for (const e of searchEmojiLibrary(seed, 50)) pool.set(e.id, { id: e.id, label: e.label });
  }

  const scored = [...pool.values()]
    .map((e) => {
      const label = e.label.toLowerCase();
      const score = grams.reduce((n, g) => n + (label.includes(g.toLowerCase()) ? 1 : 0), 0);
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((x) => ({ id: x.e.id, label: x.e.label }));
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
  /** 发给谁（group:<id> / private:<uin>），反馈统计用 */
  scope?: string;
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
  // 优先语义检索（向量），拿不到再退回 bigram 子串。
  // 语义检索取 top-20 而不是 top-1：后面要抽样，候选太少就没有变化空间。
  let locals: MergedCandidate[] = [];
  const vecHits = await candidatesByEmbedding(intent, 20, {
    ...(options.apiKey ? { apiKey: String(options.apiKey) } : {}),
  }).catch(() => []);
  if (vecHits.length > 0) {
    locals = vecHits.map((c) => ({ ...c, origin: 'local' as const }));
  } else {
    locals = candidatesFor(intent, 12).map((c) => ({ ...c, origin: 'local' as const }));
  }

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

  let all = [...locals, ...remotes];
  if (all.length === 0) return null;

  // 避开最近用过的，免得同一个词连着发同一张图
  const usage = loadStickerUsage();
  all = avoidRecentlyUsed(all, usage);

  // 关键：交给 Jev 的菜单是**抽样**出来的，不是排序前几名。
  // 排序是确定性的，直接给前 6 名会让同一意图每次都出同一张；
  // 抽样后 Jev 每次看到的菜单都不同，它仍然负责"哪个最贴合"，但不负责"总选同一个"。
  const menuCount = Math.min(6, all.length);
  // 历史表现做温和加权：发出去有人接的图更容易被选中，没人理的稍微靠后。
  // 幅度只有 ±15%，不能盖过「贴不贴合」这个主判据。
  const stats = statsBySticker();
  const menu = all.length > menuCount
    ? weightedSample(all, menuCount, 1.2, Math.random, (c) => feedbackMultiplier(stats.get(c.id)))
    : all;
  const jev = await chooseWithJev(intent, menu, options);
  if (jev) {
    const hit = menu.find((c) => c.id === jev.id) ?? all[0];
    markStickerUsed(hit.id);
    recordStickerSent(hit.id, intent, options.scope ?? 'unknown');
    return { ...hit, source: 'jev', confidence: jev.confidence };
  }
  const pickOne = menu[Math.floor(Math.random() * menu.length)] ?? all[0];
  markStickerUsed(pickOne.id);
  recordStickerSent(pickOne.id, intent, options.scope ?? 'unknown');
  return { ...pickOne, source: 'keyword' };
}


// ══════════════════════════════════════════════════════════════
// 语义检索 + 带权抽样：解决「同一个词永远发同一张」
// ══════════════════════════════════════════════════════════════

export interface EmojiVectorIndex {
  model: string;
  count: number;
  dims: number;
  items: Array<{ hash: string; v: string }>;
}

let cachedIndex: EmojiVectorIndex | null = null;

export function loadEmojiVectorIndex(path = 'private/emoji-library/embeddings.json'): EmojiVectorIndex | null {
  if (cachedIndex && path === 'private/emoji-library/embeddings.json') return cachedIndex;
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as EmojiVectorIndex;
    if (!Array.isArray(raw.items) || raw.items.length === 0) return null;
    if (path === 'private/emoji-library/embeddings.json') cachedIndex = raw;
    return raw;
  } catch {
    return null;
  }
}

/**
 * 按语义检索候选。
 *
 * 为什么不用 bigram 子串：意图「无语」的合适表情可能是「熊猫头 翻白眼」，
 * 字面上不含「无语」二字，子串匹配永远够不着。
 */
export async function candidatesByEmbedding(
  intent: string,
  limit = 20,
  options: { apiKey?: string; index?: EmojiVectorIndex | null } = {},
): Promise<StickerCandidate[]> {
  const index = options.index ?? loadEmojiVectorIndex();
  if (!index) return [];
  const apiKey = options.apiKey ?? resolveEmbeddingApiKey();
  if (!apiKey) return [];
  try {
    const [qv] = await embedTexts([intent], { apiKey });
    if (!qv) return [];
    const byHash = new Map(emojiLabels().map((e) => [e.hash, e.label]));
    return index.items
      .map((it) => ({ hash: it.hash, score: cosine(qv, decodeVector(it.v)) }))
      .filter((x) => byHash.has(x.hash))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => ({ id: x.hash, label: byHash.get(x.hash)! }));
  } catch {
    return [];
  }
}

/** 库里的 hash → label（用来把向量索引映射回可发的表情） */
function emojiLabels(): Array<{ hash: string; label: string }> {
  try {
    const raw = JSON.parse(readFileSync('private/emoji-library/manifest.json', 'utf8'));
    return (raw.emojis ?? []).map((e: any) => ({ hash: e.hash, label: e.label }));
  } catch {
    return [];
  }
}

/**
 * 带权抽样（不放回）。
 *
 * 为什么要抽样而不是取 top-1：语义检索是确定性的，同一个意图每次排序一样，
 * 取第一名就会「每次都发同一张」。真人不是这样——同一个意思换着图发。
 *
 * 权重 = exp(相似度 / T)。T 越大越随机，越小越保守。
 * 这里没有显式的相似度，就用名次衰减近似：第 i 名权重 ∝ 1/(i+1)^p。
 */
export function weightedSample<T>(
  items: T[],
  count: number,
  power = 1.2,
  rng = Math.random,
  weightOf?: (item: T, index: number) => number,
): T[] {
  const pool = items.map((item, i) => ({
    item,
    w: (1 / Math.pow(i + 1, power)) * (weightOf ? Math.max(0.05, weightOf(item, i)) : 1),
  }));
  const out: T[] = [];
  const n = Math.min(count, pool.length);
  for (let k = 0; k < n; k += 1) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx += 1) {
      r -= pool[idx].w;
      if (r <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    out.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════
// 使用记录：避免总是挑到同一张
// ══════════════════════════════════════════════════════════════

/**
 * 表情使用记录（id → 最近一次使用的时间戳）。
 *
 * 为什么需要：`pickStickerMerged('无语')` 每次都会返回同一张——
 * 候选是固定的、Jev 的判断也稳定，于是同一个词连着用就会一直发同一张图。
 * 别人视角里这就是"这 bot 只会那几张"。
 */
export type StickerUsage = Record<string, number>;

export const DEFAULT_USAGE_PATH = 'private/.sticker-usage.json';
/** 默认冷却：同一张图 6 小时内不再重复用 */
export const DEFAULT_STICKER_COOLDOWN_MS = 6 * 3600_000;

export function loadStickerUsage(path: string = DEFAULT_USAGE_PATH): StickerUsage {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return raw && typeof raw === 'object' ? (raw as StickerUsage) : {};
  } catch {
    return {};
  }
}

export function saveStickerUsage(usage: StickerUsage, path: string = DEFAULT_USAGE_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(usage, null, 2), 'utf8');
  } catch {
    /* 记不下来就算了，不影响发图 */
  }
}

/** 标记某张用过（调用方在选择成功后调） */
export function markStickerUsed(id: string, path: string = DEFAULT_USAGE_PATH): void {
  const usage = loadStickerUsage(path);
  usage[id] = Date.now();
  // 顺手清理 30 天前的记录，避免文件无限增长
  const cutoff = Date.now() - 30 * 24 * 3600_000;
  for (const k of Object.keys(usage)) {
    if (usage[k] < cutoff) delete usage[k];
  }
  saveStickerUsage(usage, path);
}

/**
 * 过滤掉冷却期内的候选。
 *
 * 注意：如果全都用过（小库常见），不要返回空——退回完整列表，
 * 否则会出现"有表情却发不出去"。宁可重复，也不能不发。
 */
export function avoidRecentlyUsed(
  candidates: MergedCandidate[],
  usage: StickerUsage,
  cooldownMs: number = DEFAULT_STICKER_COOLDOWN_MS,
): MergedCandidate[] {
  const now = Date.now();
  const fresh = candidates.filter((c) => {
    const t = usage[c.id];
    return !t || now - t > cooldownMs;
  });
  return fresh.length > 0 ? fresh : candidates;
}
