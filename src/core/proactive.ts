/**
 * 主动聊天：决定「现在要不要主动发一条」。
 *
 * 只借鉴 astrbot 那套（AGPL，代码不能用）的设计要素，实现是独立的：
 *   - 免打扰时段（quiet hours）
 *   - 最小间隔（min gap）
 *   - 每日上限
 *   - 概率触发
 *   - 最近没聊过才主动（lastActiveAt）
 *
 * 纯函数，随机源可注入，便于确定性单测。
 */

export interface ProactiveConfig {
  /** 免打扰起止小时（24 制，可跨零点，如 23 → 8） */
  quietStartHour: number;
  quietEndHour: number;
  /** 两条主动消息之间的最小间隔（分钟） */
  minGapMinutes: number;
  /** 每天最多主动几次 */
  maxPerDay: number;
  /** 触发概率 0-1 */
  probability: number;
  /** 多久没互动才算"冷场"（分钟） */
  idleMinutes: number;
}

export const DEFAULT_PROACTIVE: ProactiveConfig = {
  quietStartHour: 23,
  quietEndHour: 8,
  minGapMinutes: 180,
  maxPerDay: 3,
  probability: 0.35,
  idleMinutes: 240,
};

export interface ProactiveState {
  /** 上次主动发送时间（秒） */
  lastSentAt?: number;
  /** 今天已发几条 */
  sentToday: number;
  /** sentToday 对应的日期（YYYY-MM-DD） */
  day?: string;
  /** 上次和这个人/群有互动的时间（秒） */
  lastActiveAt?: number;
}

export interface Decision {
  send: boolean;
  reason: string;
}

/** 当前小时是否落在免打扰区间（支持跨零点） */
export function inQuietHours(hour: number, config: ProactiveConfig = DEFAULT_PROACTIVE): boolean {
  const { quietStartHour: start, quietEndHour: end } = config;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;   // 跨零点，如 23-8
}

function dayKey(now: number): string {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

/**
 * 核心决策。所有"不发"的分支都带原因，便于日志与调试。
 */
export function decideProactive(
  now: number,
  state: ProactiveState,
  config: ProactiveConfig = DEFAULT_PROACTIVE,
  random: () => number = Math.random,
): Decision {
  const hour = new Date(now * 1000).getHours();
  if (inQuietHours(hour, config)) return { send: false, reason: `免打扰时段（${config.quietStartHour}-${config.quietEndHour} 点）` };

  const today = dayKey(now);
  const sentToday = state.day === today ? state.sentToday : 0;
  if (sentToday >= config.maxPerDay) return { send: false, reason: `今天已主动 ${sentToday} 次，达到上限` };

  if (state.lastSentAt && now - state.lastSentAt < config.minGapMinutes * 60) {
    const wait = Math.ceil((config.minGapMinutes * 60 - (now - state.lastSentAt)) / 60);
    return { send: false, reason: `距上次主动还差 ${wait} 分钟` };
  }

  if (state.lastActiveAt && now - state.lastActiveAt < config.idleMinutes * 60) {
    return { send: false, reason: '刚刚还在聊，不需要主动找' };
  }

  if (random() > config.probability) return { send: false, reason: `概率未命中（${config.probability}）` };

  return { send: true, reason: '冷场且有额度' };
}

/** 发送后更新状态（跨天自动重置计数） */
export function afterSend(now: number, state: ProactiveState): ProactiveState {
  const today = dayKey(now);
  const sentToday = state.day === today ? state.sentToday + 1 : 1;
  return { ...state, lastSentAt: now, sentToday, day: today };
}

/** 收到对方消息时更新活跃时间 */
export function afterReply(now: number, state: ProactiveState): ProactiveState {
  return { ...state, lastActiveAt: now };
}
