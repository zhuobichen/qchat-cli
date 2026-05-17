<div align="center">

<img src="./logo.png" width="320" alt="qchat-cli Logo" />

# qchat-cli

**下一代 QQ 聊天运维 CLI 工具**

> 集成 OneBot 协议 + QZone 空间 API 的全能工具

[![GitHub License][license-shield]][license-url]
[![Node.js Version][node-shield]][node-url]
[![npm Version][npm-shield]][npm-url]
[![Code Style][prettier-shield]][prettier-url]

[English](#-quick-start) • [中文](#-快速开始)

</div>

<br />

## ✨ 主要特性

<div align="center">
  <table>
    <tr>
      <td align="center"><strong>📦 消息导出</strong></td>
      <td align="center"><strong>💬 实时监听</strong></td>
      <td align="center"><strong>🤖 自动回复</strong></td>
    </tr>
    <tr>
      <td align="center">多格式导出（JSON/HTML/Markdown/CSV），图片内嵌</td>
      <td align="center">WebSocket 实时推送，毫秒级响应</td>
      <td align="center">AI 自动回复，上下文记忆</td>
    </tr>
    <tr>
      <td align="center"><strong>🔒 安全机制</strong></td>
      <td align="center"><strong>🌐 QZone 集成</strong></td>
      <td align="center"><strong>⚙️ 管理功能</strong></td>
    </tr>
    <tr>
      <td align="center">白名单+双重确认+审计日志</td>
      <td align="center">扫码登录、说说、评论、点赞</td>
      <td align="center">踢人、禁言、管理员设置</td>
    </tr>
  </table>
</div>

<br />

## 📦 安装

### 前置要求

- **Node.js 18+**
- **NapCatQQ**（OneBot 协议服务）

### 快速安装

```bash
# 克隆项目
git clone https://github.com/zhuobichen/qchat-cli.git
cd qchat-cli

# 安装依赖
npm install

# 全局链接
npm link

# 开始使用！
qce --help
```

<br />

## 🚀 快速开始

### 1. 连接 NapCat

```bash
# 配置连接
qce login --host localhost --port 3000

# 测试连接
qce login --test
```

### 2. 导出聊天记录

```bash
# 导出为 HTML（含图片）
qce export <QQ号> --format html

# 导出为 Markdown
qce export <QQ号> --format md
```

### 3. 实时监听消息

```bash
# WebSocket 实时监控（推荐）
qce ws-monitor start

# 轮询模式（兼容性更好）
qce monitor start <QQ号>
```

### 4. 登录 QZone

```bash
# 扫码登录
qce qzone login

# 查看说说
qce qzone feeds <QQ号>

# 发表说说
qce qzone post "今天天气真好！"
```

<br />

## 📖 完整文档

- **[API 参考](./API.md)** — 完整的 TypeScript API 文档
- **[使用指南](./USAGE.md)** — 详细使用说明和技巧
- **[架构文档](./ARCHITECTURE.md)** — 项目架构和设计思路
- **[贡献指南](./CONTRIBUTING.md)** — 如何贡献代码

<br />

## 📋 命令速查

### 📡 OneBot 系列

| 命令 | 说明 |
|------|------|
| `qce login` | 配置 NapCat 连接 |
| `qce list friends/groups` | 查看好友/群组列表 |
| `qce export <QQ> [--format]` | 导出聊天记录 |
| `qce send <QQ> "消息"` | 发送消息 |
| `qce ws-monitor start` | WebSocket 实时监控 |
| `qce backup --add <QQ>` | 定时备份 |

### 🌐 QZone 系列

| 命令 | 说明 |
|------|------|
| `qce qzone login/logout` | 扫码登录/登出 |
| `qce qzone me/user <QQ>` | 查看空间信息 |
| `qce qzone feeds [QQ] [-n 20]` | 查看说说列表 |
| `qce qzone post/delete` | 发/删说说 |
| `qce qzone comment <QQ> <tid>` | 评论说说 |

### 🔧 管理系列

| 命令 | 说明 |
|------|------|
| `qce admin audit` | 查看审计日志 |
| `qce admin delete-friend` | 删除好友 |
| `qce admin kick <群> <用户>` | 踢出成员 |
| `qce admin mute-all` | 全员禁言 |
| `qce admin safety status` | 安全状态 |

<br />

## 🏗️ 项目架构

```
qchat-cli/
├── src/
│   ├── cli.ts                 # 入口文件
│   ├── commands/              # CLI 命令
│   │   ├── admin.ts          # 管理命令
│   │   ├── ws-monitor.ts     # WebSocket 监控
│   │   └── ...
│   ├── core/                  # 核心模块
│   │   ├── onebot-client.ts  # OneBot API
│   │   ├── qzone-client.ts   # QZone API
│   │   ├── audit.ts          # 审计日志
│   │   └── danger.ts         # 危险操作
│   └── utils/                 # 工具函数
├── private/                   # 隐私脚本（不提交）
└── ...
```

[架构图](./qchat-cli架构图.png)

<br />

## 🛡️ 安全机制

| 功能 | 说明 |
|------|------|
| **白名单** | 仅允许指定用户自动回复 |
| **双重确认** | 危险操作需要二次输入确认 |
| **审计日志** | 所有敏感操作记录在案 |
| **Bypass 模式** | 脚本自动化使用，跳过确认 |

<br />

## 🎯 常见问题

### 为什么需要 NapCatQQ？

NapCatQQ 提供了稳定的 OneBot HTTP API，qchat-cli 通过它与 QQ 通信。

### 导出的消息有 200 条限制？

可以使用 `qce-bridge` 模式绕过限制，完整导出历史记录。

### 如何添加自动回复 AI？

修改 `monitor.ts` 中的 `replyCallback` 函数，接入你的 AI API。

### 危险操作有哪些？

运行 `qce admin dangerous-list` 查看完整列表。

<br />

## 💖 致谢

特别感谢以下优秀的开源项目：

- **[NapCatQQ](https://github.com/NapNeko/NapCatQQ)** — 强大的 QQ 机器人框架
- **[qzone-go](https://github.com/fanchunke/qzone-go)** — QZone API 参考实现
- **[qq-chat-exporter](https://github.com/NapNeko/qq-chat-exporter)** — 聊天记录导出 Web 版

以及所有参与测试和贡献的朋友们！ 🎉

<br />

## 📄 许可证

MIT License. 详见 [LICENSE](./LICENSE)。

---

<div align="center">

> 本项目仅供学习交流使用。请勿用于骚扰、刷屏等违反 QQ 用户协议的行为。

<br />

**Made with ❤️ by qchat-cli Team**

</div>

<!-- 徽章链接 -->
[license-shield]: https://img.shields.io/github/license/zhuobichen/qchat-cli?style=flat-square
[license-url]: ./LICENSE
[node-shield]: https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square&logo=node.js
[node-url]: https://nodejs.org
[npm-shield]: https://img.shields.io/badge/npm-v0.1.0-red?style=flat-square&logo=npm
[npm-url]: https://www.npmjs.com
[prettier-shield]: https://img.shields.io/badge/code_style-Prettier-ff69b4?style=flat-square
[prettier-url]: https://prettier.io
