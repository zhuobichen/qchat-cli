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
export declare class MessageFetcher {
    private client;
    constructor(client: OneBotClient);
    /**
     * 获取所有会话
     */
    getAllSessions(): Promise<Session[]>;
    /**
     * 获取会话的消息
     */
    fetchMessages(session: Session, options?: FetchOptions): Promise<Message[]>;
    /**
     * 根据 ID 获取会话
     */
    getSessionById(id: number, type?: SessionType): Promise<Session | undefined>;
    /**
     * 搜索会话
     */
    searchSessions(keyword: string): Promise<Session[]>;
}
//# sourceMappingURL=fetcher.d.ts.map