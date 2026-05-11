/**
 * OneBot API 客户端
 * 用于连接 NapCatQQ 的 OneBot HTTP API
 */
export class OneBotClient {
    baseUrl;
    token;
    constructor(config) {
        this.baseUrl = `http://${config.host}:${config.port}`;
        this.token = config.token;
    }
    async request(action, params) {
        const url = `${this.baseUrl}/${action}`;
        const headers = {
            'Content-Type': 'application/json',
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(params || {}),
        });
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }
        const result = await response.json();
        if (result.status !== 'ok') {
            throw new Error(`API error: ${result.msg || result.wording || 'Unknown error'}`);
        }
        return result.data;
    }
    /**
     * 获取登录信息
     */
    async getLoginInfo() {
        return this.request('get_login_info');
    }
    /**
     * 获取好友列表
     */
    async getFriendList() {
        return this.request('get_friend_list');
    }
    /**
     * 获取群列表
     */
    async getGroupList() {
        return this.request('get_group_list');
    }
    /**
     * 获取群成员列表
     */
    async getGroupMemberList(groupId) {
        return this.request('get_group_member_list', {
            group_id: groupId,
        });
    }
    /**
     * 获取群消息历史
     */
    async getGroupMsgHistory(groupId, messageSeq, count = 20) {
        return this.request('get_group_msg_history', {
            group_id: groupId,
            message_seq: messageSeq,
            count,
        });
    }
    /**
     * 获取好友消息历史
     */
    async getFriendMsgHistory(userId, messageSeq, count = 20) {
        return this.request('get_friend_msg_history', {
            user_id: userId,
            message_seq: messageSeq,
            count,
        });
    }
    /**
     * 获取消息详情
     */
    async getMessage(messageId) {
        return this.request('get_msg', {
            message_id: messageId,
        });
    }
    /**
     * 测试连接
     */
    async testConnection() {
        try {
            await this.getLoginInfo();
            return true;
        }
        catch {
            return false;
        }
    }
}
//# sourceMappingURL=onebot-client.js.map