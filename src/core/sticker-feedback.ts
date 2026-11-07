import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 表情发的「反馈」记录：发出去之后，有没有人接。
 *
 * 这是唯一可测量的「会不会用梗」信号。
 * 不需要懂梗的含义——只需要统计「什么样的图，发出去有人回」。
 *
 * 数据流：
 *   发出 → 记一条 pending（带 scope 和时间）
 *   过几分钟 → 回看那个群的记录，判断有没有人回应 → 结算成 engaged / ignored
 *   选图时 → 用历史 engagement 率给权重加成
 *
 * 注意：engagement 是**弱信号**。群里没人理一张图，也可能是当时没人说话，
 * 不代表这张图不好。所以只能用很小的权重（默认 ±15%），不能让它主导排序。
 */

export type FeedbackOutcome = 'engaged' | 'ignored' | 'pending';

export interface StickerFeedbackEvent {
  /** 表情 hash */
  id: string;
  /** 用它的意图（用来分组统计） */
  intent: string;
  /** group:<id> / private:<uin> */
  scope: string;
  sentAt: number;
  outcome: FeedbackOutcome;
  /** 结算时间 */
  resolvedAt?: number;
  /** 结算时窗口内收到的别人消息数 */
  replies?: number;
}

export interface StickerFeedbackFile {
  events: StickerFeedbackEvent[];
}

export const DEFAULT_FEEDBACK_PATH = 'private/.sticker-feedback.json';
/** 发出后多久开始结算 */
export const RESOLVE_DELAY_MS = 3 * 60_000;
/** 结算窗口：发出后这段时间内别人的消息算「有人接」 */
export const RESOLVE_WINDOW_MS = 5 * 60_000;
/** 最多保留多少条事件（防止文件无限增长） */
const MAX_EVENTS = 4000;

export function loadFeedback(path = DEFAULT_FEEDBACK_PATH): StickerFeedbackFile {
  try {
    if (!existsSync(path)) return { events: [] };
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return { events: Array.isArray(raw?.events) ? raw.events : [] };
  } catch {
    return { events: [] };
  }
}

export function saveFeedback(file: StickerFeedbackFile, path = DEFAULT_FEEDBACK_PATH): void {
  try {
    const events = file.events.slice(-MAX_EVENTS);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ events }, null, 2), 'utf8');
  } catch {
    /* 记不下来不影响发图 */
  }
}

/** 记录一次「发出去了」 */
export function recordStickerSent(
  id: string,
  intent: string,
  scope: string,
  path = DEFAULT_FEEDBACK_PATH,
): void {
  const file = loadFeedback(path);
  file.events.push({ id, intent, scope, sentAt: Date.now(), outcome: 'pending' });
  saveFeedback(file, path);
}

/**
 * 结算到期事件。
 *
 * @param countReplies 给 (scope, since, until) 返回窗口内「别人」的消息数。
 *   由调用方注入，因为这个模块不应该知道 OneBot 的细节。
 */
export function resolvePending(
  countReplies: (scope: string, since: number, until: number) => number,
  now = Date.now(),
  path = DEFAULT_FEEDBACK_PATH,
): { resolved: number; engaged: number } {
  const file = loadFeedback(path);
  let resolved = 0;
  let engaged = 0;
  for (const ev of file.events) {
    if (ev.outcome !== 'pending') continue;
    if (now - ev.sentAt < RESOLVE_DELAY_MS) continue;
    let replies = 0;
    try {
      replies = countReplies(ev.scope, ev.sentAt, ev.sentAt + RESOLVE_WINDOW_MS);
    } catch {
      continue; // 查不到就留 pending，下次再试
    }
    ev.replies = replies;
    ev.outcome = replies > 0 ? 'engaged' : 'ignored';
    ev.resolvedAt = now;
    resolved += 1;
    if (replies > 0) engaged += 1;
  }
  if (resolved > 0) saveFeedback(file, path);
  return { resolved, engaged };
}

export interface StickerStat {
  sent: number;
  engaged: number;
  /** engaged / sent，样本太少时为 null */
  rate: number | null;
}

/**
 * 汇总每张图的 engagement。
 * 少于 MIN_SAMPLES 次不发 rate —— 一次偶然有人接不能当成「好图」。
 */
export const MIN_SAMPLES = 3;

export function statsBySticker(path = DEFAULT_FEEDBACK_PATH): Map<string, StickerStat> {
  const file = loadFeedback(path);
  const acc = new Map<string, { sent: number; engaged: number }>();
  for (const ev of file.events) {
    if (ev.outcome === 'pending') continue;
    const cur = acc.get(ev.id) ?? { sent: 0, engaged: 0 };
    cur.sent += 1;
    if (ev.outcome === 'engaged') cur.engaged += 1;
    acc.set(ev.id, cur);
  }
  const out = new Map<string, StickerStat>();
  for (const [id, v] of acc) {
    out.set(id, {
      sent: v.sent,
      engaged: v.engaged,
      rate: v.sent >= MIN_SAMPLES ? v.engaged / v.sent : null,
    });
  }
  return out;
}

/**
 * 把 engagement 换成一个温和的权重倍数。
 *
 * 上限 ±15%：这是弱信号，不能盖过「贴不贴合意图」这个主判据。
 * 没有足够样本时返回 1（不加不减）。
 */
export function feedbackMultiplier(stat: StickerStat | undefined): number {
  if (!stat || stat.rate === null) return 1;
  // rate 0 → 0.85，rate 0.5 → 1.0，rate 1 → 1.15
  return 0.85 + stat.rate * 0.3;
}
