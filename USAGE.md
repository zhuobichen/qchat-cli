# qchat-cli 使用文档

本文件分为两部分：
- **[Part A: AI 使用文档](#part-a-ai-使用文档)** — Claude Code / AI Agent 如何通过 CLI 和脚本操作 QQ
- **[Part B: 人类使用文档](#part-b-人类使用文档)** — 人类需要做什么（启动服务、扫码、配置等）

---

# Part A: AI 使用文档

本文档面向 **Claude Code 或其他 AI Agent**，说明如何通过 CLI 命令和 Node.js 脚本操作 QQ 聊天和 QZone 空间。

## A.1 前置条件

以下组件由人类启动和维持（见 Part B），AI 只需确认可用：

| 组件 | 地址 | 用途 |
|------|------|------|
| OneBot HTTP API | `http://127.0.0.1:3000` | 收发消息、好友/群列表 |
| qce-bridge API | `http://127.0.0.1:3001` | 完整聊天记录导出（无 200 条限制） |
| QZone Cookie | `.qzone-cookie` 文件 | QZone 空间 API 认证 |

**验证命令**（AI 执行前先检查）：
```bash
curl -s http://127.0.0.1:3000/get_login_info    # OneBot 是否在线
curl -s http://127.0.0.1:3001/health             # qce-bridge 是否可用
```

## A.2 项目路径

本工具位于：`E:\CodeProject\qchat-cli`

所有命令和脚本均在此目录下执行：
```bash
cd E:/CodeProject/qchat-cli
```

## A.3 OneBot CLI 命令 (`qce`)

### 连接管理

```bash
# 查看/配置连接
qce login --show           # 查看当前连接配置
qce login --test           # 测试连接是否正常
```

### 查看列表

```bash
qce list friends           # 好友列表（含 QQ 号、昵称）
qce list groups            # 群组列表
qce list friends -s <关键词> # 搜索好友
```

### 导出聊天记录

> 注意：OneBot API 最多返回 200 条。导出全量记录请用 `export-full-history.mjs`。

```bash
qce export <QQ号> --format json     # JSON 格式
qce export <QQ号> --format md       # Markdown 格式
qce export <QQ号> --format html     # HTML 格式
qce export <QQ号> --limit 50        # 限制条数
qce export <QQ号> --after 2026-01-01 # 指定起始日期
```

### 发送消息

```bash
qce send <QQ号> "消息内容"
```

**注意**：发送受安全机制控制，目标 QQ 号必须在白名单中。

### 安全机制管理

```bash
qce safety status          # 查看安全状态
qce safety allow <QQ号>    # 添加白名单
qce safety deny <QQ号>     # 移除白名单
```

### 消息监听

```bash
qce monitor start <QQ号> --auto-reply    # 开始监听+自动回复
qce monitor stop                         # 停止
```

## A.4 QZone CLI 命令 (`qce qzone`)

### 登录管理

```bash
qce qzone login           # 扫码登录（AI 无法操作，提示人类扫码）
qce qzone logout          # 清除登录
```

### 查看信息

```bash
qce qzone me              # 自己空间信息（昵称、签名、生日等）
qce qzone user <QQ号>     # 他人空间名片（昵称、备注、亲密度等）
qce qzone friends         # QZone 好友列表
qce qzone visitors        # 空间访客记录
qce qzone albums [QQ号]   # 相册列表
```

### 说说操作

```bash
qce qzone feeds [QQ号] [-n 20] [-p 0]   # 查看说说列表
qce qzone post "内容"                     # 发说说
qce qzone delete <tid>                   # 删说说
qce qzone like <tid>                     # 查点赞数
qce qzone board [QQ号] [-n 10]           # 看留言板
```

**参数说明**：
- `-n, --num`: 获取条数（默认 10）
- `-p, --pos`: 偏移量（默认 0）
- `[QQ号]`: 可选，不传默认自己

## A.5 独立运维脚本

所有脚本用 `npx tsx` 执行（自动处理 TypeScript 导入）：

```bash
cd E:/CodeProject/qchat-cli && npx tsx <脚本名>
```

### QQ 聊天脚本

| 脚本 | 命令 | 说明 |
|------|------|------|
| 监听+回复 | `npx tsx monitor-live.mjs` | 3s 轮询，基于 identity.md 自动回复白名单用户 |
| 监听通知 | `npx tsx monitor-notify.mjs` | 轻量监听，新消息写入 `pending-messages.json` |
| 导出历史(MD) | `npx tsx export-full-history.mjs <QQ号>` | 完整聊天记录 → Markdown（走 qce-bridge :3001） |
| 导出历史(HTML) | `npx tsx export-html.mjs <QQ号>` | 完整聊天记录 → HTML，图片 base64 内嵌 |

### QZone 脚本

| 脚本 | 命令 | 说明 |
|------|------|------|
| 登录 | `npx tsx qzone-login.mjs` | 独立扫码登录（检查缓存 → 过期则重新扫码） |
| 全部说说 | `npx tsx all-feeds.mjs` | 拉取指定用户全部说说，逐条显示 |
| 检查点赞 | `npx tsx check-likes.mjs` | 逐条查询是否已赞 |
| 批量补赞 | `npx tsx bulk-like.mjs` | 拉取全部 → 找未赞 → 逐条补赞 |
| 检查+补赞 | `npx tsx fix-likes.mjs` | 推荐使用，分页逻辑最健壮 |
| API 测试 | `npx tsx test-qzone.mjs` | 连通性测试（用户/好友/说说/访客/留言/点赞） |

### 脚本中的可配置参数

AI 执行脚本前，可能需要修改脚本内的常量：

```javascript
// monitor-live.mjs / monitor-notify.mjs
const FRIENDS = [TARGET_QQ_1];  // 监听的私聊 QQ 号列表
const GROUPS = [GROUP_QQ];    // 监听的群号列表
const POLL_MS = 3000;          // 轮询间隔（毫秒）

// all-feeds.mjs / check-likes.mjs / bulk-like.mjs / fix-likes.mjs
const GUONAN = TARGET_QQ_1;     // 目标 QQ 号（可改为其他人）
```

## A.6 重要注意事项

### 分页陷阱

`qzone.getFeeds()` 的 `num` 参数不可靠，服务器可能返回少于请求的数量。**始终使用 `pos += batch.length` 递增偏移量**。

```javascript
// ❌ 错误：会跳过帖子
pos += 50;

// ✅ 正确：按实际返回数递增
pos += batch.length;
```

### unikey 格式

点赞相关操作中，unikey 必须用 `http://`（非 `https://`），否则服务端返回全零。

```
正确: http://user.qzone.qq.com/TARGET_QQ_1/mood/a260f055c43ef969f2bf0b00
错误: https://user.qzone.qq.com/TARGET_QQ_1/mood/a260f055c43ef969f2bf0b00
```

### 2017 年老帖限制

2017 年及更早的说说**无法点赞**。服务端返回 `code: 0, "succ"` 但实际不生效。这是服务端限制，无法绕过。

### 限流

连续大量请求会触发 `-10000` 限流（"使用人数过多"）。建议：
- 请求间加 200-300ms 延迟
- 限流后等待 15-30 分钟恢复

### Cookie 有效期

`.qzone-cookie` 中的 p_skey 会过期。执行 QZone 操作前先验证：
```bash
npx tsx qzone-login.mjs   # 自动检查并重新登录
```

## A.7 典型工作流

### 工作流 1：查看某人的所有说说

```bash
cd E:/CodeProject/qchat-cli
# 修改 all-feeds.mjs 中的 GUONAN 为目标 QQ 号
npx tsx all-feeds.mjs
```

### 工作流 2：给某人补赞

```bash
cd E:/CodeProject/qchat-cli
# 修改 fix-likes.mjs 中的 GUONAN 为目标 QQ 号
npx tsx fix-likes.mjs
```

### 工作流 3：导出完整聊天记录（HTML 含图片）

```bash
cd E:/CodeProject/qchat-cli
npx tsx export-html.mjs <QQ号>
# 输出: output/full-history-<QQ号>.html
```

### 工作流 4：启动监听+自动回复

```bash
cd E:/CodeProject/qchat-cli
# 确认 identity.md 人格文档已配置
# 确认 monitor-live.mjs 中 FRIENDS/GROUPS 列表正确
npx tsx monitor-live.mjs
```

---

# Part B: 人类使用文档

本文档面向 **人类操作者**，说明你需要手动完成的步骤。AI 无法代劳这些操作。

## B.1 一次性环境搭建

### 1. 安装 Node.js

需要 Node.js 18+。

```powershell
node --version   # 确认版本
```

### 2. 克隆并安装 qchat-cli

```bash
git clone <repo-url> qchat-cli
cd qchat-cli
npm install
npm link          # 使 qce 命令全局可用
```

### 3. 启动 NapCat Shell

```powershell
cd E:\CodeProject\NapCat.Shell
.\launcher-user.bat
```

### 4. 扫码登录 QQ

NapCat Shell 启动后会弹出 QQ 登录界面，用手机 QQ **扫码登录**。

> 注意：这是 NapCat 的 QQ 登录，不是 QZone 登录。两个是独立的。

### 5. 验证 OneBot 和 qce-bridge

打开浏览器或命令行验证：

```bash
# OneBot API（基础收发消息，端口 3000）
curl http://127.0.0.1:3000/get_login_info

# qce-bridge（完整历史导出，端口 3001）
curl http://127.0.0.1:3001/health
```

两者都应返回正常 JSON 响应。

---

## B.2 QZone 空间登录

QZone 需要**独立登录**（不同于 NapCat 的 QQ 登录）。

### 执行登录

```bash
cd E:\CodeProject\qchat-cli
npx tsx qzone-login.mjs
```

### 你需要做的

1. 运行上述命令后，会生成 `qzone-qrcode.png` 图片并自动打开
2. 用 **手机 QQ 扫码**（注意：是 QZone 扫码，用 QQ 的扫一扫功能）
3. 在手机上确认登录
4. 看到终端输出 "登录成功!" 即完成

### 会话有效期

登录凭证保存在 `.qzone-cookie` 文件中（已加入 `.gitignore`，不会上传 GitHub）。p_skey 会定期过期。如果 QZone 命令报 "Session expired"，重新执行 `qzone-login.mjs` 即可。

---

## B.3 AI 人格配置

AI 自动回复的人格由 `identity.md` 定义。

### 编辑人格文件

打开 `E:\CodeProject\qchat-cli\identity.md`，按自己喜好修改。

当前版本 ("癫疯版") 特点：
- 抽象话 + 流汗黄豆
- 不承认自己是 AI
- 极端懒散回复风格
- 完全服从 Todd 的意志

### 生效方式

`monitor-live.mjs` 每次轮询时**重新读取** `identity.md`，所以修改后无需重启脚本，下次轮询自动生效。

---

## B.4 日常操作

### 启动 QQ 消息监听 + 自动回复

```bash
cd E:\CodeProject\qchat-cli
npx tsx monitor-live.mjs
```

此脚本会：
1. 每 3 秒检查是否有新消息
2. 如果是白名单内的好友私聊 → 拉取 20 条上下文
3. 基于 `identity.md` 生成回复 → 自动发送

**停止**：`Ctrl+C`

### 导出聊天记录

```bash
# 标准导出（最近 200 条）
qce export <QQ号> --format html

# 完整导出（无 200 条限制，含图片 base64）
npx tsx export-html.mjs <QQ号>
```

### 查看/管理 QZone

```bash
# 查看说说列表
qce qzone feeds <QQ号> -n 20

# 发说说
qce qzone post "今天天气真好"

# 删说说
qce qzone delete <tid>
```

---

## B.5 注意事项

### 私密信息保护

以下文件已在 `.gitignore` 中排除，**不要手动提交到 GitHub**：

| 文件 | 内容 |
|------|------|
| `.qzone-cookie` | QZone 登录 cookie（含 p_skey） |
| `qzone-qrcode.png` | 临时二维码图片 |
| `pending-messages.json` | 消息暂存文件 |
| `monitor-state.json` | 监听状态文件 |

### NapCat 启动顺序

1. 先启动 NapCat Shell (`launcher-user.bat`)
2. 确认 QQ 登录成功
3. 验证 `:3000` 和 `:3001` 端口可访问
4. 再执行 qchat-cli 的监听/导出操作

### NapCat 重启后

重启 NapCat Shell 后，qce-bridge 插件会**自动重新加载**。验证：

```bash
curl http://127.0.0.1:3001/health   # 应返回 {"ok":true}
```

### 发送消息白名单

向某人发送消息前，需要先将其加入白名单：

```bash
qce safety allow <QQ号>
```

这是防止 AI 误发消息的安全机制。

---

## B.6 故障排查

| 现象 | 可能原因 | 解决 |
|------|----------|------|
| `qce login --test` 失败 | NapCat 未启动 | 启动 NapCat Shell |
| `curl :3001/health` 无响应 | qce-bridge 未加载 | 重启 NapCat Shell |
| QZone 命令报 "未登录" | Cookie 过期 | `npx tsx qzone-login.mjs` |
| 导出只有 200 条 | 用了 OneBot API | 改用 `export-html.mjs`（走 qce-bridge） |
| 说说列表返回少 | 分页 bug | 用 `fix-likes.mjs`（已修复） |
| 点赞不生效 | 2017 年老帖 | 服务端限制，无法点赞 |
| 频繁 -10000 错误 | 请求过多触发了限流 | 等待 15-30 分钟 |

---

*最后更新: 2026-05-12*
