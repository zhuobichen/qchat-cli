import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 结构化知识：网络用语 / 梗 / 群内黑话。
 *
 * 为什么需要：「学抽象文化」不能靠模型自己长，得有一条**可积累、可检索**的词库。
 * 每一轮对话用到的梗，应该在回复前被检索出来塞进上下文——这样才叫"用上了"。
 *
 * 存储用 JSONL（一行一条），便于追加和人工编辑：
 *   private/knowledge/terms.jsonl
 *
 * 一条的样子：
 *   {"term":"卷","meaning":"内卷，无意义的过度竞争","usage":"这已经卷到饭点了",
 *    "tone":"自嘲","scope":"global","addedAt":1699999999999,"hits":0}
 */

export interface KnowledgeTerm {
  term: string;
  /** 这个词是什么意思 */
  meaning: string;
  /** 一个可以照着用的例句 */
  usage?: string;
  /** 语气：自嘲 / 嘲讽 / 敷衍 / 惊讶 … */
  tone?: string;
  /** global 或 group:<id>，群内黑话只在该群生效 */
  scope?: string;
  /** 来源：manual（人工） / chime（数据集） / live（热榜新捞的） */
  source?: string;
  addedAt: number;
  /** 被检索命中过几次（用来判断有没有真的在用） */
  hits?: number;
  /** 这个词大约是什么时候开始流行的（毫秒时间戳）；不知道就用导入时间 */
  firstSeenAt?: number;
  /** 最后一次实际见到有人用它（群聊里出现会刷新）；比 firstSeenAt 更能说明"现在还活着" */
  lastSeenAt?: number;
  /** 时代标签，例如 chime-2025 / live-2026-11 */
  era?: string;
  /** 风险标记（脏话/冒犯），这类不该主动用 */
  risky?: boolean;
  /**
   * 资料可信度/优先级。high = 权威来源整理过的（如梗百科逐期视频），
   * 检索时优先取、喂给 whisper 做术语提示时也优先取。缺省按 normal 处理。
   */
  priority?: 'high' | 'normal';
  /** 出处说明（来自数据集时保留原意） */
  origin?: string;
  /**
   * 这个梗的流行时间**不知道**（数据集没给逐条日期）。
   *
   * 为什么单独标：把 1282 条数据集词条统一填成"2025-10-01"是假精确——
   * 里面既有十年前的死梗，也有上个月还在用的。宁可承认不知道，
   * 也不要拿一个编出来的日期去算时效。
   */
  ageUnknown?: boolean;
}

export const DEFAULT_TERMS_PATH = 'private/knowledge/terms.jsonl';

export function loadTerms(path = DEFAULT_TERMS_PATH): KnowledgeTerm[] {
  try {
    if (!existsSync(path)) return [];
    const text = readFileSync(path, 'utf8');
    const out: KnowledgeTerm[] = [];
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      try {
        const t = JSON.parse(s);
        if (t && typeof t.term === 'string' && t.term.trim()) out.push(t);
      } catch {
        /* 单行坏掉不影响整体 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function appendTerm(term: KnowledgeTerm, path = DEFAULT_TERMS_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(term) + '\n', 'utf8');
  } catch {
    /* 写不进去不影响主流程 */
  }
}

export function rewriteTerms(terms: KnowledgeTerm[], path = DEFAULT_TERMS_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, terms.map((t) => JSON.stringify(t)).join('\n') + '\n', 'utf8');
  } catch {
    /* 同上 */
  }
}

/**
 * 找出「我大概不认识」的词：聊天里出现、词库里没有、也不是常用字。
 *
 * 判据故意保守——宁可漏，不要滥。误判会把正常句子拆成一堆"生词"。
 *   - 只收 2~6 个汉字
 *   - 排除纯数字/纯字母
 *   - 排除"的了吗呢吧"这类高频虚词开头
 */
