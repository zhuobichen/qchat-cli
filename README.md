# qchat-cli

QQ 聊天运维 CLI 工具，支持导出、发送、监听、自动回复。基于以下两个开源项目：

| 项目 | 说明 |
|------|------|
| [NapCatQQ](https://github.com/NapNeko/NapCatQQ) | QQ 机器人框架，基于 NTQQ 协议，提供 OneBot HTTP API |
| [qq-chat-exporter](https://github.com/NapNeko/qq-chat-exporter) | QQ 聊天记录导出工具（Web UI 版），本项目是其 CLI 化重构 |

## 功能特性

- **完整聊天记录导出** — 通过 qce-bridge 插件直通 NapCat 内部 MsgApi，无 200 条限制
- **多种导出格式** — Markdown、HTML（含图片 base64 内嵌）、JSON、TXT、CSV
- **实时消息监听** — 3s 轻量轮询，发现新消息后拉取上下文
- **人格化自动回复** — 基于 `identity.md` 人格文档，支持注入防御
- **消息发送** — OneBot API 发包，支持白名单和确认机制
- **会话管理** — 好友/群组列表、搜索

## 架构

```
┌─────────────┐     OneBot HTTP      ┌──────────────┐
│  NapCatQQ   │◄────────────────────►│   qchat-cli   │
│  (NTQQ)     │     :3000            │  (CLI 工具)   │
│             │                      │              │
│  ┌────────┐ │     Internal MsgApi  │  导出/发送/   │
│  │qce-bridge│◄────────────────────►│  监听/回复    │
│  └────────┘ │     :3001            │              │
└─────────────┘                      └──────────────┘
```

- **`:3000`** — OneBot 标准 API，有 200 条消息限制，用于日常收发和监听
- **`:3001`** — qce-bridge 内部 API，msgId 分页，用于拉取完整聊天记录

## 前置要求

- Node.js 18+
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) 已部署并运行
- qce-bridge 插件已加载（`NapCat.Shell/plugins/qce-bridge/`，端口 3001）

## 安装

```bash
git clone <repo-url> qchat-cli
cd qchat-cli
npm install
npm link
```

## 快速开始

### 1. 配置连接

```bash
qce login --host localhost --port 3000
qce login --test   # 测试连接
```

### 2. 导出聊天记录

```bash
# 基本导出（OneBot API，最多 200 条）
qce export TARGET_QQ_1

# 完整导出（qce-bridge，无限制，含图片）
node export-html.mjs TARGET_QQ_1    # HTML（图片 base64 内嵌）
node export-full-history.mjs TARGET_QQ_1  # Markdown
```

### 3. 消息监听

```bash
# 轻量监听 + 通知（推荐，配合 cron 使用）
node monitor-notify.mjs

# 实时监听 + 人格回复
node monitor-live.mjs
```

### 4. 发送消息

```bash
qce send TARGET_QQ_1 "消息内容"
```

## 命令参考

### `qce login` — 配置连接

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-H, --host <host>` | 主机地址 | localhost |
| `-p, --port <port>` | 端口 | 3000 |
| `-t, --token <token>` | Token | - |
| `--test` | 测试连接 | - |
| `--show` | 显示配置 | - |

### `qce list` — 会话列表

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-t, --type <type>` | friend / group | 全部 |
| `-s, --search <kw>` | 搜索关键词 | - |

### `qce export` — 导出记录

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `[session]` | 会话 ID（QQ号） | - |
| `-f, --format <fmt>` | json / txt / html / excel | json |
| `-o, --output <path>` | 输出目录 | ./output |
| `--limit <n>` | 限制条数 | - |
| `--after <date>` | 开始日期 | - |
| `--before <date>` | 结束日期 | - |
| `--all` | 导出所有会话 | - |

### `qce send` — 发送消息

| 选项 | 说明 |
|------|------|
| `<session>` | 会话 ID |
| `<message>` | 消息内容 |
| `-t, --type <type>` | friend / group（默认 friend） |

### `qce backup` — 定时备份

| 选项 | 说明 |
|------|------|
| `-s, --schedule <cron>` | Cron 表达式 |
| `-o, --output <path>` | 备份目录 |
| `--add <id>` | 添加会话 |
| `--remove <id>` | 移除会话 |
| `--list` | 显示配置 |
| `--run` | 立即备份 |

## 脚本说明

| 脚本 | 用途 |
|------|------|
| `monitor-live.mjs` | 实时监听（3s 轮询），基于 identity.md 人格自动回复 |
| `monitor-notify.mjs` | 轻量监听，新消息写入 pending-messages.json 供 cron 消费 |
| `export-full-history.mjs` | 完整导出 → Markdown（走 qce-bridge :3001） |
| `export-html.mjs` | 完整导出 → HTML，图片 base64 内嵌（走 qce-bridge :3001） |
| `identity.md` | 人格文档，monitor-live.mjs 据此生成回复 |

## 配置文件

配置文件位置：
- Windows: `%APPDATA%/qchat-cli/config.json`
- macOS: `~/Library/Preferences/qchat-cli/config.json`
- Linux: `~/.config/qchat-cli/config.json`

## 常见问题

### 连接失败

确保 NapCatQQ 已启动并启用了 HTTP 服务。验证：
```bash
curl http://127.0.0.1:3000/get_login_info  # OneBot
curl http://127.0.0.1:3001/health           # qce-bridge
```

### 导出消息不完整（只有 200 条）

OneBot API 有 200 条限制，使用 qce-bridge 脚本可拉取完整记录：
```bash
node export-html.mjs <QQ号>
```

### qce-bridge 返回 0 条消息

重启 NapCat Shell，然后确认 `curl http://127.0.0.1:3001/health` 返回 `{"ok":true}`。

## 开发

```bash
npm install
npm run dev -- --help
npm run build
npm run typecheck
```

## 许可证

MIT
