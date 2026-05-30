/**
 * 测试工具函数
 */

// 模拟消息对象
export function createMockMessage(overrides: Partial<any> = {}) {
  return {
    message_id: Math.floor(Math.random() * 10000),
    message_seq: Math.floor(Math.random() * 10000),
    real_id: Math.floor(Math.random() * 10000),
    user_id: 123456,
    time: Date.now(),
    message_type: 'private',
    sender: {
      user_id: 123456,
      nickname: 'TestUser',
    },
    message: [
      {
        type: 'text',
        data: { text: 'Test message' }
      }
    ],
    raw_message: 'Test message',
    ...overrides,
  };
}

// 模拟会话对象
export function createMockSession(overrides: Partial<any> = {}) {
  return {
    type: 'friend' as const,
    id: 123456,
    name: 'Test Friend',
    ...overrides,
  };
}

// 模拟 OneBot 客户端
export function createMockClient() {
  return {
    getFriendMsgHistory: jest.fn().mockResolvedValue({ messages: [] }),
    getGroupMsgHistory: jest.fn().mockResolvedValue({ messages: [] }),
    getFriendList: jest.fn().mockResolvedValue([]),
    getGroupList: jest.fn().mockResolvedValue([]),
  };
}
