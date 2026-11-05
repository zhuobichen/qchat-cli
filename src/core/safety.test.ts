/**
 * 发送授权链回归测试。
 *
 * 审计要点：白名单、全局发送开关、确认策略三者共同决定"能不能发"，
 * 任一条件失守都不应放行。这里用内存 store 覆盖判定矩阵，不触碰用户真实配置。
 */
import { describe, expect, it } from 'vitest';
import { SafetyManager, type SafetyConfig, type SafetyStore } from './safety.js';

function memoryStore(initial: Partial<SafetyConfig> = {}): SafetyStore {
  const data: SafetyConfig = {
    allowSending: false,
    allowedSessions: [],
    requireConfirmation: true,
    ...initial,
  };
  return {
    get<K extends keyof SafetyConfig>(key: K): SafetyConfig[K] {
      return data[key];
    },
    set<K extends keyof SafetyConfig>(key: K, value: SafetyConfig[K]): void {
      data[key] = value;
    },
  };
}

describe('SafetyManager.isAllowed', () => {
  it('全局开关关闭时，即使在白名单内也拒绝', () => {
    const m = new SafetyManager(memoryStore({ allowSending: false, allowedSessions: [1] }));
    expect(m.isAllowed(1)).toBe(false);
  });

  it('白名单为空时默认拒绝（不把"未配置"当成"允许全部"）', () => {
    const m = new SafetyManager(memoryStore({ allowSending: true, allowedSessions: [] }));
    expect(m.isAllowed(1)).toBe(false);
  });

  it('开关打开且命中白名单才允许', () => {
    const m = new SafetyManager(memoryStore({ allowSending: true, allowedSessions: [42] }));
    expect(m.isAllowed(42)).toBe(true);
    expect(m.isAllowed(43)).toBe(false);
  });

  it('enable/disable 立即影响判定', () => {
    const m = new SafetyManager(memoryStore({ allowSending: false, allowedSessions: [7] }));
    m.enableSending();
    expect(m.isAllowed(7)).toBe(true);
    m.disableSending();
    expect(m.isAllowed(7)).toBe(false);
  });

  it('allow/deny 维护白名单，重复 allow 不产生重复项', () => {
    const m = new SafetyManager(memoryStore({ allowSending: true }));
    m.allow(5);
    m.allow(5);
    expect(m.getConfig().allowedSessions).toEqual([5]);
    m.deny(5);
    expect(m.isAllowed(5)).toBe(false);
  });

  it('默认要求确认，可显式关闭', () => {
    const m = new SafetyManager(memoryStore());
    expect(m.isConfirmationRequired()).toBe(true);
    m.setRequireConfirmation(false);
    expect(m.isConfirmationRequired()).toBe(false);
  });
});
