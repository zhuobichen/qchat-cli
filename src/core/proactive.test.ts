import { describe, it, expect } from 'vitest';
import { inQuietHours, decideProactive, afterSend, afterReply, DEFAULT_PROACTIVE, type ProactiveState } from './proactive.js';

const HOUR = 3600;
// 2026-11-06 14:00 本地时间的近似 UTC 秒（仅用于相对计算）
const T0 = Math.floor(new Date('2026-11-06T14:00:00').getTime() / 1000);
const empty: ProactiveState = { sentToday: 0 };

describe('inQuietHours', () => {
  it('普通区间 1-5 点', () => {
    const cfg = { ...DEFAULT_PROACTIVE, quietStartHour: 1, quietEndHour: 5 };
    expect(inQuietHours(2, cfg)).toBe(true);
    expect(inQuietHours(6, cfg)).toBe(false);
  });

  it('跨零点区间 23-8', () => {
    const cfg = { ...DEFAULT_PROACTIVE, quietStartHour: 23, quietEndHour: 8 };
    expect(inQuietHours(23, cfg)).toBe(true);
    expect(inQuietHours(3, cfg)).toBe(true);
    expect(inQuietHours(9, cfg)).toBe(false);
  });

  it('起止相同视为不静默', () => {
    const cfg = { ...DEFAULT_PROACTIVE, quietStartHour: 0, quietEndHour: 0 };
    expect(inQuietHours(0, cfg)).toBe(false);
  });
});

describe('decideProactive', () => {
  const always = () => 0; // 必中概率
  const never = () => 1;

  it('免打扰时段不主动', () => {
    const midnight = Math.floor(new Date('2026-11-06T03:00:00').getTime() / 1000);
    const d = decideProactive(midnight, empty, DEFAULT_PROACTIVE, always);
    expect(d.send).toBe(false);
    expect(d.reason).toContain('免打扰');
  });

  it('今天达到上限不主动', () => {
    const d = decideProactive(T0, { sentToday: 3, day: '2026-11-06' }, DEFAULT_PROACTIVE, always);
    expect(d.send).toBe(false);
    expect(d.reason).toContain('上限');
  });

  it('跨天后计数重置（可以再发）', () => {
    const d = decideProactive(T0, { sentToday: 3, day: '2026-11-05' }, DEFAULT_PROACTIVE, always);
    expect(d.send).toBe(true);
  });

  it('最小间隔未到不主动', () => {
    const d = decideProactive(T0, { ...empty, lastSentAt: T0 - 60 * 60 }, DEFAULT_PROACTIVE, always);
    expect(d.send).toBe(false);
    expect(d.reason).toContain('还差');
  });

  it('刚聊过不主动', () => {
    const d = decideProactive(T0, { ...empty, lastActiveAt: T0 - 30 * 60 }, DEFAULT_PROACTIVE, always);
    expect(d.send).toBe(false);
    expect(d.reason).toContain('刚刚还在聊');
  });

  it('概率未命中不主动', () => {
    const d = decideProactive(T0, empty, DEFAULT_PROACTIVE, never);
    expect(d.send).toBe(false);
    expect(d.reason).toContain('概率');
  });

  it('冷场且满足条件则主动', () => {
    const d = decideProactive(T0, { ...empty, lastActiveAt: T0 - 10 * HOUR }, DEFAULT_PROACTIVE, always);
    expect(d.send).toBe(true);
  });
});

describe('状态迁移', () => {
  it('afterSend 同一天累加', () => {
    const s = afterSend(T0, { sentToday: 1, day: '2026-11-06' });
    expect(s.sentToday).toBe(2);
    expect(s.lastSentAt).toBe(T0);
  });

  it('afterSend 换天重置为 1', () => {
    const s = afterSend(T0, { sentToday: 3, day: '2026-11-05' });
    expect(s.sentToday).toBe(1);
  });

  it('afterReply 记录活跃时间', () => {
    expect(afterReply(T0, empty).lastActiveAt).toBe(T0);
  });
});
