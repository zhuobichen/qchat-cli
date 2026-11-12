# qchat-cli 项目交接文档

> 写给下一个 AI 助手。本文档基于 2026-05-12~13 的开发记忆。

---

## 一、这是什么

QQ 聊天运维 CLI 工具。基于 NapCatQQ（OneBot 协议）+ QZone Web API，实现消息导出/监听/自动回复/QZone 空间管理。

**仓库**：`git@github.com:zhuobichen/qchat-cli.git`

---

## 二、架构

```
NapCat Shell (NTQQ)              qchat-cli
├─ OneBot HTTP :3000  ←→  CLI 命令 / 监听脚本
├─ qce-bridge :3001   ←→  完整聊天导出（无200条限制）
                                 ↕
                          QZone Web API (p_skey + g_tk)
```

**三个关键外部依赖**：
| 服务 | 地址 | 检查命令 |
|------|------|----------|
| NapCat OneBot | `http://127.0.0.1:3000` | `curl http://127.0.0.1:3000/get_login_info` |
| qce-bridge | `http://127.0.0.1:3001` | `curl http://127.0.0.1:3001/health` |
| QZone Cookie | `.qzone-cookie` 文件 | `npx tsx qzone-login.mjs` |

---

## 三、项目结构

```
qchat-cli/
├── src/
│   ├── cli.ts                  # CLI 入口（Commander.js）
│   ├── commands/               # 子命令
│   │   ├── qzone.ts            # QZone 命令
│   │   ├── send.ts             # 发送消息
│   │   ├── export.ts           # 导出聊天
│   │   ├── monitor.ts          # 监听
│   │   └── ...
│   ├── core/
│   │   ├── qzone-client.ts     # QZone Web API 客户端（核心）
│   │   ├── onebot-client.ts    # OneBot HTTP 客户端
│   │   └── ...
│   └── utils/
│       └── resolveSession.ts   # 昵称→QQ号 解析器
│
├── monitor-live.mjs            # 🔑 消息监听+回复（最重要）
├── export-html.mjs             # 聊天记录导出 HTML
├── export-qzone-feeds.mjs      # QZone 说说导出 HTML
├── qzone-login.mjs             # QZone 扫码登录
│
├── private/                    # 🔒 隐私目录
│   ├── config.json             # 真实配置（gitignore）
│   ├── config.example.json     # 配置模板
│   ├── qzone-ops.mjs           # QZone 运维脚本
│   ├── monitor-live.mjs        # 桥接入口
│   ├── monitor-notify.mjs      # 轻量监听
│   ├── load-config.mjs         # 配置加载器
│   ├── memory/                 # 对话记忆（gitignore）
│   ├── locks/                  # 消息锁文件（gitignore）
│   └── DEBUG-LOG.md            # 调试记录（不上传）
│
├── identity.md                 # AI 人格（当前未用）
├── identity_弱智吧.md          # AI 人格（当前使用）
├── config.example.json         # 配置模板（根目录）
├── pending-messages.json       # 本地管道消息暂存
│
├── README.md / USAGE.md / PLAN.md / QUESTION.md / WORKFLOW-REPORT.md
└── HANDOVER.md                 # 本文档
```

---

## 四、关键配置

`private/config.json`（gitignore，不提交）：
```json
{
  "myQQ": YOUR_QQ,
  "monitoredFriends": [TARGET_QQ_1, TARGET_QQ_2, TARGET_QQ_3],
  "monitoredGroups": [GROUP_QQ],
  "replyWhitelist": [TARGET_QQ_1],
  "qzoneTargets": { "好友名": TARGET_QQ_1 },
  "deepseekApiKey": "sk-xxx",
  "maxRawContext": 20,
  "identityFile": "identity_弱智吧.md"
}
```

---

## 五、启动方式

### 人类操作（AI 无法代劳）

1. 启动 NapCat：双击 `E:\CodeProject\NapCat.Shell\launcher-user.bat`，扫码登录 QQ
2. QZone 登录：`npx tsx qzone-login.mjs`，扫码

### AI 操作

```bash
cd E:/CodeProject/qchat-cli

# ⚠️ 启动前必须：
# 1. 先 curl 确认 NapCat 在线
# 2. pkill -f "monitor-live" 杀掉旧进程
# 3. rm -rf private/locks/* 清除旧锁
# 4. 只启动一个！不要重复启动！

npx tsx monitor-live.mjs
```

---

## 六、监听模式

`monitor-live.mjs` 有双模式，通过 config.json 的 `deepseekApiKey` 是否有值自动切换：

| 模式 | 触发条件 | 机制 |
|------|----------|------|
| **云端** | `deepseekApiKey` 非空 | 调 DeepSeek API 生成回复，秒级响应 |
| **本地管道** | `deepseekApiKey` 为空 | 写入 `pending-messages.json`，由 Claude Code cron 消费 |

**当前状态**：`deepseekApiKey` 为空 → 本地模式

---

## 七、已知问题（重要）

### 1. 重复回复 🐛
**现象**：别人发一条消息，AI 回复多条（内容不同）

**根因分析（逐步定位）**：
1. `sender.user_id` 可能是字符串 vs 数字，`===` 比较失败 → 已修（`Number()` 转换）
2. `friendLastTime` 边界被 AI 自己的回复推高 → 对方消息被误过滤
3. `friendLastTime` 在预加载**期间**设定，预加载完成后已过期 → 已修（移到预加载后）
4. qce-bridge 和 OneBot 对同一消息的 `message_id` 不同 → 文件锁去重失效
5. **多进程残留** — pkill 杀不干净，多个 monitor 并发调用 DeepSeek → NapCat sendMsg 超时

**当前去重方案**：时间边界（`friendLastTime`，预加载后设一次）+ 文件锁（`tryLock`，writeFileSync wx flag）

### 2. NapCat sendMsg 超时
多进程并发发消息导致。必须确保只有一个 monitor 运行。

### 3. 本地模式回复延迟
cron 最小粒度1分钟。需要更快的`/loop`机制。

---

## 八、QZone API 陷阱

| 陷阱 | 正确做法 |
|------|----------|
| `unikey` 协议 | 必须 `http://` 不能 `https://` |
| 分页漏帖 | `pos += batch.length` 不能 `pos += 50` |
| 2017老帖 | 点赞返回 success 但不生效，服务端限制 |
| `-10000` 限流 | 批量操作间隔200-300ms |
| Cookie | `.qzone-cookie` 几小时过期 |

---

## 九、已完成功能

- QZone 完整 API（说说CRUD/点赞/评论/好友/访客/留言板/相册）
- 昵称解析（`qce export 郭楠` 替代 `qce export TARGET_QQ`）
- QZone 说说导出 HTML（含评论）
- 聊天记录导出 HTML（含图片 base64）
- 历史消息预加载（qce-bridge 全量）
- AI 摘要压缩（首次生成，持久化复用）
- 混合上下文（20条原始 + 摘要 + 记忆）
- 隐私分离（private/config.json）
- Git 历史清洗（QQ号替换为占位符）

---

## 十、下一步

按 PLAN.md 的 P0：
1. **修复重复回复** — 核心：单进程保证 + 纯文件锁去重 + 去掉时间边界
2. **写 start.sh / stop.sh** — 规范化进程管理
3. **攻破删评论 API** — 需浏览器抓包

---

*2026-05-13 生成，基于 2 天开发记忆*
