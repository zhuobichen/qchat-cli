# QQ Chat Exporter CLI — 全流程跑通记录

> 从零搭建 QQ 消息导出、监听、自动回复和 QZone 空间的完整链路。

---

## 1. 项目背景

### 1.1 涉及项目

| 项目 | 路径 | 说明 |
|------|------|------|
| project-asset-pack | `E:\CodeProject\project-asset-pack` | Agent-First 工作台控制面 |
| NapCat Shell | `E:\CodeProject\NapCat.Shell` | QQ 机器人框架，基于 NTQQ |
| qce-bridge | `E:\CodeProject\NapCat.Shell\plugins\qce-bridge\` | NapCat 插件，内部 MsgApi HTTP 接口 |
| qchat-cli | `E:\CodeProject\qchat-cli` | 本项目的 CLI 工具 |
| qzone-go | `E:\CodeProject\qzone-go` | QZone API 参考实现（Go 语言） |

### 1.2 技术栈

- **运行时**: Node.js 18+ (ESM)
- **语言**: TypeScript
- **CLI 框架**: Commander.js
- **配置持久化**: Conf
- **QQ 协议**: NapCatQQ (基于 NTQQ)
- **API 标准**: OneBot 11 HTTP API
- **QZone API**: 基于 p_skey Cookie 的 Web HTTP API

---

## 2. 架构概览

```
┌──────────────────────────────────────────────────────┐
│                   NapCat Shell                        │
│  ┌─────────────────┐  ┌──────────────────────────┐   │
│  │  OneBot HTTP API │  │     qce-bridge 插件       │   │
│  │  127.0.0.1:3000  │  │     127.0.0.1:3001       │   │
│  │  (200条限制)     │  │  (无限制，msgId分页)      │   │
│  └────────┬────────┘  └───────────┬──────────────┘   │
└───────────┼───────────────────────┼──────────────────┘
            │                       │
     ┌──────┴──────┐         ┌──────┴──────┐
     │  qchat-cli   │         │  完整导出     │
     │  CLI 命令     │         │  Markdown    │
     │  收发/监听    │         │  HTML(图片)  │
     └─────────────┘         └─────────────┘

┌──────────────────────────────────────────────────────┐
│                 QZone Web HTTP API                    │
│  user.qzone.qq.com/proxy/domain/...                   │
│  基于 p_skey + g_tk 认证                              │
│  ├─ 说说 (taotao.qq.com)                              │
│  ├─ 点赞 (w.qzone.qq.com)                             │
│  ├─ 评论 (taotao.qzone.qq.com)                        │
│  ├─ 好友/访客/留言板/相册                             │
│  └─ 扫码登录 (ptlogin2.qq.com)                        │
└──────────────────────────────────────────────────────┘
```

---

## 3. 工作台接入

按 `project-asset-pack` 工作台流程，6 个阶段全部完成：

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 项目初始化 + CLI 框架 (Commander.js) | ✅ |
| 2 | NapCatQQ 集成 + 认证 (OneBotClient, AuthManager) | ✅ |
| 3 | 消息获取 + 基础导出 (JSON, TXT) | ✅ |
| 4 | 高级导出 (HTML, CSV, Markdown) + 批量 + 完整历史 (qce-bridge) | ✅ |
| 5 | QZone 空间 API 集成 (扫码登录、说说、点赞、评论、访客、留言板) | ✅ |
| 6 | 监听+自动回复 (identity.md 人格) + 测试 + 文档 | ✅ |

---

## 4. NapCatQQ 与 qce-bridge

### 4.1 NapCat Shell 启动

```powershell
cd E:\CodeProject\NapCat.Shell
.\launcher-user.bat
```

启动后扫码登录 QQ。NapCat 自动在 `:3000` 启动 OneBot HTTP 服务。

### 4.2 qce-bridge 插件

qce-bridge 是 NapCat 插件，封装内部 MsgApi 暴露为 HTTP 接口，**无 200 条消息限制**：

- `GET http://127.0.0.1:3001/health` — 健康检查
- `POST http://127.0.0.1:3001/get_full_msg_history` — msgId 分页拉取完整聊天记录

