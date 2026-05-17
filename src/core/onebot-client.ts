/**
 * OneBot API 客户端
 * 用于连接 NapCatQQ 的 OneBot HTTP API 和 WebSocket
 */

import { fetchWithTimeout, retry, logger } from '../utils/index.js';

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
  age?: number;
  gender?: 'male' | 'female' | 'unknown';
  join_time?: number;
  last_sent_time?: number;
  level?: number;
  rank?: string;
  title?: string;
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
    role?: 'owner' | 'admin' | 'member';
    age?: number;
    gender?: 'male' | 'female' | 'unknown';
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
  | { type: 'video'; data: { file: string } }
  | { type: 'voice'; data: { file: string } }
  | { type: 'record'; data: { file: string } }
  | { type: 'file'; data: { name: string; size: number; fid: string } }
  | { type: string; data: Record<string, any> };

// 新增接口定义
export interface StrangerInfo {
  user_id: number;
  nickname: string;
  sex?: 'male' | 'female' | 'unknown';
  age?: number;
  qid?: string;
  login_days?: number;
}

export interface FileInfo {
  size: number;
  name: string;
  fid: string;
  business_name?: string;
}

export interface GroupFileInfo {
  group_id: number;
  file_count: number;
  total_size: number;
  files: FileInfo[];
}

export interface HonorInfo {
  user_id: number;
  nickname: string;
  description: string;
}

export interface Credentials {
  token: string;
}

export interface VersionInfo {
  impl_version: string;
  protocol_version: string;
  app_version: string;
}

export interface GuildInfo {
  guild_id: string;
  guild_name: string;
}

export interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  guild_id: string;
}

// OneBot 事件类型
export type OneBotEvent =
  | { post_type: 'message'; message_type: 'private'; sub_type: string; message_id: number; user_id: number; message: MessageSegment[]; raw_message: string; font: number; sender: { user_id: number; nickname: string; sex?: string; age?: number } }
  | { post_type: 'message'; message_type: 'group'; sub_type: string; group_id: number; message_id: number; user_id: number; anonymous?: any; message: MessageSegment[]; raw_message: string; font: number; sender: { user_id: number; nickname: string; card: string; role: string; title: string } }
  | { post_type: 'message'; message_type: 'guild'; sub_type: string; guild_id: string; channel_id: string; message_id: string; user_id: number; message: MessageSegment[]; raw_message: string }
  | { post_type: 'message_sent'; message_type: 'private'; user_id: number; message_id: number; message: MessageSegment[]; }
  | { post_type: 'message_sent'; message_type: 'group'; group_id: number; message_id: number; message: MessageSegment[]; }
  | { post_type: 'notice'; notice_type: 'friend_recall'; user_id: number; message_id: number; time: number }
  | { post_type: 'notice'; notice_type: 'group_recall'; group_id: number; user_id: number; operator_id: number; message_id: number; time: number }
  | { post_type: 'notice'; notice_type: 'friend_add'; user_id: number; time: number }
  | { post_type: 'notice'; notice_type: 'notify'; sub_type: 'poke' | 'lucky_king' | 'honor'; group_id?: number; user_id: number; target_id?: number; honor_type?: string }
  | { post_type: 'request'; request_type: 'friend'; user_id: number; comment: string; flag: string }
  | { post_type: 'request'; request_type: 'group'; sub_type: 'add' | 'invite'; group_id: number; user_id: number; comment: string; flag: string }
  | { post_type: 'meta_event'; meta_event_type: 'lifecycle' | 'heartbeat'; time: number }
  | { post_type: 'meta_event'; meta_event_type: 'heartbeat'; status: { interval: number }; time: number }
  | any;

export class OneBotClient {
  private baseUrl: string;
  private wsUrl: string;
  private token?: string;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private eventHandlers: Map<string, Array<(event: OneBotEvent) => void>> = new Map();
  private autoReconnect: boolean = true;
  private reconnectInterval: number = 5000;

  constructor(config: OneBotConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.wsUrl = `ws://${config.host}:${config.port}`;
    this.token = config.token;
  }