const STOP_CHARS = new Set('的了是吗呢吧啊呀哦嗯在就都也还和与或但而所以因为如果这个那个我们你们他们'.split(''));
const STOP_TERMS = new Set([
  '什么', '怎么', '为什么', '可以', '没有', '知道', '觉得', '应该', '可能', '还是',
  '就是', '不是', '现在', '时候', '这样', '那样', '一个', '一下', '东西', '问题',
]);

export function detectUnknownTerms(
  messages: string[],
  known: KnowledgeTerm[],
  options: { scope?: string } = {},
): string[] {
  const knownSet = new Set(known.map((t) => t.term));
  const counts = new Map<string, number>();

  for (const msg of messages) {
    // 抓连续汉字串，再切成 2~6 字的候选
    const runs = msg.match(/[\u4e00-\u9fa5]{2,12}/g) ?? [];
    for (const run of runs) {
      for (let len = 2; len <= 6; len += 1) {
        for (let i = 0; i + len <= run.length; i += 1) {
          const w = run.slice(i, i + len);
          if (knownSet.has(w) || STOP_TERMS.has(w)) continue;
          if (STOP_CHARS.has(w[0])) continue;
          counts.set(w, (counts.get(w) ?? 0) + 1);
        }
      }
    }
  }

  // 只留反复出现的：一次巧合不算词
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([w]) => w);
}

/**
 * 从给定文本里检索相关词条，供回复时注入上下文。
 *
 * 简单的子串命中 + 使用次数加权。这里不上向量：
 * 词库规模小（几百条），子串足够了，而且解释性强、不会莫名召回。
 */
