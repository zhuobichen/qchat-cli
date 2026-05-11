# QQ Chat Exporter CLI — 全流程跑通记录

> 从零搭建 QQ 消息导出、监听、自动回复和主动发送的完整链路。

---

## 1. 项目背景

### 1.1 涉及项目

| 项目 | 路径 | 说明 |
|------|------|------|
| project-asset-pack | `E:\CodeProject\project-asset-pack` | Agent-First 工作台控制面 |
| NapCatQQ | `E:\CodeProject\NapCatQQ` | QQ 协议框架源码 |
| NapCat Shell | `E:\CodeProject\NapCat.Shell` | NapCatQQ 运行时 |
| qchat-cli | `E:\CodeProject\qchat-cli` | 本次新建的 CLI 工具 |

### 1.2 技术栈

- **运行时**: Node.js (ESM)
- **语言**: TypeScript
- **CLI 框架**: Commander.js
- **配置持久化**: Conf
- **QQ 协议**: NapCatQQ (基于 NTQQ)
- **API 标准**: OneBot 11 HTTP API

---

## 2. 工作台接入

### 2.1 接入的项目

按 `project-asset-pack` 工作台流程，依次接入：

1. `qq-chat-history` — Python CLI 解析 QQ 聊天记录 txt 文件
2. `qq-chat-exporter` — Web UI 版导出工具
3. `NapCatQQ` — QQ 协议框架
4. `qchat-cli` — **本次新建项目**，从 Web UI 重构为 CLI

### 2.2 qchat-cli 生命周期

6 个阶段全部完成：

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 项目初始化 + CLI 框架 (Commander.js) | ✅ |
| 2 | NapCatQQ 集成 + 认证 (OneBotClient, AuthManager) | ✅ |
| 3 | 消息获取 + 基础导出 (JSON, TXT) | ✅ |
| 4 | 高级导出 (HTML, CSV) + 批量 | ✅ |
| 5 | 配置管理 + 备份 | ✅ |
| 6 | 测试 + 文档 + README | ✅ |

---

## 3. NapCatQQ 配置与连接

### 3.1 运行时部署

NapCatQQ 源码无法直接运行，下载了 `NapCat.Shell` 发行版：

```
路径: E:\CodeProject\NapCat.Shell
```

### 3.2 启动流程

```powershell
cd E:\CodeProject\NapCat.Shell
.\launcher-user.bat
```

启动后需要**扫码登录** QQ，登录成功后 NapCat Shell 自动启动 HTTP 服务。

### 3.3 OneBot HTTP 配置

NapCat 自动生成配置文件，路径格式：

```
E:\CodeProject\NapCat.Shell\config\onebot11_<QQ号>.json
```

配置内容（启用 HTTP 服务）：

```json
{
  "httpServers": [
    {
      "name": "default",
      "enable": true,
      "host": "127.0.0.1",
      "port": 3000
    }
  ]
}
```

### 3.4 连接验证

```bash
curl http://127.0.0.1:3000/get_login_info
```

返回：

```json
{
  "data": {
    "user_id": YOUR_QQ,
    "nickname": "Todd"
  }
}
```

---

## 4. CLI 功能实现

### 4.1 项目结构

```
qchat-cli/
├── src/
│   ├── cli.ts                    # CLI 入口
│   ├── commands/
│   │   ├── login.ts              # 连接管理
│   │   ├── list.ts               # 列表查看
│   │   ├── export.ts             # 消息导出
│   │   ├── backup.ts             # 备份
│   │   ├── send.ts               # 消息发送（含安全机制）
│   │   └── monitor.ts            # 消息监听
│   └── core/
│       ├── onebot-client.ts      # OneBot HTTP 客户端
│       ├── auth.ts               # 认证管理 (Conf 持久化)
│       ├── fetcher.ts            # 批量消息获取
│       ├── safety.ts             # 安全机制（白名单）
│       ├── monitor.ts            # 监听器
│       └── exporter/
│           ├── base.ts           # 导出基类
│           ├── json.ts           # JSON 导出
│           ├── txt.ts            # TXT 导出
│           ├── html.ts           # HTML 导出
│           └── excel.ts          # CSV 导出
├── temp/                         # 导出文件
├── monitor-live.mjs              # 实时监听脚本
├── monitor-daemon.mjs            # 后台守护进程
└── watch-and-reply.mjs           # 自动回复脚本
```

### 4.2 核心命令

```bash
# 连接管理
qce login --host 127.0.0.1 --port 3000

# 查看列表
qce list friends
qce list groups

# 导出消息
qce export friend TARGET_QQ_1 --format json
qce export friend TARGET_QQ_1 --format md
qce export friend TARGET_QQ_1 --format html

# 消息发送
qce send TARGET_QQ_1 "你好"

# 安全机制
qce safety status
qce safety allow TARGET_QQ_1
qce safety deny TARGET_QQ_1

# 消息监听
qce monitor TARGET_QQ_1
```

---