请求体：`{ peerUid, chatType, count?, startMsgId? }`，`peerUid` 支持直接传 QQ 号。

### 4.3 连接验证

```bash
curl http://127.0.0.1:3000/get_login_info     # OneBot
curl http://127.0.0.1:3001/health              # qce-bridge（应返回 {"ok":true}）
```

---

## 5. CLI 命令体系

### 5.1 项目结构

```
qchat-cli/
├── src/
│   ├── cli.ts                    # 主入口，注册所有子命令
│   ├── commands/
│   │   ├── login.ts              # 连接管理 (qce login)
│   │   ├── list.ts               # 好友/群组列表 (qce list)
│   │   ├── export.ts             # 消息导出 (qce export)
│   │   ├── backup.ts             # 定时备份 (qce backup)
│   │   ├── send.ts               # 消息发送 + 安全机制 (qce send)
│   │   ├── monitor.ts            # 消息监听 (qce monitor)
│   │   └── qzone.ts              # QZone 空间 (qce qzone)
│   ├── core/
│   │   ├── onebot-client.ts      # OneBot HTTP 客户端
│   │   ├── qzone-client.ts       # QZone Web API 客户端
│   │   ├── auth.ts               # 认证管理 (Conf 持久化)
│   │   ├── fetcher.ts            # 批量消息获取
│   │   ├── safety.ts             # 安全机制（白名单）
│   │   ├── monitor.ts            # 监听器核心
│   │   └── exporter/             # 导出格式
│   │       ├── base.ts / json.ts / txt.ts / html.ts / excel.ts
├── *.mjs                         # 独立运维脚本
├── identity.md                   # bot 人格文档
├── pending-messages.json          # 消息桥梁文件
└── .qzone-cookie                 # QZone 登录缓存（已 gitignore）
```

### 5.2 OneBot CLI 命令

```bash
# 连接管理
qce login --host 127.0.0.1 --port 3000
qce login --test

# 好友/群组
qce list friends
qce list groups
qce list friends --search <关键词>

# 消息导出
qce export TARGET_QQ_1 --format json
qce export TARGET_QQ_1 --format md
qce export TARGET_QQ_1 --format html

# 消息发送
qce send TARGET_QQ_1 "消息内容"

# 安全机制
qce safety status
qce safety allow TARGET_QQ_1
qce safety deny TARGET_QQ_1

# 消息监听
qce monitor start TARGET_QQ_1 --auto-reply
```

### 5.3 QZone CLI 命令 (`qce qzone`)

```bash
# 登录管理
qce qzone login          # 扫码登录
qce qzone logout         # 清除登录

# 个人信息
qce qzone me             # 查看自己空间信息

# 用户
qce qzone user <uin>     # 查看用户名片

# 说说
qce qzone feeds [uin] [-n 10] [-p 0]   # 查看说说列表
qce qzone post "内容"                    # 发说说
qce qzone delete <tid>                  # 删说说

# 互动
qce qzone like <tid>                    # 查看点赞数
qce qzone board [uin] [-n 10]           # 查看留言板
qce qzone friends                       # 好友列表
qce qzone visitors                      # 空间访客
qce qzone albums [uin]                  # 相册列表
```

---

## 6. 运维脚本详解

### 6.1 QQ 聊天脚本

| 脚本 | 用途 | 依赖端口 |
|------|------|----------|
| `monitor-live.mjs` | 实时监听（3s 轮询），基于 `identity.md` 人格自动回复 | :3000 |
| `monitor-notify.mjs` | 轻量监听，新消息写入 `pending-messages.json` 供 cron 处理 | :3000 |
| `export-full-history.mjs` | 导出完整聊天记录为 Markdown | :3001 |
| `export-html.mjs` | 导出完整聊天记录为 HTML（图片 base64 内嵌） | :3001 |

### 6.2 QZone 脚本

