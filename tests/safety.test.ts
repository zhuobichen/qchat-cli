/**
 * SafetyManager 单元测试
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// 模拟 Conf
jest.mock('conf', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn((key: string) => {
      const store: Record<string, any> = {
        allowSending: false,
        allowedSessions: [],
        requireConfirmation: true,
      };
      return store[key];
    }),
    set: jest.fn((key: string, value: any) => {
      const store: Record<string, any> = {
        allowSending: false,
        allowedSessions: [],
        requireConfirmation: true,
      };
      store[key] = value;
    }),
  }));
});

import { SafetyManager } from '../src/core/safety.js';

describe('SafetyManager', () => {
  let safety: SafetyManager;

  beforeEach(() => {
    safety = new SafetyManager();
  });

  describe('isAllowed', () => {
    it('应该在 allowSending 为 false 时返回 false', () => {
      safety.disableSending();
      expect(safety.isAllowed(123456)).toBe(false);
    });

    it('应该在 allowSending 为 true 且白名单为空时返回 true', () => {
      safety.enableSending();
      expect(safety.isAllowed(123456)).toBe(true);
    });

    it('应该在白名单包含目标 ID 时返回 true', () => {
      safety.enableSending();
      safety.allow(123456);
      expect(safety.isAllowed(123456)).toBe(true);
    });

    it('应该在白名单不包含目标 ID 时返回 false', () => {
      safety.enableSending();
      safety.allow(999999);
      expect(safety.isAllowed(123456)).toBe(false);
    });
  });

  describe('allow / deny', () => {
    it('应该正确添加会话到白名单', () => {
      safety.allow(123456);
      expect(safety.isAllowed(123456)).toBe(true);
    });

    it('应该正确从白名单移除会话', () => {
      safety.allow(123456);
      safety.deny(123456);
      expect(safety.isAllowed(123456)).toBe(false);
    });

    it('应该防止重复添加', () => {
      safety.allow(123456);
      safety.allow(123456);
      const config = safety.getConfig();
      expect(config.allowedSessions.filter(id => id === 123456).length).toBe(1);
    });
  });

  describe('enableSending / disableSending', () => {
    it('应该正确启用发送功能', () => {
      safety.disableSending();
      expect(safety.isAllowed(123456)).toBe(false);
      safety.enableSending();
      expect(safety.isAllowed(123456)).toBe(true);
    });

    it('应该正确禁用发送功能', () => {
      safety.enableSending();
      expect(safety.isAllowed(123456)).toBe(true);
      safety.disableSending();
      expect(safety.isAllowed(123456)).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('应该返回当前配置', () => {
      const config = safety.getConfig();
      expect(config).toHaveProperty('allowSending');
      expect(config).toHaveProperty('allowedSessions');
      expect(config).toHaveProperty('requireConfirmation');
    });
  });
});
