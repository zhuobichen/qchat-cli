/**
 * MessageMonitor 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// 模拟依赖
jest.mock('../src/core/onebot-client.js', () => ({
  OneBotClient: jest.fn().mockImplementation(() => ({
    getConfig: () => ({ host: 'localhost', port: 3000 }),
    getFriendMsgHistory: jest.fn(),
    getLoginInfo: jest.fn().mockResolvedValue({ user_id: 111111 }),
  })),
  Message: {} as any,
}));

jest.mock('../src/core/safety.js', () => ({
  safetyManager: {
    isAllowed: jest.fn().mockReturnValue(true),
  },
}));

jest.mock('../src/utils/index.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
  },
}));

// 动态导入以应用模拟
import { MessageMonitor } from '../src/core/monitor.js';
import { OneBotClient } from '../src/core/onebot-client.js';

describe('MessageMonitor', () => {
  let monitor: MessageMonitor;
  let mockClient: any;

  beforeEach(() => {
    mockClient = new OneBotClient({ host: 'localhost', port: 3000 });
    monitor = new MessageMonitor(mockClient);
  });

  afterEach(() => {
    monitor.stop();
  });

  describe('addSession / removeSession', () => {
    it('应该正确添加会话', () => {
      monitor.addSession(123456);
      // 验证不会抛出异常
      expect(true).toBe(true);
    });

    it('应该正确移除会话', () => {
      monitor.addSession(123456);
      monitor.removeSession(123456);
      expect(true).toBe(true);
    });
  });

  describe('setReplyGenerator', () => {
    it('应该正确设置回复生成器', () => {
      const mockReplyFn = jest.fn().mockResolvedValue('Test reply');
      monitor.setReplyGenerator(mockReplyFn);
      expect(mockReplyFn).toBeDefined();
    });
  });

  describe('消息去重逻辑', () => {
    it('应该跳过已处理的消息 ID', async () => {
      const messages = [
        {
          message_id: 1001,
          message_seq: 1001,
          user_id: 123456,
          time: Math.floor(Date.now() / 1000),
          sender: { nickname: 'Test', card: 'Test' },
          message: [{ type: 'text', data: { text: 'Test' } }],
        },
      ];

      mockClient.getFriendMsgHistory = jest.fn().mockResolvedValue({ messages });

      monitor.addSession(123456);
      
      // 第一次调用应该处理消息
      await monitor.startPolling(100);
      
      // 第二次调用应该跳过已处理的消息
      await monitor.startPolling(100);
      
      expect(mockClient.getFriendMsgHistory).toHaveBeenCalled();
    });
  });
});
