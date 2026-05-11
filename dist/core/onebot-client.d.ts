/**
 * OneBot API 客户端
 * 用于连接 NapCatQQ 的 OneBot HTTP API
 */
export interface OneBotConfig {
    host: string;
    port: number;
    token?: string;
}
export interface OneBotResponse<T = any> {
    status: string;
    retcode: number;
    data: T;
    msg?: string;
    wording?: string;
}
export interface LoginInfo {
    user_id: number;
    nickname: string;
}
export interface FriendInfo {
    user_id: number;
    nickname: string;
    remark: string;
    face_id?: number;
}
export interface GroupInfo {
    group_id: number;
    group_name: string;
    member_count: number;
    max_member_count: number;
}
export interface GroupMemberInfo {
    user_id: number;
    nickname: string;
    card: string;
    role: 'owner' | 'admin' | 'member';
}
export interface Message {
    message_id: number;
    message_seq: number;
    real_id: number;
    group_id?: number;
    user_id: number;
    time: number;
    message_type: 'private' | 'group';
    sender: {
        user_id: number;
        nickname: string;
        card?: string;
    };
    message: MessageSegment[];
    raw_message: string;
}
export type MessageSegment = {
    type: 'text';
    data: {
        text: string;
    };
} | {
    type: 'image';
    data: {
        file: string;
        url?: string;
    };
} | {
    type: 'face';
    data: {
        id: number;
    };
} | {
    type: 'at';
    data: {
        qq: number | 'all';
    };
} | {
    type: 'reply';
    data: {
        id: number;
    };
} | {
    type: string;
    data: Record<string, any>;
};
export declare class OneBotClient {
    private baseUrl;
    private token?;
    constructor(config: OneBotConfig);
    private request;
    /**
     * 获取登录信息
     */
    getLoginInfo(): Promise<LoginInfo>;
    /**
     * 获取好友列表
     */
    getFriendList(): Promise<FriendInfo[]>;
    /**
     * 获取群列表
     */
    getGroupList(): Promise<GroupInfo[]>;
    /**
     * 获取群成员列表
     */
    getGroupMemberList(groupId: number): Promise<GroupMemberInfo[]>;
    /**
     * 获取群消息历史
     */
    getGroupMsgHistory(groupId: number, messageSeq?: number, count?: number): Promise<{
        messages: Message[];
    }>;
    /**
     * 获取好友消息历史
     */
    getFriendMsgHistory(userId: number, messageSeq?: number, count?: number): Promise<{
        messages: Message[];
    }>;
    /**
     * 获取消息详情
     */
    getMessage(messageId: number): Promise<Message>;
    /**
     * 测试连接
     */
    testConnection(): Promise<boolean>;
}
//# sourceMappingURL=onebot-client.d.ts.map