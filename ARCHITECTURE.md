# 项目架构文档

## 目录

- [整体架构](#整体架构)
- [核心模块](#核心模块)
- [工作流程](#工作流程)
- [数据流向](#数据流向)
- [技术选型](#技术选型)

---

## 整体架构

```
                    ┌─────────────────────────────────┐
                    │      用户 (CLI / Scripts)       │
                    └─────────────┬───────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────────┐
                    │          CLI 层                  │
                    │  (commands/*)                   │
                    └─────────────┬───────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────────┐
                    │          业务层                  │
                    │  - auth.ts (认证)                │
                    │  - safety.ts (安全)              │
                    │  - danger.ts (危险操作)          │
                    │  - audit.ts (审计)               │
                    └─────────────┬───────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────────────┐
                    │          API 层                  │
                    │  - onebot-client.ts             │
                    │  - qzone-client.ts              │
                    └─────────────┬───────────────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  │                               │
                  ▼                               ▼
        ┌─────────────────┐            ┌─────────────────┐
        │   NapCatQQ      │            │   QZone Web API │
        │  (OneBot HTTP)  │            │                 │
        └─────────────────┘            └─────────────────┘
```

---

## 核心模块

### 1. CLI 层 (`src/commands/`)

| 文件 | 功能 |
|------|------|
| `login.ts` | 配置 NapCat 连接 |
| `list.ts` | 列出好友/群组 |
| `export.ts` | 导出聊天记录 |
| `send.ts` | 发送消息 |
| `monitor.ts` | 轮询监听 |
| `ws-monitor.ts` | WebSocket 实时监听 |
| `admin.ts` | 管理命令 |
| `qzone.ts` | QZone 相关 |
| `backup.ts` | 定时备份 |
| `napcat.ts` | NapCat 管理 |

### 2. 业务层 (`src/core/`)

| 模块 | 功能 |
|------|------|
| `auth.ts` | 认证管理（保存/读取配置） |
| `safety.ts` | 安全机制（白名单、确认） |
| `danger.ts` | 危险操作确认 |
| `audit.ts` | 审计日志 |
| `monitor.ts` | 消息监听逻辑 |
| `fetcher.ts` | 消息拉取（分页、去重） |

### 3. API 层 (`src/core/`)

| 模块 | 功能 |
|------|------|
| `onebot-client.ts` | OneBot 协议客户端 |
| `qzone-client.ts` | QZone Web API 客户端 |

### 4. 工具层 (`src/utils/`)

| 模块 | 功能 |
|------|------|
| `index.ts` | fetchWithTimeout, logger, retry |
| `resolveSession.ts` | 会话类型识别（好友/群聊） |

### 5. 导出器 (`src/core/exporter/`)

| 模块 | 功能 |
|------|------|
| `base.ts` | 基类（消息解析） |
| `json.ts` | JSON 导出 |
| `txt.ts` | 纯文本导出 |
| `html.ts` | HTML 导出（含样式） |
| `excel.ts` | Excel/CSV 导出 |

---

## 工作流程

### 消息监听流程

```
1. 用户输入 qce ws-monitor start
   ↓
2. auth.ts 读取配置，初始化 OneBotClient
   ↓
3. onebot-client.ts 建立 WebSocket 连接
   ↓
4. 收到消息 → 安全检查（白名单）→ 触发回调
   ↓
5. monitor.ts 执行自动回复
   ↓
6. audit.ts 记录操作日志
```

### 危险操作流程

```
1. 用户输入 qce admin delete-friend 123456
   ↓
2. danger.ts 显示警告，要求确认
   ↓
3. 二次输入确认（极高危险）
   ↓
4. audit.ts 记录操作
   ↓
5. onebot-client.ts 执行 API 调用
```

---

## 数据流向

### 配置数据

```
config/index.ts → JSON 文件 → 每次启动读取
```

### 审计日志

```
audit.ts → console 输出 + audit.log 文件
```

### 消息处理

```
NapCat → WebSocket → onebot-client.ts → monitor.ts → 自动回复 → NapCat
```

---

## 技术选型

| 技术 | 用途 | 理由 |
|------|------|------|
| TypeScript | 开发语言 | 类型安全，更好的 IDE 支持 |
| Commander.js | CLI 框架 | 简洁强大的命令行构建 |
| Conf | 配置存储 | 持久化 JSON 配置 |
| Inquirer.js | 交互式 CLI | 友好的用户确认交互 |
| Chalk | 颜色输出 | 提升终端体验 |
| Ora | 加载动画 | 长任务友好提示 |
| better-sqlite3 | SQLite 支持 | 高性能本地存储（预留） |

---

## 扩展建议

### 1. 插件系统

```
plugins/
├── ai-reply.ts
├── analytics.ts
└── custom-command.ts
```

### 2. 中间件系统

```typescript
// 消息处理中间件链
pipeline([
  RateLimit(),
  Whitelist(),
  ContentFilter(),
  ReplyCallback(),
])
```

---

## 相关文档

- [API 参考](./API.md)
- [使用指南](./USAGE.md)
- [贡献指南](./CONTRIBUTING.md)
