# qchat-cli API Reference

> qchat-cli 的 TypeScript API 完整参考文档

---

## Table of Contents

- [OneBotClient](#onebotclient)
  - [消息发送 API](#消息发送-api)
  - [消息获取 API](#消息获取-api)
  - [群管理 API](#群管理-api)
  - [好友/请求管理 API](#好友请求管理-api)
  - [文件/图片 API](#文件图片-api)
  - [其他 API](#其他-api)
  - [WebSocket API](#websocket-api)
- [QZoneClient](#qzoneclient)
  - [认证 API](#认证-api)
  - [说说 API](#说说-api)
  - [互动 API](#互动-api)
  - [用户 API](#用户-api)
  - [好友 API](#好友-api)
  - [访客 API](#访客-api)
  - [相册 API](#相册-api)
  - [留言板/日志 API](#留言板日志-api)
  - [点赞 API](#点赞-api)
- [SafetyManager](#safetymanager)
- [MessageMonitor](#messagemonitor)
- [工具函数](#工具函数)

---

## OneBotClient

OneBot 协议客户端，用于连接 NapCatQQ。

### 构造函数

```typescript
new OneBotClient(config: OneBotConfig)
```

**参数：**

```typescript
interface OneBotConfig {
  host: string;      // NapCat 服务器地址，如 "localhost"
  port: number;      // NapCat 端口，如 3000
  token?: string;    // 可选，认证令牌
}
```

**示例：**

```typescript
import { OneBotClient } from './core/onebot-client.js';

const client = new OneBotClient({
  host: 'localhost',
  port: 3000,
  token: 'your-token'  // 可选
});
```

---

### 消息发送 API

#### sendPrivateMessage

发送私聊消息。

```typescript
async sendPrivateMessage(
  userId: number,
  message: string | MessageSegment[]
): Promise<{ message_id: number }>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| userId | number | 目标用户 QQ 号 |
| message | string \| MessageSegment[] | 消息内容 |

**返回：**

```typescript
{ message_id: number }  // 发送成功后返回消息 ID
```

**示例：**

```typescript
// 发送文本消息
const result = await client.sendPrivateMessage(123456, '你好！');

// 发送图片消息
const result = await client.sendPrivateMessage(123456, [
  { type: 'text', data: { text: '这是图片：' } },
  { type: 'image', data: { file: '/path/to/image.jpg' } }
]);
```

---

#### sendGroupMessage

发送群聊消息。

```typescript
async sendGroupMessage(
  groupId: number,
  message: string | MessageSegment[]
): Promise<{ message_id: number }>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| groupId | number | 目标群号 |
| message | string \| MessageSegment[] | 消息内容 |

**示例：**

```typescript
// 发送文本消息到群
await client.sendGroupMessage(987654321, '大家好！');

// @某人
await client.sendGroupMessage(987654321, [
  { type: 'at', data: { qq: 123456 } },
  { type: 'text', data: { text: ' 有事找你' } }
]);
```

---

#### sendGuildMessage

发送频道消息。

```typescript
async sendGuildMessage(
  guildId: string,
  channelId: string,
  message: string | MessageSegment[]
): Promise<{ message_id: string }>
```

---

#### sendMessage

通用发送消息（自动判断类型）。

```typescript
async sendMessage(
  targetId: number,
  message: string | MessageSegment[],
  messageType?: 'private' | 'group'
): Promise<{ message_id: number }>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| targetId | number | 目标 ID（QQ 号或群号） |
| message | string \| MessageSegment[] | 消息内容 |
| messageType | 'private' \| 'group' | 可选，指定消息类型 |

**示例：**

```typescript
// 自动判断类型（先尝试私聊，失败则尝试群聊）
await client.sendMessage(123456, '测试消息');

// 指定类型
await client.sendMessage(123456, '私聊消息', 'private');
await client.sendMessage(987654321, '群消息', 'group');
```

---

#### deleteMessage

撤回消息。

```typescript
async deleteMessage(messageId: number): Promise<void>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| messageId | number | 要撤回的消息 ID |

**示例：**

```typescript
const result = await client.sendPrivateMessage(123456, '这条消息待会撤回');
await client.deleteMessage(result.message_id);
```

---

#### sendLike

发送好友赞。

```typescript
async sendLike(userId: number, times: number = 1): Promise<void>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| userId | number | - | 目标用户 QQ 号 |
| times | number | 1 | 点赞次数 |

**示例：**

```typescript
// 点赞一次
await client.sendLike(123456);

// 点赞十次
await client.sendLike(123456, 10);
```

---

### 消息获取 API

#### getLoginInfo

获取登录信息。

```typescript
async getLoginInfo(): Promise<LoginInfo>
```

**返回：**

```typescript
interface LoginInfo {
  user_id: number;      // 登录的 QQ 号
  nickname: string;     // 昵称
}
```

**示例：**

```typescript
const info = await client.getLoginInfo();
console.log(`已登录: ${info.nickname} (${info.user_id})`);
```

---

#### getFriendList

获取好友列表。

```typescript
async getFriendList(): Promise<FriendInfo[]>
```

**返回：**

```typescript
interface FriendInfo {
  user_id: number;    // QQ 号
  nickname: string;   // 昵称
  remark: string;     // 备注
  face_id?: number;   // 头像 ID
}
```

---

#### getGroupList

获取群列表。

```typescript
async getGroupList(): Promise<GroupInfo[]>
```

**返回：**

```typescript
interface GroupInfo {
  group_id: number;        // 群号
  group_name: string;      // 群名
  member_count: number;    // 成员数量
  max_member_count: number; // 最大成员数
}
```

---

#### getGroupMemberList

获取群成员列表。

```typescript
async getGroupMemberList(groupId: number): Promise<GroupMemberInfo[]>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| groupId | number | 群号 |

**返回：**

```typescript
interface GroupMemberInfo {
  user_id: number;           // QQ 号
  nickname: string;         // 昵称
  card: string;             // 群名片
  role: 'owner' | 'admin' | 'member';  // 角色
  age?: number;             // 年龄
  gender?: 'male' | 'female' | 'unknown';  // 性别
  join_time?: number;       // 入群时间
  last_sent_time?: number;  // 最后发言时间
  level?: number;           // 等级
  rank?: string;            // 等级名称
  title?: string;           // 专属头衔
}
```

---

#### getStrangerInfo

获取陌生人信息。

```typescript
async getStrangerInfo(userId: number): Promise<StrangerInfo>
```

---

#### getGroupMsgHistory

获取群消息历史。

```typescript
async getGroupMsgHistory(
  groupId: number,
  messageSeq?: number,
  count: number = 20
): Promise<{ messages: Message[] }>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| groupId | number | - | 群号 |
| messageSeq | number | - | 可选，从指定消息序号开始 |
| count | number | 20 | 获取消息数量，最大 200 |

**返回：**

```typescript
{ messages: Message[] }
```

---

#### getFriendMsgHistory

获取好友消息历史。

```typescript
async getFriendMsgHistory(
  userId: number,
  messageSeq?: number,
  count: number = 20
): Promise<{ messages: Message[] }>
```

---

#### getMessage

获取消息详情。

```typescript
async getMessage(messageId: number): Promise<Message>
```

---

### 群管理 API

#### setGroupName

设置群名。

```typescript
async setGroupName(groupId: number, groupName: string): Promise<void>
```

**示例：**

```typescript
await client.setGroupName(987654321, '新群名');
```

---

#### leaveGroup

离开群。

```typescript
async leaveGroup(groupId: number, isDismiss: boolean = false): Promise<void>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| groupId | number | - | 群号 |
| isDismiss | boolean | false | 是否解散群（仅群主有效） |

---

#### setGroupAdmin

设置群管理员。

```typescript
async setGroupAdmin(
  groupId: number,
  userId: number,
  enable: boolean
): Promise<void>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| groupId | number | 群号 |
| userId | number | 用户 QQ 号 |
| enable | boolean | true 设置为管理员，false 取消 |

**示例：**

```typescript
// 设置管理员
await client.setGroupAdmin(987654321, 123456, true);

// 取消管理员
await client.setGroupAdmin(987654321, 123456, false);
```

---

#### setGroupCard

设置群名片。

```typescript
async setGroupCard(
  groupId: number,
  userId: number,
  card: string
): Promise<void>
```

**示例：**

```typescript
await client.setGroupCard(987654321, 123456, '产品经理');
```

---

#### setGroupSpecialTitle

设置群专属头衔。

```typescript
async setGroupSpecialTitle(
  groupId: number,
  userId: number,
  title: string,
  duration: number = -1
): Promise<void>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| groupId | number | - | 群号 |
| userId | number | - | 用户 QQ 号 |
| title | string | - | 专属头衔（空字符串取消） |
| duration | number | -1 | 有效期（秒），-1 永久 |

---

#### muteGroupMember

禁言群成员。

```typescript
async muteGroupMember(
  groupId: number,
  userId: number,
  duration: number = 1800
): Promise<void>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| groupId | number | - | 群号 |
| userId | number | - | 用户 QQ 号 |
| duration | number | 1800 | 禁言时长（秒），0 解除禁言 |

**示例：**

```typescript
// 禁言 30 分钟
await client.muteGroupMember(987654321, 123456, 1800);

// 禁言 1 小时
await client.muteGroupMember(987654321, 123456, 3600);

// 解除禁言
await client.muteGroupMember(987654321, 123456, 0);
```

---

#### muteAllGroup

全员禁言。

```typescript
async muteAllGroup(groupId: number, enable: boolean): Promise<void>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| groupId | number | 群号 |
| enable | boolean | true 开启全员禁言，false 关闭 |

**示例：**

```typescript
// 开启全员禁言
await client.muteAllGroup(987654321, true);

// 关闭全员禁言
await client.muteAllGroup(987654321, false);
```

---

#### kickGroupMember

踢出群成员。

```typescript
async kickGroupMember(
  groupId: number,
  userId: number,
  rejectAddRequest: boolean = false
): Promise<void>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| groupId | number | - | 群号 |
| userId | number | - | 用户 QQ 号 |
| rejectAddRequest | boolean | false | 是否拒绝再次入群申请 |

---

#### sendGroupNotice

发布群公告。

```typescript
async sendGroupNotice(groupId: number, content: string): Promise<void>
```

**示例：**

```typescript
await client.sendGroupNotice(987654321, '今晚 8 点有活动！');
```

---

#### getGroupNotice

获取群公告。

```typescript
async getGroupNotice(groupId: number): Promise<any[]>
```

---

### 好友/请求管理 API

#### deleteFriend

删除好友。

```typescript
async deleteFriend(userId: number): Promise<void>
```

---

#### setFriendAddRequest

处理好友请求。

```typescript
async setFriendAddRequest(
  flag: string,
  approve: boolean = true,
  remark: string = ''
): Promise<void>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| flag | string | - | 请求标志（从事件中获取） |
| approve | boolean | true | true 同意，false 拒绝 |
| remark | string | '' | 备注名 |

---

#### setGroupAddRequest

处理群请求。

```typescript
async setGroupAddRequest(
  flag: string,
  subType: 'add' | 'invite',
  approve: boolean = true,
  reason: string = ''
): Promise<void>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| flag | string | 请求标志 |
| subType | 'add' \| 'invite' | 'add' 加群请求，'invite' 邀请入群 |
| approve | boolean | true 同意，false 拒绝 |
| reason | string | 拒绝理由（当 approve=false 时） |

---

### 文件/图片 API

#### getImage

获取图片信息。

```typescript
async getImage(file: string): Promise<{
  size: number;
  filename: string;
  url: string;
}>
```

---

#### getGroupFileList

获取群文件列表。

```typescript
async getGroupFileList(
  groupId: number,
  folder: string = ''
): Promise<GroupFileInfo>
```

---

#### uploadGroupFile

上传群文件。

```typescript
async uploadGroupFile(
  groupId: number,
  file: string,
  name: string,
  folder: string = ''
): Promise<void>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| groupId | number | 群号 |
| file | string | 文件路径 |
| name | string | 显示文件名 |
| folder | string | 目标文件夹（可选） |

---

#### deleteGroupFile

删除群文件。

```typescript
async deleteGroupFile(
  groupId: number,
  fileId: string,
  busid: number = 0
): Promise<void>
```

---

### 其他 API

#### getGroupHonorInfo

获取群荣誉信息。

```typescript
async getGroupHonorInfo(
  groupId: number,
  type: 'talkative' | 'performer' | 'legend' | 'strong_newbie' | 'emotion'
): Promise<HonorInfo[]>
```

**type 参数：**

| 值 | 说明 |
|------|------|
| 'talkative' | 群聊王者 |
| 'performer' | 音咖 |
| 'legend' | 传说 |
| 'strong_newbie' | 牛气 |
| 'emotion' | 情感 |

---

#### getVersionInfo

获取版本信息。

```typescript
async getVersionInfo(): Promise<VersionInfo>
```

---

#### getStatus

获取状态信息。

```typescript
async getStatus(): Promise<{
  good: boolean;
  stat: Record<string, number>;
}>
```

---

#### testConnection

测试连接。

```typescript
async testConnection(): Promise<boolean>
```

**示例：**

```typescript
const connected = await client.testConnection();
if (connected) {
  console.log('连接正常');
} else {
  console.log('连接失败');
}
```

---

### WebSocket API

#### connect

建立 WebSocket 连接。

```typescript
async connect(): Promise<void>
```

**示例：**

```typescript
await client.connect();
console.log('WebSocket 连接已建立');
```

---

#### disconnect

断开 WebSocket 连接。

```typescript
disconnect(): void
```

---

#### isConnected

检查连接状态。

```typescript
isConnected(): boolean
```

---

#### on

注册事件处理器。

```typescript
on(event: string, handler: (event: OneBotEvent) => void): void
```

**事件类型：**

| 事件名 | 说明 | 事件数据 |
|--------|------|----------|
| `message` | 所有消息 | OneBotEvent |
| `message_private` | 私聊消息 | OneBotEvent |
| `message_group` | 群聊消息 | OneBotEvent |
| `notice` | 所有通知 | OneBotEvent |
| `notice_friend_recall` | 好友撤回 | OneBotEvent |
| `notice_group_recall` | 群撤回 | OneBotEvent |
| `notice_friend_add` | 新增好友 | OneBotEvent |
| `notice_group_ban` | 群禁言 | OneBotEvent |
| `notice_group_admin` | 群管理员变更 | OneBotEvent |
| `notice_notify_poke` | 戳一戳 | OneBotEvent |
| `request_friend` | 好友请求 | OneBotEvent |
| `request_group` | 群请求 | OneBotEvent |
| `meta_event` | 元事件 | OneBotEvent |

**示例：**

```typescript
// 监听私聊消息
client.on('message_private', (event) => {
  console.log(`收到私聊: ${event.raw_message}`);
  console.log(`发送者: ${event.user_id}`);
});

// 监听群聊消息
client.on('message_group', (event) => {
  console.log(`群 ${event.group_id} 收到消息: ${event.raw_message}`);
});

// 监听好友请求
client.on('request_friend', async (event) => {
  console.log(`${event.user_id} 请求添加好友`);
  // 自动同意
  await client.setFriendAddRequest(event.flag, true);
});
```

---

#### off

移除事件处理器。

```typescript
off(event: string, handler: (event: OneBotEvent) => void): void
```

---

## QZoneClient

QQ 空间 API 客户端。

### 构造函数

```typescript
new QZoneClient()
```

**示例：**

```typescript
import { QZoneClient } from './core/qzone-client.js';

const client = new QZoneClient();
```

---

### 认证 API

#### qrLogin

扫码登录（完整流程）。

```typescript
async qrLogin(): Promise<QZoneSession>
```

**示例：**

```typescript
const session = await client.qrLogin();
console.log(`登录成功: ${session.uin}`);
```

**注意：** 此方法会阻塞，直到扫码完成或超时。

---

#### loadCookie

从文件加载 Cookie。

```typescript
loadCookie(): boolean
```

**返回：** boolean - 加载是否成功

---

#### saveCookie

保存 Cookie 到文件。

```typescript
saveCookie(): void
```

---

#### clearCookie

清除登录状态。

```typescript
clearCookie(): void
```

---

#### loggedIn

检查是否已登录。

```typescript
get loggedIn(): boolean
```

---

### 说说 API

#### getFeeds

获取说说列表。

```typescript
async getFeeds(uin: number, pos: number = 0, num: number = 20): Promise<any[]>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| uin | number | - | 目标用户 QQ 号 |
| pos | number | 0 | 起始位置 |
| num | number | 20 | 获取数量 |

---

#### getMyFeeds

获取自己的说说。

```typescript
async getMyFeeds(pos: number = 0, num: number = 20): Promise<any[]>
```

---

#### getDetail

获取说说详情。

```typescript
async getDetail(uin: number, tid: string): Promise<any>
```

---

#### getRecentFeeds

获取最新说说。

```typescript
async getRecentFeeds(page: number = 1): Promise<any>
```

---

#### publish

发布说说。

```typescript
async publish(text: string): Promise<any>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| text | string | 说说的文本内容 |

**示例：**

```typescript
await client.publish('今天天气真好！');
```

---

#### deleteFeed

删除说说。

```typescript
async deleteFeed(tid: string): Promise<any>
```

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| tid | string | 说说 ID |

---

### 互动 API

#### like

点赞。

```typescript
async like(targetUin: number, tid: string): Promise<any>
```

**示例：**

```typescript
await client.like(123456, '说说ID');
```

---

#### postComment

评论说说。

```typescript
async postComment(
  targetUin: number,
  tid: string,
  content: string
): Promise<any>
```

**示例：**

```typescript
await client.postComment(123456, '说说ID', '写得真好！');
```

---

#### replyToComment

回复评论。

```typescript
async replyToComment(
  targetUin: number,
  tid: string,
  commentId: string,
  commentUin: string,
  content: string
): Promise<any>
```

---

#### getMessageComments

获取说说评论列表。

```typescript
async getMessageComments(
  targetUin: number,
  tid: string,
  pos: number = 0,
  num: number = 20
): Promise<any[]>
```

---

#### getAllMessageComments

获取所有评论（自动翻页）。

```typescript
async getAllMessageComments(uin: number, tid: string): Promise<any[]>
```

---

### 用户 API

#### getUserInfo

获取用户信息。

```typescript
async getUserInfo(uin?: number): Promise<any>
```

---

#### getUserCard

获取用户名片信息。

```typescript
async getUserCard(uin: number): Promise<any>
```

---

### 好友 API

#### getFriends

获取好友列表。

```typescript
async getFriends(): Promise<any[]>
```

---

#### getFriendship

获取好友关系信息。

```typescript
async getFriendship(uin: number): Promise<any>
```

---

#### getSpecialCare

获取特别关心列表。

```typescript
async getSpecialCare(): Promise<any[]>
```

---

### 访客 API

#### getVisitors

获取最近访客。

```typescript
async getVisitors(): Promise<any[]>
```

---

### 相册 API

#### getAlbums

获取相册列表。

```typescript
async getAlbums(uin: number, pos: number = 0, num: number = 20): Promise<any[]>
```

---

#### getPhotos

获取相册照片。

```typescript
async getPhotos(
  uin: number,
  albumId: string,
  pos: number = 0,
  num: number = 20
): Promise<any[]>
```

---

### 留言板/日志 API

#### getBoardMessages

获取留言板消息。

```typescript
async getBoardMessages(
  targetUin: number,
  pos: number = 0,
  num: number = 20
): Promise<any[]>
```

---

#### getBlogs

获取日志列表。

```typescript
async getBlogs(uin: number, pos: number = 0, num: number = 20): Promise<any[]>
```

---

### 点赞 API

#### getLikeCount

获取点赞数。

```typescript
async getLikeCount(unikey: string): Promise<any>
```

---

#### getLikeList

获取点赞列表。

```typescript
async getLikeList(unikey: string, beginUin: number = 0): Promise<any[]>
```

---

## SafetyManager

安全管理器。

### 构造函数

```typescript
new SafetyManager()
```

**示例：**

```typescript
import { safetyManager } from './core/safety.js';
```

---

### isAllowed

检查是否允许发送消息。

```typescript
isAllowed(sessionId: number): boolean
```

**示例：**

```typescript
if (safetyManager.isAllowed(123456)) {
  await client.sendPrivateMessage(123456, '消息');
}
```

---

### allow

添加到白名单。

```typescript
allow(sessionId: number): void
```

**示例：**

```typescript
safetyManager.allow(123456);
```

---

### deny

从白名单移除。

```typescript
deny(sessionId: number): void
```

---

### enableSending

启用发送功能。

```typescript
enableSending(): void
```

---

### disableSending

禁用发送功能。

```typescript
disableSending(): void
```

---

### setRequireConfirmation

设置是否需要确认。

```typescript
setRequireConfirmation(require: boolean): void
```

---

### getConfig

获取安全配置。

```typescript
getConfig(): SafetyConfig
```

---

### isConfirmationRequired

检查是否需要确认。

```typescript
isConfirmationRequired(): boolean
```

---

## MessageMonitor

消息监控器。

### 构造函数

```typescript
new MessageMonitor(client: OneBotClient)
```

**示例：**

```typescript
import { MessageMonitor } from './core/monitor.js';

const monitor = new MessageMonitor(client);
```

---

### setReplyGenerator

设置回复生成器。

```typescript
setReplyGenerator(callback: (message: Message) => Promise<string>): void
```

**示例：**

```typescript
monitor.setReplyGenerator(async (msg) => {
  // 调用 AI 生成回复
  const response = await fetch('https://api.example.com/chat', {
    method: 'POST',
    body: JSON.stringify({ message: msg.raw_message })
  });
  const data = await response.json();
  return data.reply;
});
```

---

### addSession

添加监控会话。

```typescript
addSession(sessionId: number): void
```

---

### removeSession

移除监控会话。

```typescript
removeSession(sessionId: number): void
```

---

### startPolling

开始轮询监控。

```typescript
async startPolling(intervalMs: number = 5000): Promise<void>
```

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| intervalMs | number | 5000 | 轮询间隔（毫秒） |

---

### stop

停止监控。

```typescript
stop(): void
```

---

## 工具函数

### fetchWithTimeout

带超时的 fetch。

```typescript
import { fetchWithTimeout } from './utils/index.js';

const response = await fetchWithTimeout('https://api.example.com', {
  method: 'GET'
}, 5000);  // 5 秒超时
```

---

### retry

带重试的函数执行。

```typescript
import { retry } from './utils/index.js';

const result = await retry(
  () => fetch('https://api.example.com').then(r => r.json()),
  3,   // 最多重试 3 次
  1000 // 每次间隔 1 秒
);
```

---

### logger

结构化日志。

```typescript
import { logger } from './utils/index.js';

logger.info('信息日志');
logger.warn('警告日志');
logger.error('错误日志', error);
logger.debug('调试日志');
logger.success('成功日志');
```

---

## MessageSegment 消息段类型

```typescript
// 文本消息
{ type: 'text', data: { text: string } }

// 图片消息
{ type: 'image', data: { file: string; url?: string } }

// 表情
{ type: 'face', data: { id: number } }

// @某人
{ type: 'at', data: { qq: number | 'all' } }

// 回复
{ type: 'reply', data: { id: number } }

// 视频
{ type: 'video', data: { file: string } }

// 语音
{ type: 'voice', data: { file: string } }

// 文件
{ type: 'file', data: { name: string; size: number; fid: string } }
```

---

## 错误处理

所有 API 方法都可能抛出错误，建议使用 try-catch 捕获：

```typescript
try {
  const result = await client.sendPrivateMessage(123456, '消息');
  console.log(`发送成功: ${result.message_id}`);
} catch (error) {
  console.error('发送失败:', error.message);
  
  // 根据错误类型处理
  if (error.message.includes('timeout')) {
    console.log('请求超时，请检查网络');
  } else if (error.message.includes('unauthorized')) {
    console.log('认证失败，请重新登录');
  }
}
```

---

## 类型定义

所有类型定义都在对应的模块中导出：

```typescript
import type {
  OneBotConfig,
  OneBotResponse,
  LoginInfo,
  FriendInfo,
  GroupInfo,
  GroupMemberInfo,
  Message,
  MessageSegment,
  StrangerInfo,
  FileInfo,
  GroupFileInfo,
  HonorInfo,
  VersionInfo,
  OneBotEvent
} from './core/onebot-client.js';

import type {
  QZoneSession
} from './core/qzone-client.js';

import type {
  SafetyConfig
} from './core/safety.js';
```

---

## 最佳实践

### 1. 连接复用

不要每次请求都创建新客户端：

```typescript
// ✅ 好：复用客户端
const client = new OneBotClient(config);
await client.connect();

// ❌ 差：每次都创建新客户端
await new OneBotClient(config).sendPrivateMessage(123, '消息');
```

### 2. 错误重试

网络不稳定时使用 retry：

```typescript
await retry(
  () => client.sendPrivateMessage(123456, '消息'),
  3,
  1000
);
```

### 3. 并发限制

不要同时发送太多消息：

```typescript
// 限制并发数为 5
const semaphore = new Semaphore(5);
for (const userId of userIds) {
  await semaphore.acquire();
  client.sendPrivateMessage(userId, '消息').finally(() => semaphore.release());
}
```

### 4. 资源清理

使用完 WebSocket 后断开连接：

```typescript
try {
  await client.connect();
  // 业务逻辑
} finally {
  client.disconnect();
}
```

---

## 示例代码

### 完整示例：自动回复机器人

```typescript
import { OneBotClient } from './core/onebot-client.js';
import { MessageMonitor } from './core/monitor.js';
import { safetyManager } from './core/safety.js';

async function main() {
  // 创建客户端
  const client = new OneBotClient({
    host: 'localhost',
    port: 3000
  });

  // 测试连接
  if (!await client.testConnection()) {
    console.error('连接失败');
    return;
  }

  // 启用安全发送
  safetyManager.enableSending();
  safetyManager.allow(123456);  // 添加白名单

  // 创建监控器
  const monitor = new MessageMonitor(client);
  monitor.addSession(123456);

  // 设置回复生成器
  monitor.setReplyGenerator(async (msg) => {
    return `收到: ${msg.raw_message}`;
  });

  // 开始监控
  await monitor.startPolling();

  console.log('机器人已启动，按 Ctrl+C 停止');

  // 优雅退出
  process.on('SIGINT', () => {
    monitor.stop();
    client.disconnect();
    process.exit(0);
  });
}

main();
```

---

## License

MIT License - 详见 [LICENSE](../LICENSE) 文件