  getConfig(): OneBotConfig {
    return {
      host: this.baseUrl.replace('http://', '').split(':')[0],
      port: parseInt(this.baseUrl.replace('http://', '').split(':')[1]),
      token: this.token,
    };
  }

  private async request<T>(action: string, params?: Record<string, any>): Promise<T> {
    const url = `${this.baseUrl}/${action}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return retry(async () => {
      const response = await fetchWithTimeout(url, {
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
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 消息发送 API
  // ══════════════════════════════════════════════════════════════

  /**
   * 发送私聊消息
   */
  async sendPrivateMessage(
    userId: number,
    message: string | MessageSegment[]
  ): Promise<{ message_id: number }> {
    return this.request('send_msg', {
      message_type: 'private',
      user_id: userId,
      message,
    });
  }

  /**
   * 发送群聊消息
   */
  async sendGroupMessage(
    groupId: number,
    message: string | MessageSegment[]
  ): Promise<{ message_id: number }> {
    return this.request('send_msg', {
      message_type: 'group',
      group_id: groupId,
      message,
    });
  }

  /**
   * 发送频道消息
   */
  async sendGuildMessage(
    guildId: string,
    channelId: string,
    message: string | MessageSegment[]
  ): Promise<{ message_id: string }> {
    return this.request('send_msg', {
      message_type: 'guild',
      guild_id: guildId,
      channel_id: channelId,
      message,
    });
  }

  /**
   * 通用发送消息（自动判断类型）
   */
  async sendMessage(
    targetId: number,
    message: string | MessageSegment[],
    messageType?: 'private' | 'group'
  ): Promise<{ message_id: number }> {
    const params: any = {
      message,
    };
    
    if (messageType) {
      params.message_type = messageType;
      if (messageType === 'private') {
        params.user_id = targetId;
      } else {
        params.group_id = targetId;
      }
    } else {
      try {
        return await this.sendPrivateMessage(targetId, message);
      } catch {
        return await this.sendGroupMessage(targetId, message);
      }
    }

    return this.request('send_msg', params);
  }

  /**
   * 撤回消息
   */
  async deleteMessage(messageId: number): Promise<void> {
    return this.request('delete_msg', { message_id: messageId });
  }

  /**
   * 发送好友赞
   */
  async sendLike(userId: number, times: number = 1): Promise<void> {
    return this.request('send_like', { user_id: userId, times });
  }

  /**
   * 发送表情贴图（需要支持）
   */
  async sendMusic(
    type: 'custom' | 'qq' | '163' | 'xm' | 'kl',
    options: Record<string, any>
  ): Promise<void> {
    return this.request('send_music', { type, ...options });
  }

  // ══════════════════════════════════════════════════════════════
  // 消息获取 API
  // ══════════════════════════════════════════════════════════════

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
   * 获取陌生人信息
   */
  async getStrangerInfo(userId: number): Promise<StrangerInfo> {
    return this.request<StrangerInfo>('get_stranger_info', {
      user_id: userId,
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

  // ══════════════════════════════════════════════════════════════
  // 群管理 API
  // ══════════════════════════════════════════════════════════════

  /**
   * 设置群名
   */
  async setGroupName(groupId: number, groupName: string): Promise<void> {
    return this.request('set_group_name', {
      group_id: groupId,
      group_name: groupName,
    });
  }

  /**
   * 离开群
   */
  async leaveGroup(groupId: number, isDismiss: boolean = false): Promise<void> {
    return this.request('set_group_leave', {
      group_id: groupId,
      is_dismiss: isDismiss,
    });
  }

  /**
   * 设置群管理员
   */
  async setGroupAdmin(groupId: number, userId: number, enable: boolean): Promise<void> {
    return this.request('set_group_admin', {
      group_id: groupId,
      user_id: userId,
      enable,
    });
  }

  /**
   * 设置群名片
   */
  async setGroupCard(groupId: number, userId: number, card: string): Promise<void> {
    return this.request('set_group_card', {
      group_id: groupId,
      user_id: userId,
      card,
    });
  }

  /**
   * 设置群专属头衔
   */
  async setGroupSpecialTitle(groupId: number, userId: number, title: string, duration: number = -1): Promise<void> {
    return this.request('set_group_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
      duration,
    });
  }

  /**
   * 禁言群成员
   */
  async muteGroupMember(groupId: number, userId: number, duration: number = 1800): Promise<void> {
    return this.request('set_group_ban', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
  }

  /**
   * 全员禁言
   */
  async muteAllGroup(groupId: number, enable: boolean): Promise<void> {
    return this.request('set_group_whole_ban', {
      group_id: groupId,
      enable,
    });
  }

  /**
   * 踢出群成员
   */
  async kickGroupMember(groupId: number, userId: number, rejectAddRequest: boolean = false): Promise<void> {
    return this.request('set_group_kick', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
  }

  /**
   * 发布群公告
   */
  async sendGroupNotice(groupId: number, content: string): Promise<void> {
    return this.request('_send_group_notice', {
      group_id: groupId,
      content,
    });
  }

  /**
   * 获取群公告
   */
  async getGroupNotice(groupId: number): Promise<any[]> {
    return this.request('_get_group_notice', {
      group_id: groupId,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 好友/请求管理 API
  // ══════════════════════════════════════════════════════════════

  /**
   * 删除好友
   */
  async deleteFriend(userId: number): Promise<void> {
    return this.request('delete_friend', {
      user_id: userId,
    });
  }

  /**
   * 处理好友请求
   */
  async setFriendAddRequest(flag: string, approve: boolean = true, remark: string = ''): Promise<void> {
    return this.request('set_friend_add_request', {
      flag,
      approve,
      remark,
    });
  }

  /**
   * 处理群请求
   */
  async setGroupAddRequest(
    flag: string,
    subType: 'add' | 'invite',
    approve: boolean = true,
    reason: string = ''
  ): Promise<void> {
    return this.request('set_group_add_request', {
      flag,
      sub_type: subType,
      approve,
      reason,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 文件/图片 API
  // ══════════════════════════════════════════════════════════════

  /**
   * 获取图片信息
   */
  async getImage(file: string): Promise<{ size: number; filename: string; url: string }> {
    return this.request('get_image', { file });
  }

  /**
   * 获取群文件列表
   */
  async getGroupFileList(groupId: number, folder: string = ''): Promise<GroupFileInfo> {
    return this.request('get_group_file_list', {
      group_id: groupId,
      folder,
    });
  }

  /**
   * 获取群文件系统信息
   */
  async getGroupFileSystemInfo(groupId: number): Promise<{ total_space: number; used_space: number }> {
    return this.request('get_group_file_system_info', {
      group_id: groupId,
    });
  }

  /**
   * 上传群文件
   */
  async uploadGroupFile(groupId: number, file: string, name: string, folder: string = ''): Promise<void> {
    return this.request('upload_group_file', {
      group_id: groupId,
      file,
      name,
      folder,
    });
  }

  /**
   * 删除群文件
   */
  async deleteGroupFile(groupId: number, fileId: string, busid: number = 0): Promise<void> {
    return this.request('delete_group_file', {
      group_id: groupId,
      file_id: fileId,
      busid,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // 荣誉/统计 API
  // ══════════════════════════════════════════════════════════════

  /**
   * 获取群荣誉信息
   */
  async getGroupHonorInfo(groupId: number, type: 'talkative' | 'performer' | 'legend' | 'strong_newbie' | 'emotion'): Promise<HonorInfo[]> {
    return this.request('get_group_honor_info', {
      group_id: groupId,
      type,
    });
  }

  /**
   * 获取好友文件列表
   */
  async getFriendFileList(): Promise<FileInfo[]> {
    return this.request('get_friend_file_list');
  }

  // ══════════════════════════════════════════════════════════════
  // 其他 API
  // ══════════════════════════════════════════════════════════════

  /**
   * 获取用户好友猜测
   */
  async getSuggestions(query: string): Promise<any[]> {
    return this.request('get_ucenter_url', { query });
  }

  /**
   * 获取版本信息
   */
  async getVersionInfo(): Promise<VersionInfo> {
    return this.request('get_version_info');
  }

  /**
   * 获取状态信息
   */
  async getStatus(): Promise<{ good: boolean; stat: Record<string, number> }> {
    return this.request('get_status');
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

  // ══════════════════════════════════════════════════════════════
  // WebSocket 连接
  // ══════════════════════════════════════════════════════════════

  /**
   * 注册事件处理器
   */
  on(event: string, handler: (event: OneBotEvent) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * 移除事件处理器
   */
  off(event: string, handler: (event: OneBotEvent) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 连接到 WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.token 
        ? `${this.wsUrl}?access_token=${this.token}`
        : this.wsUrl;

      logger.info(`正在连接到 WebSocket: ${this.wsUrl}`);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        logger.success('WebSocket 连接已建立');
        this.startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          logger.error('解析 WebSocket 消息失败:', error);
        }
      };

      this.ws.onerror = (error) => {
        logger.error('WebSocket 错误:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        logger.warn('WebSocket 连接已关闭');
        this.stopHeartbeat();
        if (this.autoReconnect) {
          this.scheduleReconnect();
        }
      };
    });
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleMessage(data: any): void {
    if (data.post_type) {
      const handlers = this.eventHandlers.get(data.post_type) || [];
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          logger.error(`事件处理器执行失败 (${data.post_type}):`, error);
        }
      });

      if (data.post_type === 'message') {
        const msgHandlers = this.eventHandlers.get(`message_${data.message_type}`) || [];
        msgHandlers.forEach(handler => handler(data));
      }

      if (data.notice_type) {
        const noticeHandlers = this.eventHandlers.get(`notice_${data.notice_type}`) || [];
        noticeHandlers.forEach(handler => handler(data));
      }
    }

    if (data.echo !== undefined && this.pendingRequests.has(data.echo)) {
      const pending = this.pendingRequests.get(data.echo);
      if (!pending) return;
      const { resolve, reject } = pending;
      this.pendingRequests.delete(data.echo);
      if (data.status === 'ok') {
        resolve(data.data);
      } else {
        reject(new Error(data.msg || data.wording || 'Unknown error'));
      }
    }
  }

  private pendingRequests: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }> = new Map();

  /**
   * 发送 WebSocket 请求
   */
  private sendWsRequest(action: string, params: Record<string, any> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 未连接'));
        return;
      }

      const echo = String(Date.now()) + Math.random().toString(36).slice(2);
      this.pendingRequests.set(echo, { resolve, reject });

      this.ws.send(JSON.stringify({
        action,
        params,
        echo,
      }));

      setTimeout(() => {
        if (this.pendingRequests.has(echo)) {
          this.pendingRequests.delete(echo);
          reject(new Error('请求超时'));
        }
      }, 30000);
    });
  }

  /**
   * 开始心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'get_status', params: {} }));
      }
    }, 30000);
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 计划重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    logger.info(`${this.reconnectInterval / 1000}秒后尝试重连...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        logger.error('重连失败:', error);
      }
    }, this.reconnectInterval);
  }

  /**
   * 断开 WebSocket 连接
   */
  disconnect(): void {
    this.autoReconnect = false;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ══════════════════════════════════════════════════════════════
  // WebSocket 版的 API（通过 WebSocket 发送）
  // ══════════════════════════════════════════════════════════════

  /**
   * 通过 WebSocket 发送消息
   */
  async wsSendMessage(targetId: number, message: string | MessageSegment[], messageType: 'private' | 'group' = 'private'): Promise<{ message_id: number }> {
    return this.sendWsRequest('send_msg', {
      message_type: messageType,
      user_id: messageType === 'private' ? targetId : undefined,
      group_id: messageType === 'group' ? targetId : undefined,
      message,
    });
  }

  /**
   * 通过 WebSocket 获取消息
   */
  async wsGetMessage(messageId: number): Promise<Message> {
    return this.sendWsRequest('get_msg', { message_id: messageId });
  }

  /**
   * 通过 WebSocket 获取好友列表
   */
  async wsGetFriendList(): Promise<FriendInfo[]> {
    return this.sendWsRequest('get_friend_list', {});
  }

  /**
   * 通过 WebSocket 获取群列表
   */
  async wsGetGroupList(): Promise<GroupInfo[]> {
    return this.sendWsRequest('get_group_list', {});
  }
}
