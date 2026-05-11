/**
 * 消息监控模块
 * 监听指定会话的消息并自动回复
 */
import { OneBotClient, Message } from './onebot-client.js';
export interface MonitorConfig {
    sessionId: number;
    enabled: boolean;
    autoReply: boolean;
}
export declare class MessageMonitor {
    private client;
    private wsUrl;
    private ws;
    private monitoredSessions;
    private lastMessageSeq;
    private pollingInterval;
    private replyCallback;
    constructor(client: OneBotClient);
    /**
     * 设置回复生成器
     */
    setReplyGenerator(callback: (message: Message) => Promise<string>): void;
    /**
     * 添加监控会话
     */
    addSession(sessionId: number): void;
    /**
     * 移除监控会话
     */
    removeSession(sessionId: number): void;
    /**
     * 开始监控（使用轮询方式）
     */
    startPolling(intervalMs?: number): Promise<void>;
    /**
     * 停止监控
     */
    stop(): void;
    /**
     * 检查新消息
     */
    private checkNewMessages;
    /**
     * 显示消息
     */
    private displayMessage;
    /**
     * 获取消息文本
     */
    private getMessageText;
    /**
     * 自动回复
     */
    private autoReply;
}
//# sourceMappingURL=monitor.d.ts.map