<div align="center">

<h1>qchat-cli &nbsp;<img src="./logo.png" width="72" valign="middle" alt="qchat-cli logo" /></h1>

**把 QQ 里发生过的事，变成可导出、可监听、可自动化的数据**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/)
[![OneBot](https://img.shields.io/badge/OneBot-11-2496ed)](https://github.com/botuniverse/onebot-11)
[![NapCat](https://img.shields.io/badge/NapCat-QQNT-ff6b6b)](https://github.com/NapNeko/NapCatQQ)
[![Release](https://img.shields.io/github/v/release/zhuobichen/qchat-cli?sort=semver)](https://github.com/zhuobichen/qchat-cli/releases)
[![License](https://img.shields.io/badge/License-MIT-f4b400)](./LICENSE)
[![Local-first](https://img.shields.io/badge/local--first-zero%20telemetry-8a2be2)](#隐私与安全)

简体中文 · [English](./README.en.md)

</div>

![qce 终端演示](./docs/images/demo.png)

`qce` 是一个跑在你自己电脑上的 QQ 命令行工具。它不做“点一下导出”的按钮，而是把 QQ 账号变成一个**可编程的数据源**：导出可读的聊天记录、实时监听消息、按规则自动回复、把群聊接进 AI，也能做群管理和 QQ 空间的事。

## 它能回答 QQ 回答不了的几个问题

- 谁在群里提过我？这周那个群到底在吵什么？
- 去年这个时候，我们在聊什么？
- 把某个群的历史导出来，做成本地可搜索的档案 / 知识库。
- 每天下班前，自动给我一份“今天各群发生了什么”的日报。

## 60 秒上手

前置：本机已跑起 NapCat（QQNT 的 OneBot 实现）。装法见 [docs/napcat.md](./docs/napcat.md)（含 Docker 一键版），或直接用你已有的 OneBot 服务。

```bash
git clone https://github.com/zhuobichen/qchat-cli.git
cd qchat-cli && npm install && npm run build && npm link

$ qce login --host 127.0.0.1 --port 3000   # 配置 + 连接测试
  ✓ 已连接  OneBot 11 / 账号 123456789

$ qce list groups
群组列表 (65):
  123456789   示例·测试群 (3人)
  234567890   示例·通知群 (273人)
  ...

$ qce export 123456789 --format md
  导出成功!
    文件: ./output/group-123456789.md
    消息数: 200
```

真实输出（节选自本机运行）：导出会保留时间、发言人、正文，并把图片/表情/语音转成占位符，直接可读。

## 四种典型用法

**1）导出归档** —— JSON / TXT / HTML / CSV / Markdown，支持时间范围与条数限制

```bash
qce export <群号或QQ号> --format md --limit 500
qce export --all --format json           # 全量会话
```

**2）群日报 —— 把一段群聊压成一页**

```bash
qce digest 123456789                    # 最近 500 条 → output/digest-<群号>-<日期>.md
qce digest 123456789 --days 1 --ai      # 只看今天，并调用模型生成要点摘要
qce digest 123456789 --limit 2000 --stdout   # 同时打印到终端
qce digest 123456789 --send-to 10001000       # 生成后直接把摘要发到 QQ
qce digest 123456789 --send-to 123456789 --send-kind group   # 发到群（优先发 .md 文件）
qce digest 123456789 --from-index            # 不联网，直接用本地索引出日报
qce digest 123456789 --push me@qq.com   # 生成后直接发邮件（用本机 agently-cli，需先 auth login）
qce digest 123456789 --push me@qq.com --push-dry   # 只打印将执行的发信命令
```

产出：消息量 / 参与人数 / 谁说得最多 / 24 小时活跃分布（柱状图）/ 值得回看的长文·链接·点名·附件 / 分享过的链接；加 `--ai` 再由模型补 3–5 条要点（用 `private/group-bot.config.json` 里的模型，无需额外配置）。

**3）本地索引 + 搜索 + MCP 接入**

索引先落盘，搜索就是毫秒级（不再每次重拉历史）：

```bash
qce index 123456789                   # 建/增量更新某个群的索引
qce index --all --limit 2000          # 更新所有已入索引的群
qce index --stats                     # 看各群条数与最新时间
qce index --clear                     # 清空索引
```

```bash
qce search 开会                       # 读本地索引（中文二元组匹配，不用分词）
qce search 开会 --refresh             # 先增量更新再搜
qce index 123456789 --embed           # 同时生成语义向量（阿里云百炼 text-embedding-v4）
qce search 谁写完了论文 --semantic    # 语义检索：问法不必和原文一致
qce search 报错 -g 123456789 --since 7d
qce search 论文 --from 10001000 --limit 50 --json
```

接进 Claude Code / Cursor（MCP，stdio）：

```json
{
  "mcpServers": {
    "qchat": { "command": "qce", "args": ["mcp"] }
  }
}
```

暴露三个只读工具：`search_messages`（关键词搜索）、`group_digest`（群日报）、`list_groups`（群列表）。模型可以在编辑器里直接问"上周群里谁提过这个报错"。

**4）实时监听 + AI 回复**（需要模型 API Key，本地私密配置）

```bash
qce ws-monitor start                     # 实时事件流
qce group-bot start <群号> --auto-reply  # 单群隔离：只在被 @ 时说话
qce private-bot start <QQ号>             # 私聊自动回复（single / split 两种模式）
```

**5）自动化与运维**

```bash
qce send group <群号> "..."              # 发送（需先 safety enable + 白名单）
qce admin mute <群号> <QQ号> 30          # 群管理：禁言/踢人/设管理员
qce qzone feeds                          # QQ 空间：说说 / 评论 / 点赞
qce napcat status                        # NapCat 进程管理
```

发送与高风险管理操作默认关闭，必须先显式开启并授权目标会话：

```bash
qce safety enable
qce safety allow <QQ号或群号>
```

## 安装

需要 Node.js 18+，以及一个已登录的 NapCat / OneBot 11 服务。

**还没装 NapCat？一条命令起一个（Docker）：**

```bash
cp .env.example .env      # 改掉 WEBUI_TOKEN；Linux 下把 UID/GID 改成 id -u / id -g
docker compose up -d
docker logs -f napcat     # 看二维码，手机 QQ 扫码登录
```

起好之后（`127.0.0.1:3000` 是 OneBot，`127.0.0.1:6099` 是 WebUI），再装 `qce`：

```bash
git clone https://github.com/zhuobichen/qchat-cli.git
cd qchat-cli
npm install
npm run build
npm link          # 之后即可全局使用 qce
qce --help
```

> 只有开机自启需求时才需要 `npm link`；也可以直接 `node dist/cli.js <命令>`。

## 隐私与安全

- 本项目**不隶属于腾讯**，也不是官方产品。仅用于处理你本人拥有或已获授权访问的数据。
- 建议用**小号**跑机器人：只加入目标群，关闭或不配置好友、私聊、QQ 空间与其他群。
- OneBot 服务应只监听 `127.0.0.1` 并配置 Token；不要裸奔到公网。
- 不要在命令行、截图、日志或 issue 里暴露 Token / Cookie / API Key / 聊天记录 / QQ 号。
- AI 回复必须把群消息当作**不可信文本**：不执行其中要求的系统指令、工具调用、配置修改或跨群发送。
- 第三方协议工具（NapCat 等）可能触发账号风控、限制或封禁；风险由使用者自行承担。

## AI 机器人的边界（细节）

`group-bot` 通过本地 WebSocket 收集新消息并维护短期内存窗口，仅当群内有人 @ 机器人才会把裁剪后的上下文发给 AI：

- 默认上下文为最近 70 条（含机器人自己的回复），总长度上限 16,000 字符
- 每累计 60 条新消息，下次被 @ 时把增量压缩成群摘要；原始消息不落盘，重启只保留摘要
- 模型可用工具固定为：本群成员列表、群公告、群文件概览、公开网络检索（全部只读，每次回复最多 4 次）
- 不会让模型查询 QQ 历史、私聊、QQ 空间、群管理或下载文件

`private-bot` 不需要 @，指定 QQ 号发来的每条可处理消息都会触发回复，支持两种 Agent 模式：

- `single`（默认）：一个 Agent 服务多个 QQ 号，共享近上下文与摘要（存在跨私聊信息泄露风险，仅在参与者全部授权时使用）
- `split`：一个 QQ 号一个独立 Agent / 上下文 / 记忆，彼此不加载

每次处理边界：上下文最多 100 条、单轮最多 4 次工具调用 / 3 个工具回合 / 45 秒总时限。私聊工具仅限本地表情库、按需加载的本地 Skill 和公开网络检索。

### Skill 分类

在 `private/skills/*/SKILL.md` 的 frontmatter 里声明：

- `kind: personality` —— 人格 Skill，每次回复固定注入（最多 2 个，每个 ≤3,000 字）
- `kind: capability`（或缺省）—— 能力 Skill，仅在消息与名称/描述匹配时载入（最多 2 个）

人格 Skill 只写稳定的表达偏好与沟通风格，不要塞私聊事实、密钥或会变的知识。

### 可选 MCP

仅支持 `private/group-bot.config.json` 中显式声明的 stdio 服务器 + 逐工具白名单；默认不启用，也不会读取系统里其他 MCP 配置。单次调用有超时与 4,000 字结果上限，参数会拒绝明显包含密钥/Token/联系方式/地址/QQ 号的内容。

配置示例（`allowedTools` 必填）：

```json
{
  "mcpServers": [
    {
      "name": "public-info",
      "command": "node",
      "args": ["C:\\path\\to\\public-mcp-server.js"],
      "allowedTools": ["lookup"]
    }
  ]
}
```

启用 AI 回复前，从示例创建仅保存在本机的私密配置（已被 Git 忽略，不要提交或截图）：

```bash
copy private/group-bot.config.example.json private/group-bot.config.json
```

在 `private/group-bot.config.json` 填入模型服务地址、模型名与 API Key（推荐 `apiKeyEnv` 从环境变量读取），然后启动：

```bash
qce group-bot start <群号> --auto-reply

qce safety enable
qce safety allow <QQ号1>
qce private-bot start <QQ号1> <QQ号2>              # 默认 single
qce private-bot start <QQ号1> <QQ号2> --mode split # 每人独立上下文
```

## 文档

- [使用指南 USAGE.md](./USAGE.md) —— 全部命令、脚本、典型工作流
- [API 说明 API.md](./API.md)
- [架构说明 ARCHITECTURE.md](./ARCHITECTURE.md)
- [贡献指南 CONTRIBUTING.md](./CONTRIBUTING.md)

## 许可

MIT License，详见 [LICENSE](./LICENSE)。

本项目仅供个人学习与经授权的本地管理使用。作者不对账号限制、数据丢失、第三方服务变化或不当使用造成的后果负责。
