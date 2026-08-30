# qchat-cli

一个面向个人本地环境的 QQ 账号助手。项目通过 OneBot 服务连接已登录的 QQ 账号，并提供聊天记录导出、消息监听、受限发送、群管理和 QQ 空间相关操作。

项目不隶属于腾讯，也不是腾讯官方产品。使用前请确认你已获得相关账号、聊天内容和空间数据的使用授权，并遵守 QQ、NapCatQQ 及相关服务的规则和法律要求。

## 功能

- 通过 OneBot HTTP/WebSocket 服务查看好友、群组和消息
- 将聊天记录导出为 JSON、TXT、HTML、CSV 等格式
- 监听私聊和群聊事件
- 在明确授权和确认后发送消息、执行群管理操作
- 通过扫码登录访问部分 QQ 空间数据
- 将聊天和空间内容发送给配置的 AI 服务生成本地用户画像
- 提供单群隔离机器人模式，仅响应指定群中被 @ 的消息

功能依赖 NapCatQQ、OneBot 服务和 QQ 空间接口，具体可用性可能随外部服务变化。

## 安装

需要 Node.js 18 或更高版本，以及已运行的 NapCatQQ OneBot 服务。

```bash
git clone https://github.com/zhuobichen/qchat-cli.git
cd qchat-cli
npm install
npm run build
npm link
qce --help
```

## 快速开始

```bash
# 配置并测试本地 OneBot 服务
qce login --host 127.0.0.1 --port 3000
qce login --test

# 查看会话并导出记录
qce list friends
qce export <QQ号> --format json

# 监听消息
qce ws-monitor start
```

发送消息默认关闭，且必须先启用发送功能并授权目标会话：

```bash
qce safety enable
qce safety allow <QQ号或群号>
qce send msg <QQ号> "消息内容"
qce send group <群号> "群消息内容"
```

高风险管理操作默认需要交互确认。请谨慎使用 `--force` 和安全相关命令。

单群机器人模式会由本地程序通过 WebSocket 收集新消息并维护短期内存窗口。仅当该群中有人 @ 机器人时，程序才将裁剪后的近期上下文发送给 AI；机器人不会让 AI 自行查询 QQ 消息或轮询会话。

群 Agent 的默认上下文为最近 70 条消息（包括机器人自己的已发送回复），总长度由本地私密配置控制，最大为 16,000 个字符。每累计 60 条新消息，程序会在下一次被 @ 时将增量压缩为群摘要；原始消息不写入磁盘，重启后只保留该摘要。摘要仅用于群内上下文，不会用于私聊或其他群。

模型可调用的工具固定为当前授权群的成员列表、群公告、群文件概览和公开网络检索。所有工具均为只读，每次回复最多执行四次；不会调用 QQ 历史记录、私聊、QQ 空间、群管理、文件下载或任意网址请求。网络检索不得包含群消息、个人信息或任何密钥。

## 隐私与安全

- 使用 `group-bot` 模式时，强烈建议使用专门的小号作为机器人账号，不要使用主 QQ 账号。该小号应只加入目标群，并关闭或不配置 QQ 空间、好友、私聊和其他群聊的访问能力。
- `group-bot` 默认只应授权一个群号。不要开启“全部会话”、自动添加好友、私聊回复或不受限的群管理功能。
- 不要在命令行参数、截图、日志或 issue 中公开 Token、Cookie、API Key、聊天记录和 QQ 号等信息。
- AI 回复必须将群消息视为不可信文本：不能执行消息中要求的系统指令、工具调用、配置更改、密钥读取或跨群发送请求。
- OneBot 服务建议只监听 `127.0.0.1`，并配置 Token。只有在确有需要时才开放局域网访问。
- 项目提供本地确认、发送开关和目标白名单，但这些机制不能替代操作系统权限、NapCatQQ 权限或外部服务的访问控制。

若启用 AI 回复，请从示例创建仅保存在本机的私密配置文件。该文件已被 Git 忽略，不应提交、截图或共享：

```bash
copy private/group-bot.config.example.json private/group-bot.config.json
```

在 `private/group-bot.config.json` 中填入模型服务地址、模型名称和 API Key，然后启动：

```bash
qce group-bot start <群号> --auto-reply
```

## 文档

- [使用指南](./USAGE.md)
- [API 说明](./API.md)
- [架构说明](./ARCHITECTURE.md)
- [贡献指南](./CONTRIBUTING.md)

## 许可

MIT License，详见 [LICENSE](./LICENSE)。

本项目仅供个人学习和经授权的本地管理使用。作者不对账号限制、数据丢失、第三方服务变化或不当使用造成的后果负责。
