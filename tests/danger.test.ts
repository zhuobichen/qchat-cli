/**
 * DangerGuard 单元测试
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// 模拟 inquirer
jest.mock('inquirer', () => ({
  prompt: jest.fn().mockResolvedValue({ confirm: false }),
}));

// 模拟 auditLogger
jest.mock('../src/core/audit.js', () => ({
  auditLogger: {
    warn: jest.fn(),
    success: jest.fn(),
    fail: jest.fn(),
  },
}));

import { DangerGuard, DANGEROUS_OPERATIONS } from '../src/core/danger.js';

describe('DangerGuard', () => {
  let danger: DangerGuard;

  beforeEach(() => {
    danger = new DangerGuard();
  });

  describe('bypass 模式', () => {
    it('应该正确启用 bypass 模式', () => {
      danger.enableBypass();
      expect(danger.isBypass()).toBe(true);
    });

    it('应该正确禁用 bypass 模式', () => {
      danger.enableBypass();
      danger.disableBypass();
      expect(danger.isBypass()).toBe(false);
    });

    it('bypass 模式应该跳过确认', async () => {
      danger.enableBypass();
      const result = await danger.confirm('deleteFriend', 123456);
      expect(result).toBe(true);
    });
  });

  describe('确认危险操作', () => {
    it('应该拒绝未知操作', async () => {
      const result = await danger.confirm('unknownOperation', 123456);
      expect(result).toBe(true);
    });

    it('force 参数应该跳过确认', async () => {
      const result = await danger.confirm('deleteFriend', 123456, true);
      expect(result).toBe(true);
    });

    it('critical 操作应该要求更严格的确认', async () => {
      const result = await danger.confirm('deleteFriend', 123456, false);
      expect(result).toBe(false);
    });
  });

  describe('操作信息', () => {
    it('应该正确判断是否为危险操作', () => {
      expect(danger.isDangerous('deleteFriend')).toBe(true);
      expect(danger.isDangerous('unknownOperation')).toBe(false);
    });

    it('应该返回正确的操作信息', () => {
      const operation = danger.getOperation('deleteFriend');
      expect(operation).toBeDefined();
      expect(operation?.name).toBe('删除好友');
      expect(operation?.severity).toBe('critical');
    });

    it('应该返回所有危险操作列表', () => {
      const operations = danger.listOperations();
      expect(operations.length).toBeGreaterThan(0);
      expect(operations).toContain(DANGEROUS_OPERATIONS.deleteFriend);
    });
  });
});
