/**
 * 分段回复：把一整段话拆成几条发，模拟真人打字的节奏。
 *
 * 为什么需要：真人说话是「一句，停一下，又一句」。一次吐一整段，
 * 就算内容像人，节奏也不像。这是感知差异最大、成本最低的一项。
 *
 * 但不能乱拆：
 *   - 拆太碎像抽风（"这题" / "我熟" / "。"）
 *   - 拆错位置会断句（把"不是A而是B"拆成两条，意思就散了）
 *   - 长文不该拆（教东西的时候整段更好读）
 */

export interface SegmentOptions {
  /** 最多拆几段，默认 3 */
  maxSegments?: number;
  /** 每段最短多少字才值得单独发，默认 4 */
  minSegmentChars?: number;
  /** 太短的整体回复不拆（默认 12 字以下不拆） */
  noSplitBelow?: number;
  /** 太长的不拆（默认 200 字以上整段发，别刷屏） */
  noSplitAbove?: number;
  /**
   * 段间基础间隔（毫秒）。实际间隔 = 基础 + 段字数 × 打字速度。
   * 默认 700ms，模拟"想一想再说下一句"。
   */
  baseDelayMs?: number;
  /** 每字耗时（毫秒），默认 90ms ≈ 每秒 11 字，接近正常打字 */
  perCharMs?: number;
}

export interface Segment {
  text: string;
  /** 发完这段之后要等多久再发下一段（最后一段为 0） */
  delayAfterMs: number;
}

export interface SegmentResult {
  segments: Segment[];
  /** 没拆的原因（调试用） */
  reason: string;
}

const DEFAULTS: Required<SegmentOptions> = {
  maxSegments: 3,
  minSegmentChars: 4,
  noSplitBelow: 12,
  noSplitAbove: 200,
  baseDelayMs: 700,
  perCharMs: 90,
};

/** 这些连接词前后不该断开——断了就读不通 */
const GLUE_BEFORE = /(因为|所以|但是|不过|而且|如果|就是|还是|或者|不然|否则|虽然|即使|哪怕|要是|除了|关于|对于|至于)$/;
const GLUE_AFTER = /^(而|就|才|也|还|都|又|再|却|并|且|但|可|所以|因为|但是|不过|而且|如果)/;

/**
 * 判断在位置 i 断开是否合理。
 *
 * 只有三种位置可以断：
 *   ① 句末标点之后（。！？；…）
 *   ② 逗号之后，且**后面是完整句子**（下一个字不是连接词）
 *   ③ 换行之后（用户自己分的段，尊重原意）
 */
function canSplitAt(text: string, i: number): boolean {
  const ch = text[i];
  if (ch === '\n') return true;
  if ('。！？!?…'.includes(ch)) return true;
  if ('，,；;'.includes(ch)) {
    const before = text.slice(Math.max(0, i - 8), i);
    const after = text.slice(i + 1, i + 4).trimStart();
    if (GLUE_BEFORE.test(before)) return false;
    if (GLUE_AFTER.test(after)) return false;
    return true;
  }
  return false;
}

/**
 * 把一段回复拆成几段。
 *
 * 策略：**从后往前找最平衡的切点**，而不是从头切。
 * 从头切容易切出"这一句很长、后面两句很短"的畸形节奏。
 */
