/**
 * 消息获取器
 * 用于批量获取聊天消息
 */
export class MessageFetcher {
    client;
    constructor(client) {
        this.client = client;
    }
    /**
     * 获取所有会话
     */
    async getAllSessions() {
        const [friends, groups] = await Promise.all([
            this.client.getFriendList(),
            this.client.getGroupList(),
        ]);
        const sessions = [
            ...friends.map(f => ({
                type: 'friend',
                id: f.user_id,
                name: f.remark || f.nickname,
            })),
            ...groups.map(g => ({
                type: 'group',
                id: g.group_id,
                name: g.group_name,
            })),
        ];
        return sessions;
    }
    /**
     * 获取会话的消息
     */
    async fetchMessages(session, options = {}) {
        const allMessages = [];
        let currentSeq;
        const batchSize = 20;
        const limit = options.limit || Infinity;
        while (allMessages.length < limit) {
            let result;
            if (session.type === 'group') {
                result = await this.client.getGroupMsgHistory(session.id, currentSeq, batchSize);
            }
            else {
                result = await this.client.getFriendMsgHistory(session.id, currentSeq, batchSize);
            }
            const messages = result.messages;
            if (messages.length === 0)
                break;
            // 过滤时间范围
            const filteredMessages = messages.filter(msg => {
                const msgTime = new Date(msg.time * 1000);
                if (options.after && msgTime < options.after)
                    return false;
                if (options.before && msgTime > options.before)
                    return false;
                return true;
            });
            allMessages.push(...filteredMessages);
            // 更新 seq 用于下一页
            currentSeq = messages[messages.length - 1].message_seq;
            // 如果消息数量少于批次大小，说明已经到底
            if (messages.length < batchSize)
                break;
            // 如果最后一条消息早于 after 时间，停止获取
            const lastMsgTime = new Date(messages[messages.length - 1].time * 1000);
            if (options.after && lastMsgTime < options.after)
                break;
        }
        // 按时间排序（从旧到新）
        allMessages.sort((a, b) => a.time - b.time);
        // 返回限制数量的消息
        return allMessages.slice(0, limit);
    }
    /**
     * 根据 ID 获取会话
     */
    async getSessionById(id, type) {
        const sessions = await this.getAllSessions();
        return sessions.find(s => s.id === id && (!type || s.type === type));
    }
    /**
     * 搜索会话
     */
    async searchSessions(keyword) {
        const sessions = await this.getAllSessions();
        const lowerKeyword = keyword.toLowerCase();
        return sessions.filter(s => s.name.toLowerCase().includes(lowerKeyword) ||
            s.id.toString().includes(keyword));
    }
}
//# sourceMappingURL=fetcher.js.map