| 脚本 | 用途 | 说明 |
|------|------|------|
| `qzone-login.mjs` | 独立扫码登录 | 检查已有 cookie，无效则重新扫码 |
| `all-feeds.mjs` | 导出指定用户全部说说 | 逐条打印内容 |
| `check-likes.mjs` | 检查点赞状态 | 逐条查询是否已赞 |
| `bulk-like.mjs` | 批量补赞 | 先拉全部说说 → 检查未赞 → 逐条补赞 |
| `fix-likes.mjs` | 检查+补赞（推荐） | 同上，但分页逻辑更健壮 |
| `test-qzone.mjs` | API 连通性测试 | 测试用户信息/好友/说说/访客/留言板/点赞 |

---

## 7. QZone 集成要点

### 7.1 认证机制

- **扫码登录**: `ssl.ptlogin2.qq.com/ptqrshow` 获取 QR 码 → 轮询 `xui.ptlogin2.qq.com/ssl/ptqrlogin` 等待扫码 → 重定向 `ptlogin2.qzone.qq.com/check_sig` 获取 p_skey
- **Cookie 持久化**: `.qzone-cookie` 文件（JSON），`loadCookie()` / `saveCookie()` / `clearCookie()`
- **g_tk 计算**: hash 5381 算法，`hash & 0x7FFFFFFF`，基于 p_skey 计算

### 7.2 关键 API 端点

| 功能 | 端点 |
|------|------|
| 说说列表 | `taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6` |
| 说说明细 | `taotao.qzone.qq.com/cgi-bin/emotion_cgi_getcmtreply_v6` |
| 点赞 | `w.qzone.qq.com/cgi-bin/likes/internal_dolike_app` |
| 点赞数查询 | `r.qzone.qq.com/cgi-bin/user/qz_opcnt2` |
| 点赞列表 | `users.qzone.qq.com/cgi-bin/likes/get_like_list_app` |
| 发说说 | `taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6` |
| 删说说 | `taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6` |
| 留言板 | `m.qzone.qq.com/cgi-bin/new/get_msgb` |
| 好友列表 | `r.qzone.qq.com/cgi-bin/tfriend/friend_show_qqfriends.cgi` |
| 访客记录 | `g.qzone.qq.com/cgi-bin/friendshow/cgi_get_visitor_simple` |
| 用户信息 | `base.qzone.qq.com/cgi-bin/user/cgi_userinfo_get_all` |
| 用户名片 | `r.qzone.qq.com/cgi-bin/user/cgi_personal_card` |
| 相册列表 | `photo.qzone.qq.com/fcgi-bin/fcg_list_album_v3` |

### 7.3 已知陷阱

1. **unikey 的 http vs https**: `http://user.qzone.qq.com/{uin}/mood/{tid}` 和 `https://` 在服务端是**不同的 key**。必须用 `http://`，否则点赞数查询返回 0。

2. **分页漏帖**: `getFeeds` 的 `num` 参数服务器不严格遵守。请求 `num=50` 可能只返回 10-20 条。必须用 `pos += batch.length` 而非 `pos += 50` 进行分页，否则会跳过大量帖子。

3. **2017 年老帖无法点赞**: QZone 服务端静默拒绝 2017 年及更早的点赞操作。接口返回 `code: 0, "succ"` 但 `ilike` 不变。此为服务端限制，无法绕过。

4. **响应格式**: `taotao.qq.com` 返回 JSON 时外层可能包裹 `_Callback({...});`，需用正则提取最外层 `{}`。

5. **g_tk 必须注入**: 所有 QZone API 请求必须在 URL 参数中携带 `g_tk`。

6. **限流**: 短时间大量请求（尤其是跨用户拉取说说）会触发 `-10000` "使用人数过多" 限流，通常 15-30 分钟恢复。

---

## 8. 安全机制

### 8.1 消息发送控制

```
%APPDATA%/qchat-cli/config.json
```

