/**
 * 消息获取器
 * 用于批量获取聊天消息
 */

import { OneBotClient, Message } from './onebot-client.js';

export interface FetchOptions {
  limit?: number;
  after?: Date;
  before?: Date;
}

export type SessionType = 'friend' | 'group';

export interface Session {
  type: SessionType;
  id: number;
  name: string;
}

export class MessageFetcher {
  private client: OneBotClient;

  constructor(client: OneBotClient) {
    this.client = client;
  }

  /**
   * 获取所有会话
   */
  async getAllSessions(): Promise<Session[]> {
    const [friends, groups] = await Promise.all([
      this.client.getFriendList(),
      this.client.getGroupList(),
    ]);

    const sessions: Session[] = [
      ...friends.map(f => ({
        type: 'friend' as SessionType,
        id: f.user_id,
        name: f.remark || f.nickname,
      })),
      ...groups.map(g => ({
        type: 'group' as SessionType,
        id: g.group_id,
        name: g.group_name,
      })),
    ];

    return sessions;
  }

  /**
   * 获取会话的消息
   */
  async fetchMessages(
    session: Session,
    options: FetchOptions = {}
  ): Promise<Message[]> {
    const allMessages: Message[] = [];
    let currentSeq: number | undefined;
    const batchSize = 20;
    const limit = options.limit || Infinity;
    const maxRetries = 3;
    let consecutiveEmpty = 0;

    while (allMessages.length < limit) {
      let result: { messages: Message[] };
      let retryCount = 0;

      while (retryCount < maxRetries) {
        try {
          if (session.type === 'group') {
            result = await this.client.getGroupMsgHistory(
              session.id,
              currentSeq,
              batchSize
            );
          } else {
            result = await this.client.getFriendMsgHistory(
              session.id,
              currentSeq,
              batchSize
            );
          }
          break;
        } catch (error) {
          retryCount++;
          if (retryCount >= maxRetries) {
            console.warn(`获取消息失败 (${session.id}):`, error);
            return allMessages;
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }

      const messages = result.messages;

      if (messages.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        break;
      }
      consecutiveEmpty = 0;

      const filteredMessages = messages.filter(msg => {
        const msgTime = new Date(msg.time * 1000);
        if (options.after && msgTime < options.after) return false;
        if (options.before && msgTime > options.before) return false;
        return true;
      });

      allMessages.push(...filteredMessages);

      currentSeq = messages[messages.length - 1].message_seq;

      if (messages.length < batchSize) break;

      const lastMsgTime = new Date(messages[messages.length - 1].time * 1000);
      if (options.after && lastMsgTime < options.after) break;

      if (allMessages.length >= limit) break;
    }

    allMessages.sort((a, b) => a.time - b.time);

    return allMessages.slice(0, limit);
  }

  /**
   * 根据 ID 获取会话
   */
  async getSessionById(id: number, type?: SessionType): Promise<Session | undefined> {
    const sessions = await this.getAllSessions();
    return sessions.find(s => s.id === id && (!type || s.type === type));
  }

  /**
   * 搜索会话
   */
  async searchSessions(keyword: string): Promise<Session[]> {
    const sessions = await this.getAllSessions();
    const lowerKeyword = keyword.toLowerCase();
    return sessions.filter(s =>
      s.name.toLowerCase().includes(lowerKeyword) ||
      s.id.toString().includes(keyword)
    );
  }
}
