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

export type MessageSegment =
  | { type: 'text'; data: { text: string } }
  | { type: 'image'; data: { file: string; url?: string } }
  | { type: 'face'; data: { id: number } }
  | { type: 'at'; data: { qq: number | 'all' } }
  | { type: 'reply'; data: { id: number } }
  | { type: string; data: Record<string, any> };

export class OneBotClient {
  private baseUrl: string;
  private token?: string;

  constructor(config: OneBotConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.token = config.token;
  }

  private async request<T>(action: string, params?: Record<string, any>): Promise<T> {
    const url = `${this.baseUrl}/${action}`;
    const headers: Record<string, string> = {
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

    const result = await response.json() as OneBotResponse<T>;

    if (result.status !== 'ok') {
      throw new Error(`API error: ${result.msg || result.wording || 'Unknown error'}`);
    }

    return result.data;
  }

  /**
   * 获取登录信息
   */
  async getLoginInfo(): Promise<LoginInfo> {
    return this.request<LoginInfo>('get_login_info');
  }

  /**
   * 获取好友列表
   */
  async getFriendList(): Promise<FriendInfo[]> {
    return this.request<FriendInfo[]>('get_friend_list');
  }

  /**
   * 获取群列表
   */
  async getGroupList(): Promise<GroupInfo[]> {
    return this.request<GroupInfo[]>('get_group_list');
  }

  /**
   * 获取群成员列表
   */
  async getGroupMemberList(groupId: number): Promise<GroupMemberInfo[]> {
    return this.request<GroupMemberInfo[]>('get_group_member_list', {
      group_id: groupId,
    });
  }

  /**
   * 获取群消息历史
   */
  async getGroupMsgHistory(
    groupId: number,
    messageSeq?: number,
    count: number = 20
  ): Promise<{ messages: Message[] }> {
    return this.request<{ messages: Message[] }>('get_group_msg_history', {
      group_id: groupId,
      message_seq: messageSeq,
      count,
    });
  }

  /**
   * 获取好友消息历史
   */
  async getFriendMsgHistory(
    userId: number,
    messageSeq?: number,
    count: number = 20
  ): Promise<{ messages: Message[] }> {
    return this.request<{ messages: Message[] }>('get_friend_msg_history', {
      user_id: userId,
      message_seq: messageSeq,
      count,
    });
  }

  /**
   * 获取消息详情
   */
  async getMessage(messageId: number): Promise<Message> {
    return this.request<Message>('get_msg', {
      message_id: messageId,
    });
  }

  /**
   * 测试连接
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getLoginInfo();
      return true;
    } catch {
      return false;
    }
  }
}