export function findRelevantTerms(
  text: string,
  terms: KnowledgeTerm[],
  options: { scope?: string; limit?: number } = {},
): KnowledgeTerm[] {
  const limit = options.limit ?? 5;
  const scope = options.scope;
  const hits = terms
    .filter((t) => {
      if (scope && t.scope && t.scope !== 'global' && t.scope !== scope) return false;
      return text.includes(t.term);
    })
    .map((t) => ({ t, score: t.term.length + Math.min(t.hits ?? 0, 5) * 0.1 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return hits.map((h) => h.t);
}

/** 把命中的词条渲染成一段可注入 prompt 的说明 */
export function renderTermsForPrompt(terms: KnowledgeTerm[]): string {
  if (terms.length === 0) return '';
  const lines = terms.map((t) => {
    const parts = [`「${t.term}」= ${t.meaning}`];
    if (t.tone) parts.push(`语气：${t.tone}`);
    if (t.usage) parts.push(`例：${t.usage}`);
    return `- ${parts.join('；')}`;
  });
  return `群友可能提到的词（按语境理解，别硬解释）：\n${lines.join('\n')}`;
}


// ══════════════════════════════════════════════════════════════
// 时效：梗会过期
// ══════════════════════════════════════════════════════════════

/**
 * 梗的"半衰期"：半年。
 *
 * 为什么是半年：网络梗的生命周期通常 3~12 个月。半年的半衰期意味着
 * 一年后新鲜度约 0.25（能理解，但别用），两年后约 0.06（基本别提）。
 */
export const MEME_HALF_LIFE_MS = 180 * 24 * 3600_000;

/** 低于这个新鲜度就只"能听懂"，不建议自己用 */
export const USABLE_THRESHOLD = 0.45;

function referenceTime(t: KnowledgeTerm): number {
  // lastSeenAt（真见过有人用）比 firstSeenAt 更能说明"现在还活着"
  return t.lastSeenAt ?? t.firstSeenAt ?? t.addedAt ?? 0;
}

/**
 * 新鲜度 0~1。
 * 1 = 刚流行；0.5 = 半年前；0.25 = 一年前。
 * 被人用过（lastSeenAt 刷新）会回春。
 */
/** 「年龄未知」时的中性新鲜度：不新也不旧，能用但要克制 */
export const UNKNOWN_AGE_FRESHNESS = 0.5;

export function freshness(t: KnowledgeTerm, now = Date.now()): number {
  // 真见过有人用（lastSeenAt）就按那个算——这是最可信的"还活着"证据
  if (!t.lastSeenAt && t.ageUnknown) return UNKNOWN_AGE_FRESHNESS;
  const ref = referenceTime(t);
  if (!ref) return UNKNOWN_AGE_FRESHNESS;
  const age = Math.max(0, now - ref);
  return Math.pow(0.5, age / MEME_HALF_LIFE_MS);
}

/** 这个梗现在还能不能自己用 */
export function isUsable(t: KnowledgeTerm, now = Date.now()): boolean {
  if (t.risky) return false;
  return freshness(t, now) >= USABLE_THRESHOLD;
}

/**
 * 检索相关词条。返回按"相关度 × 新鲜度"排序的结果。
 *
 * 关键：**过时的词也返回**（要能听懂群友在说什么），
 * 但会带上 usable=false，注入 prompt 时会明确标成"懂但别用"。
 */
export function findRelevantTermsLive(
  text: string,
  terms: KnowledgeTerm[],
  options: { scope?: string; limit?: number; now?: number } = {},
): Array<{ term: KnowledgeTerm; score: number; fresh: number; usable: boolean }> {
  const limit = options.limit ?? 6;
  const now = options.now ?? Date.now();
  const scope = options.scope;
  const out: Array<{ term: KnowledgeTerm; score: number; fresh: number; usable: boolean }> = [];
  for (const t of terms) {
    if (scope && t.scope && t.scope !== 'global' && t.scope !== scope) continue;
    if (!text.includes(t.term)) continue;
    const fresh = freshness(t, now);
    // 相关度：词越长越具体；再乘新鲜度，让新梗优先浮上来
    const base = Math.min(t.term.length, 6) / 6;
    out.push({ term: t, score: base * (0.35 + 0.65 * fresh), fresh, usable: isUsable(t, now) });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/** 把检索结果渲染成 prompt 片段，明确区分「能用」和「只配听懂」 */
export function renderTermsLiveForPrompt(
  hits: Array<{ term: KnowledgeTerm; fresh: number; usable: boolean }>,
): string {
  if (hits.length === 0) return '';
  const usable = hits.filter((h) => h.usable);
  const stale = hits.filter((h) => !h.usable);
  const lines: string[] = [];

  if (usable.length) {
    lines.push('这些梗现在还在用，可以自然地带一句：');
    for (const h of usable) {
      const parts = [`「${h.term.term}」= ${h.term.meaning}`];
      if (h.term.usage) parts.push(`例：${h.term.usage}`);
      lines.push(`- ${parts.join('；')}`);
    }
  }
  const unknown = stale.filter((h) => h.term.ageUnknown && !h.term.lastSeenAt);
  const deadstale = stale.filter((h) => !(h.term.ageUnknown && !h.term.lastSeenAt));
  if (unknown.length) {
    lines.push('');
    lines.push('这些梗不确定现在还流不流行（别主动用，只在别人先提时接）：');
    for (const h of unknown) {
      lines.push(`- 「${h.term.term}」= ${h.term.meaning}`);
    }
  }
  if (deadstale.length) {
    lines.push('');
    lines.push('这些是过时/敏感的老梗：**听得懂就行，别自己用**（用了会显得土或冒犯）：');
    for (const h of deadstale) {
      lines.push(`- 「${h.term.term}」= ${h.term.meaning}`);
    }
  }
  return lines.join(String.fromCharCode(10));
}

/** 记录"真的见到有人用了"，让这个词回春 */
export function touchTermSeen(terms: KnowledgeTerm[], now = Date.now()): number {
  let n = 0;
  for (const t of terms) {
    t.lastSeenAt = now;
    t.hits = (t.hits ?? 0) + 1;
    n += 1;
  }
  return n;
}
