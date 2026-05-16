/**
 * 消息监控模块
 * 监听指定会话的消息并自动回复
 */

import chalk from 'chalk';
import { OneBotClient, Message } from './onebot-client.js';
import { safetyManager } from './safety.js';
import { logger } from '../utils/index.js';

export interface MonitorConfig {
  sessionId: number;
  enabled: boolean;
  autoReply: boolean;
}

export class MessageMonitor {
  private client: OneBotClient;
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private monitoredSessions: Set<number> = new Set();
  private lastMessageSeq: Map<number, number> = new Map();
  private processedMessageIds: Set<number> = new Set();  // 已处理的消息 ID，防止重复
  private pollingInterval: NodeJS.Timeout | null = null;
  private replyCallback: ((message: Message) => Promise<string>) | null = null;
  private _selfId: number | null = null;
  private isProcessing: Map<number, boolean> = new Map();  // 防止并发处理同一会话

  constructor(client: OneBotClient) {
    this.client = client;
    const config = client.getConfig();
    this.wsUrl = `ws://${config.host}:${config.port}`;
  }

  private async getSelfId(): Promise<number> {
    if (this._selfId !== null) return this._selfId;
    try {
      const info = await this.client.getLoginInfo();
      this._selfId = info.user_id;
      return this._selfId;
    } catch { return 0; }
  }

  /**
   * 设置回复生成器
   */
  setReplyGenerator(callback: (message: Message) => Promise<string>) {
    this.replyCallback = callback;
  }

  /**
   * 添加监控会话
   */
  addSession(sessionId: number) {
    this.monitoredSessions.add(sessionId);
    console.log(chalk.green(`已添加监控会话: ${sessionId}`));
  }

  /**
   * 移除监控会话
   */
  removeSession(sessionId: number) {
    this.monitoredSessions.delete(sessionId);
    console.log(chalk.green(`已移除监控会话: ${sessionId}`));
  }

  /**
   * 开始监控（使用轮询方式）
   */
  async startPolling(intervalMs: number = 5000) {
    if (this.monitoredSessions.size === 0) {
      console.log(chalk.yellow('没有监控会话'));
      return;
    }

    console.log(chalk.bold('开始监控...'));
    console.log(chalk.dim(`监控会话: ${Array.from(this.monitoredSessions).join(', ')}`));
    console.log(chalk.dim(`轮询间隔: ${intervalMs}ms`));
    console.log(chalk.dim('按 Ctrl+C 停止'));
    console.log('');

    // 初始化最后消息 ID
    for (const sessionId of this.monitoredSessions) {
      try {
        const result = await this.client.getFriendMsgHistory(sessionId, undefined, 1);
        if (result.messages.length > 0) {
          const lastMsgId = result.messages[0].message_id;
          this.lastMessageSeq.set(sessionId, lastMsgId);
          this.processedMessageIds.add(lastMsgId);  // 避免重复处理最新一条
          console.log(chalk.dim(`  会话 ${sessionId} 初始化完成，最后消息 ID: ${lastMsgId}`));
        }
      } catch (error) {
        console.log(chalk.yellow(`初始化会话 ${sessionId} 失败: ${error}`));
      }
    }

    // 开始轮询
    this.pollingInterval = setInterval(async () => {
      await this.checkNewMessages();
    }, intervalMs);
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log(chalk.green('监控已停止'));
  }

  /**
   * 检查新消息
   */
  private async checkNewMessages() {
    for (const sessionId of this.monitoredSessions) {
      // 防止并发处理同一会话
      if (this.isProcessing.get(sessionId)) {
        continue;
      }

      try {
        this.isProcessing.set(sessionId, true);
        await this.checkNewMessagesForSession(sessionId);
      } catch (error) {
        console.log(chalk.red(`检查新消息失败: ${error}`));
      } finally {
        this.isProcessing.set(sessionId, false);
      }
    }
  }

  /**
   * 检查单个会话的新消息
   */
  private async checkNewMessagesForSession(sessionId: number) {
    const result = await this.client.getFriendMsgHistory(sessionId, undefined, 30);

    if (result.messages.length === 0) return;

    // 按 message_id 从小到大排序（消息 ID 是递增的，更可靠）
    const messages = result.messages.sort((a, b) => a.message_id - b.message_id);

    // 获取之前已知的最大 message_id
    const previousMaxId = this.lastMessageSeq.get(sessionId) || 0;
    const myId = await this.getSelfId();

    for (const msg of messages) {
      // 跳过已处理过的消息 ID（主要去重机制）
      if (this.processedMessageIds.has(msg.message_id)) {
        continue;
      }

      // 跳过历史消息（基于 message_id）
      if (msg.message_id <= previousMaxId) {
        continue;
      }

      // 跳过自己发的消息
      if (myId && msg.user_id === myId) {
        continue;
      }

      // 显示消息
      this.displayMessage(msg);

      // 自动回复
      if (this.replyCallback && safetyManager.isAllowed(sessionId)) {
        await this.autoReply(sessionId, msg);
      }

      // 标记为已处理
      this.processedMessageIds.add(msg.message_id);

      // 限制已处理消息 ID 集合大小，防止内存泄漏
      if (this.processedMessageIds.size > 1000) {
        const idsToDelete = Array.from(this.processedMessageIds).slice(0, 500);
        idsToDelete.forEach(id => this.processedMessageIds.delete(id));
      }
    }

    // 更新最后处理序号（使用最大的 message_id）
    const currentMaxId = Math.max(...messages.map(m => m.message_id));
    if (currentMaxId > previousMaxId) {
      this.lastMessageSeq.set(sessionId, currentMaxId);
    }
  }

  /**
   * 显示消息
   */
  private displayMessage(msg: Message) {
    const time = new Date(msg.time * 1000).toLocaleTimeString('zh-CN');
    const sender = msg.sender.card || msg.sender.nickname;
    const content = this.getMessageText(msg);

    console.log(chalk.cyan(`[${time}] ${sender}: ${content}`));
  }

  /**
   * 获取消息文本
   */
  private getMessageText(msg: Message): string {
    return msg.message
      .map(segment => {
        if (segment.type === 'text') return segment.data.text;
        if (segment.type === 'at') return `@${segment.data.qq}`;
        if (segment.type === 'image') return '[图片]';
        if (segment.type === 'face') return '[表情]';
        return `[${segment.type}]`;
      })
      .join('');
  }

  /**
   * 自动回复
   */
  private async autoReply(sessionId: number, msg: Message) {
    if (!this.replyCallback) return;

    try {
      const replyText = await this.replyCallback(msg);

      if (!replyText) return;

      // 发送回复（使用封装好的 API）
      await this.client.sendPrivateMessage(sessionId, replyText);
      console.log(chalk.green(`[自动回复] ${replyText}`));
    } catch (error) {
      console.log(chalk.red(`回复失败: ${error}`));
    }
  }
}