export function splitReply(text: string, options: SegmentOptions = {}): SegmentResult {
  const opts = { ...DEFAULTS, ...options };
  const raw = String(text ?? '').trim();

  if (!raw) return { segments: [], reason: '空' };
  if (raw.length < opts.noSplitBelow) return { segments: [makeSegment(raw, 0, opts)], reason: '太短，不拆' };
  if (raw.length > opts.noSplitAbove) return { segments: [makeSegment(raw, 0, opts)], reason: '太长，整段发更好读' };

  // 收集所有合法切点，并给每个点记一个"强度"：
  // 句末标点（。！？）= 3，分号 = 2，逗号 = 1。
  // 优先在强的位置断——「这题我熟。雪乃是答案，由比滨是手艺。」
  // 该断在句号，不该断在逗号。
  const cuts: Array<{ at: number; strength: number }> = [];
  for (let i = 0; i < raw.length - 1; i += 1) {
    if (!canSplitAt(raw, i)) continue;
    const left = raw.slice(0, i + 1).trim();
    const right = raw.slice(i + 1).trim();
    if (left.length < opts.minSegmentChars || right.length < opts.minSegmentChars) continue;
    const ch = raw[i];
    const nl = String.fromCharCode(10);
    const strength = '。！？!?…'.includes(ch) ? 3 : '；;'.includes(ch) ? 2 : ch === nl ? 3 : 1;
    cuts.push({ at: i, strength });
  }
  if (cuts.length === 0) return { segments: [makeSegment(raw, 0, opts)], reason: '没有合适的断点' };

  // 短句自动降档：20 字以内最多 2 段，50 字以内最多 2 段，再长才允许 3 段。
  // 不降档的话，"这题我熟。雪乃是答案，由比滨是手艺。" 会被切成三截，像抽风。
  const adaptiveMax = raw.length <= 50 ? 2 : 3;
  const maxSeg = Math.min(opts.maxSegments, adaptiveMax);

  // 选切点：优先让各段长度接近，且切点数不超过 maxSegments-1
  const targetLen = raw.length / Math.min(maxSeg, cuts.length + 1);
  const chosen: number[] = [];
  let searchFrom = 0;
  for (let k = 1; k < maxSeg; k += 1) {
    const want = Math.round(targetLen * k);
    const candidates = cuts.filter((c) => c.at > searchFrom && c.at < raw.length - opts.minSegmentChars);
    if (candidates.length === 0) break;
    // 打分：离目标位置越近越好；强度高的点额外加分（让句号赢过逗号）
    const best = candidates.reduce((a, b) => {
      const sa = -Math.abs(a.at - want) + a.strength * 5;
      const sb = -Math.abs(b.at - want) + b.strength * 5;
      return sb > sa ? b : a;
    });
    if (chosen.includes(best.at)) break;
    chosen.push(best.at);
    searchFrom = best.at + 1;
  }
  if (chosen.length === 0) return { segments: [makeSegment(raw, 0, opts)], reason: '切点不合用' };

  chosen.sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = 0;
  for (const c of chosen) {
    parts.push(raw.slice(prev, c + 1).trim());
    prev = c + 1;
  }
  parts.push(raw.slice(prev).trim());

  const cleaned = parts.filter((p) => p.length > 0);
  if (cleaned.length <= 1) return { segments: [makeSegment(raw, 0, opts)], reason: '拆完只剩一段' };

  return {
    segments: cleaned.map((p, i) => makeSegment(p, i, opts, cleaned.length)),
    reason: `拆成 ${cleaned.length} 段`,
  };
}

function makeSegment(text: string, index: number, opts: Required<SegmentOptions>, total = 1): Segment {
  const isLast = index === total - 1;
  return {
    text,
    // 打字时间 = 字数 × 每字耗时，但加上下限和上限，免得等太久或太快
    delayAfterMs: isLast
      ? 0
      : Math.min(2600, Math.max(opts.baseDelayMs, opts.baseDelayMs + text.length * opts.perCharMs * 0.35)),
  };
}

/**
 * 判断一段回复适不适合拆。
 *
 * 有些内容天然不该拆：
 *   - 代码块
 *   - 列表
 *   - 引用
 *   - 含 URL
 *   - 一句话里有多个分号（像在列清单）
 */
export function isSplittable(text: string): { ok: boolean; reason: string } {
  const t = String(text ?? '');
  if (/```/.test(t)) return { ok: false, reason: '含代码块' };
  if (/https?:\/\//.test(t)) return { ok: false, reason: '含链接' };
  if (/^\s*[-*•]\s+/m.test(t)) return { ok: false, reason: '含列表' };
  if (/^\s*>/m.test(t)) return { ok: false, reason: '含引用' };
  if ((t.match(/[；;]/g) ?? []).length >= 3) return { ok: false, reason: '像清单' };
  return { ok: true, reason: '' };
}

/** 一步到位：适合拆就拆，不适合就给单段 */
export function segmentReply(text: string, options: SegmentOptions = {}): SegmentResult {
  const check = isSplittable(text);
  if (!check.ok) return { segments: [makeSegment(String(text).trim(), 0, { ...DEFAULTS, ...options })], reason: check.reason };
  return splitReply(text, options);
}
