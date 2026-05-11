/**
 * 消息监控模块
 * 监听指定会话的消息并自动回复
 */
import chalk from 'chalk';
import { safetyManager } from './safety.js';
export class MessageMonitor {
    client;
    wsUrl;
    ws = null;
    monitoredSessions = new Set();
    lastMessageSeq = new Map();
    pollingInterval = null;
    replyCallback = null;
    constructor(client) {
        this.client = client;
        const config = client.getConfig();
        this.wsUrl = `ws://${config.host}:${config.port}`;
    }
    /**
     * 设置回复生成器
     */
    setReplyGenerator(callback) {
        this.replyCallback = callback;
    }
    /**
     * 添加监控会话
     */
    addSession(sessionId) {
        this.monitoredSessions.add(sessionId);
        console.log(chalk.green(`已添加监控会话: ${sessionId}`));
    }
    /**
     * 移除监控会话
     */
    removeSession(sessionId) {
        this.monitoredSessions.delete(sessionId);
        console.log(chalk.green(`已移除监控会话: ${sessionId}`));
    }
    /**
     * 开始监控（使用轮询方式）
     */
    async startPolling(intervalMs = 5000) {
        if (this.monitoredSessions.size === 0) {
            console.log(chalk.yellow('没有监控会话'));
            return;
        }
        console.log(chalk.bold('开始监控...'));
        console.log(chalk.dim(`监控会话: ${Array.from(this.monitoredSessions).join(', ')}`));
        console.log(chalk.dim(`轮询间隔: ${intervalMs}ms`));
        console.log(chalk.dim('按 Ctrl+C 停止'));
        console.log('');
        // 初始化最后消息序号
        for (const sessionId of this.monitoredSessions) {
            try {
                const result = await this.client.getFriendMsgHistory(sessionId, undefined, 1);
                if (result.messages.length > 0) {
                    this.lastMessageSeq.set(sessionId, result.messages[0].message_seq);
                }
            }
            catch (error) {
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
    async checkNewMessages() {
        for (const sessionId of this.monitoredSessions) {
            try {
                const lastSeq = this.lastMessageSeq.get(sessionId);
                const result = await this.client.getFriendMsgHistory(sessionId, lastSeq, 10);
                if (result.messages.length === 0)
                    continue;
                // 按时间排序（从旧到新）
                const messages = result.messages.sort((a, b) => a.message_seq - b.message_seq);
                for (const msg of messages) {
                    // 跳过已处理的消息
                    if (lastSeq && msg.message_seq <= lastSeq)
                        continue;
                    // 跳过自己发的消息
                    if (msg.user_id === YOUR_QQ)
                        continue; // TODO: 动态获取自己的 ID
                    // 显示消息
                    this.displayMessage(msg);
                    // 自动回复
                    if (this.replyCallback && safetyManager.isAllowed(sessionId)) {
                        await this.autoReply(sessionId, msg);
                    }
                    // 更新最后消息序号
                    this.lastMessageSeq.set(sessionId, msg.message_seq);
                }
            }
            catch (error) {
                // 忽略轮询错误
            }
        }
    }
    /**
     * 显示消息
     */
    displayMessage(msg) {
        const time = new Date(msg.time * 1000).toLocaleTimeString('zh-CN');
        const sender = msg.sender.card || msg.sender.nickname;
        const content = this.getMessageText(msg);
        console.log(chalk.cyan(`[${time}] ${sender}: ${content}`));
    }
    /**
     * 获取消息文本
     */
    getMessageText(msg) {
        return msg.message
            .map(segment => {
            if (segment.type === 'text')
                return segment.data.text;
            if (segment.type === 'at')
                return `@${segment.data.qq}`;
            if (segment.type === 'image')
                return '[图片]';
            if (segment.type === 'face')
                return '[表情]';
            return `[${segment.type}]`;
        })
            .join('');
    }
    /**
     * 自动回复
     */
    async autoReply(sessionId, msg) {
        if (!this.replyCallback)
            return;
        try {
            const replyText = await this.replyCallback(msg);
            if (!replyText)
                return;
            // 发送回复
            const config = this.client.getConfig();
            const response = await fetch(`http://${config.host}:${config.port}/send_msg`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.token ? { 'Authorization': `Bearer ${config.token}` } : {}),
                },
                body: JSON.stringify({
                    message_type: 'private',
                    user_id: sessionId,
                    message: [{ type: 'text', data: { text: replyText } }],
                }),
            });
            const result = await response.json();
            if (result.status === 'ok') {
                console.log(chalk.green(`[自动回复] ${replyText}`));
            }
            else {
                console.log(chalk.red(`回复失败: ${result.message}`));
            }
        }
        catch (error) {
            console.log(chalk.red(`回复失败: ${error}`));
        }
    }
}
//# sourceMappingURL=monitor.js.map