## 5. 安全机制

### 5.1 设计

发送消息需要满足以下条件：

1. 全局发送开关已开启 (`allowSending`)
2. 目标在白名单中 (`allowedSessions`)
3. 可选：每次发送需确认 (`requireConfirmation`)

### 5.2 配置文件

```
%APPDATA%/qchat-cli/config.json
```

```json
{
  "allowSending": true,
  "allowedSessions": [TARGET_QQ_1],
  "requireConfirmation": true
}
```

### 5.3 当前白名单

| QQ 号 | 昵称 | 状态 |
|--------|------|------|
| TARGET_QQ_1 | 郭蝻 / 黑夜の面纱 | ✅ 已授权 |
| 102909703 | 机器人 | ❌ 已移除 |

---

## 6. 功能验证

### 6.1 连接成功

```
用户: Todd (YOUR_QQ)
好友数: 176
群数: 63
```

### 6.2 消息导出

导出与郭蝻的聊天记录：

- **消息总数**: 200 条
- **时间范围**: 2026-04-23 ~ 2026-05-11
- **Todd**: 141 条
- **郭蝻**: 59 条
- **导出格式**: JSON / MD

导出文件：

```
temp/friend_TARGET_QQ_1_郭蝻.json      (21条，首次)
temp/chat_郭蝻_2026-05-11.md           (21条，当日)
temp/chat_郭蝻_完整版_2026-05-11.md    (200条，全量)
```

> NapCat 服务端最多缓存 200 条消息，更早的消息无法通过 API 获取。

### 6.3 主动发送消息

成功向郭蝻发送测试消息：

```
你好！我是 Claude Code，一个 AI 助手。我正在测试 QQ Chat Exporter CLI 工具的消息发送功能。
```

成功发送分享内容（AI 时代工作能力重新定义的核心观点摘要）。

### 6.4 消息监听 + 自动回复

后台监听脚本 `monitor-live.mjs` 运行中：

```
消息监听已启动
监控对象: TARGET_QQ_1 (郭蝻)
自动回复: 已开启
轮询间隔: 3000ms
```

工作流程：

```
每3秒轮询 → 发现新消息 → 过滤自己发的 → 打印日志 → 自动回复
```

### 6.5 完整链路验证

```
                  ┌─────────────────────────────────┐
                  │         NapCat Shell             │
                  │   QQ 协议层 (127.0.0.1:3000)     │
                  └──────────┬──────────────────────┘
                             │ OneBot HTTP API
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
   │ CLI 导出 │         │ 主动发送 │         │ 监听回复 │
   │ qce export│        │ qce send │         │ monitor │
   └─────────┘         └─────────┘         └─────────┘
        │                    │                    │
        ▼                    ▼                    ▼
   JSON/MD/HTML          QQ 消息             自动回复
   temp/ 目录           郭蝻收到             郭蝻发→自动回
```

---

## 7. 遇到的问题与解决

### 7.1 TypeScript 编译问题

| 问题 | 解决 |
|------|------|
| `ExportOptions` 接口 ESM 导出失败 | 改用 `export type { ... }` |
| `response.json()` 返回 `unknown` | 添加 `as OneBotResponse<T>` 类型断言 |
| `inquirer` 缺少类型声明 | 需安装 `@types/inquirer`（待处理） |

### 7.2 NapCat 配置问题

| 问题 | 解决 |
|------|------|
| 创建了 `onebot11_1.json` 但不生效 | NapCat 自动生成 `onebot11_<QQ号>.json`，需修改实际文件 |
| 配置中 `httpServers` 为空数组 | 手动填入 HTTP 服务配置 |

### 7.3 后台脚本问题

| 问题 | 解决 |
|------|------|
| `watch-and-reply.mjs` 后台运行退出 | 改用 `monitor-daemon.mjs` / `monitor-live.mjs` |

---

## 8. 当前运行状态

| 组件 | 状态 | 说明 |
|------|------|------|
| NapCat Shell | 🟢 运行中 | QQ 协议层，HTTP API 在 127.0.0.1:3000 |
| 消息监听 | 🟢 后台运行 | `monitor-live.mjs`，每 3 秒轮询 |
| 自动回复 | 🟢 已开启 | 白名单内用户发消息自动回复 |
| 安全机制 | 🟢 已启用 | 白名单 + 确认机制 |

---

## 9. 可扩展方向

1. **多会话监听**: 当前只监听郭蝻，可扩展为同时监听多个好友/群
2. **AI 智能回复**: 接入 Claude API 替代关键词匹配，实现真正的智能对话
3. **消息过滤**: 按关键词、消息类型过滤
4. **定时导出**: 定时自动备份聊天记录
5. **Webhook 通知**: 消息到达时推送通知到其他平台
6. **历史消息增量同步**: 基于 message_seq 增量拉取，避免重复

---

*文档生成时间: 2026-05-11*
*工具: QQ Chat Exporter CLI + NapCatQQ + Claude Code*