- `allowSending`: 全局发送开关
- `allowedSessions`: 白名单（QQ 号列表）
- `requireConfirmation`: 每次发送是否需要人工确认

### 8.2 监听注入防御

`monitor-live.mjs` 内置多层规则：
- 模式匹配过滤
- 长度限制
- 控制字符过滤

### 8.3 私密信息保护

`.gitignore` 排除：
- `.qzone-cookie` — QZone 登录 cookie
- `qzone-qrcode.png` — 扫码图片
- `pending-messages.json` — 消息暂存
- `monitor-state.json` — 监听状态

---

## 9. 功能验证记录

### 9.1 OneBot 连接

- 用户: Todd (YOUR_QQ)
- 好友数: 176
- 群数: 63

### 9.2 消息导出

- 郭楠聊天记录: 200 条 (2026-04-23 ~ 2026-05-11)
- 导出格式: JSON / Markdown / HTML

### 9.3 QZone 全量操作

- 郭楠 (TARGET_QQ_1) 全部说说: **245 条** (2010-08 ~ 2026-05)
- 已赞: 183 条（之前手动点过）
- 补赞: 42 条（跨 2010-2026 各年份）
- 2017 年老帖: 20 条（服务端限制，无法点赞）
- 最早记录: 2010 年 8 月

### 9.4 监听 + 自动回复

- `monitor-live.mjs` 已运行验证
- 白名单内用户私聊消息自动回复
- `identity.md` ("癫疯版") 人格驱动

---

## 10. 遇到的问题与解决

### 10.1 TypeScript 编译

| 问题 | 解决 |
|------|------|
| `ExportOptions` ESM 导出失败 | 改用 `export type { ... }` |
| `response.json()` 返回 `unknown` | 添加 `as OneBotResponse<T>` 类型断言 |

### 10.2 NapCat 配置

| 问题 | 解决 |
|------|------|
| 配置文件不生效 | NapCat 自动生成 `onebot11_<QQ号>.json`，需修改实际文件 |

### 10.3 QZone API

| 问题 | 解决 |
|------|------|
| `parseJSONP` 无法解析 `_Callback({...});` | 改为提取最外层 `{}` |
| 说说接口 500 | URL 从 `taotao.qzone.qq.com` 改为 `taotao.qq.com` |
| 点赞数全返回 0 | unikey 中的 `https` 改为 `http` |
| 点赞接口 "Session expired" | `request()` 自动注入 `g_tk`；`opuin` 必须是操作者自己的 UIN |
| 留言板 `.slice` 报错 | 解析路径改为 `data.commentList` |
| 分页漏帖 (只拉到 49/245 条) | `pos += batch.length` 替代 `pos += 50` |
| 2017 年老帖点赞无效 | 服务端限制，无法绕过 |

---

## 11. 当前运行状态

| 组件 | 状态 | 说明 |
|------|------|------|
| NapCat Shell | 🟢 按需启动 | `launcher-user.bat` |
| qce-bridge (:3001) | 🟢 随 NapCat 启动 | 完整聊天记录导出 |
| QZone 登录 | 🟢 Cookie 缓存 | `.qzone-cookie`，过期后重新扫码 |
| 消息监听 | 🟡 按需启动 | `monitor-live.mjs` 或 `monitor-notify.mjs` |
| 安全机制 | 🟢 已启用 | 白名单 + 确认机制 |

---

## 12. 可扩展方向

1. **AI 智能回复**: 接入 Claude API 替代 identity.md 关键词匹配
2. **多会话监听**: 同时监听多个好友/群
3. **定时导出**: 定时自动备份聊天记录 + QZone 说说
4. **Webhook 通知**: 消息到达时推送通知到其他平台
5. **增量同步**: 基于 message_seq 增量拉取聊天记录
6. **QZone 相册导出**: 批量下载相册图片，内嵌 HTML/Markdown
7. **QZone 评论管理**: 批量查看/删除/回复评论

---

*最后更新: 2026-05-12*
*工具: QQ Chat Exporter CLI + NapCatQQ + QZone API + Claude Code*
