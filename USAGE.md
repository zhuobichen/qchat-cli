# qchat-cli 使用文档

> 本项目为全 CLI 化工具。**人类只需启动服务 + 扫码，其余操作交给 AI 执行即可。**

---

# Part A: AI 操作手册

## A.1 项目路径与启动

```bash
cd E:/CodeProject/qchat-cli
```

## A.2 前置检查

```bash
curl -s http://127.0.0.1:3000/get_login_info  # OneBot 在线?
curl -s http://127.0.0.1:3001/health           # qce-bridge 可用?
npx tsx qzone-login.mjs                        # QZone cookie 有效?
```

## A.3 CLI 命令全集

### OneBot 聊天

| 命令 | 说明 |
|------|------|
| `qce login --host localhost --port 3000` | 配置 NapCat 连接 |
| `qce login --test` | 测试连接 |
| `qce list friends` | 好友列表（QQ号+昵称） |
| `qce list groups` | 群组列表 |
| `qce list friends -s 关键词` | 搜索好友 |
| `qce export <QQ号> --format json\|md\|html` | 导出聊天（OneBot，最多200条） |
| `qce export <QQ号> --limit 50` | 限制条数 |
| `qce send <QQ号> "消息"` | 发送消息（需白名单） |
| `qce safety status` | 查看安全状态 |
| `qce safety allow <QQ号>` | 添加白名单 |
| `qce safety deny <QQ号>` | 移除白名单 |
| `qce monitor start <QQ号> --auto-reply` | 监听+自动回复 |

### QZone 空间

| 命令 | 说明 |
|------|------|
| `qce qzone login` | 扫码登录 |
| `qce qzone logout` | 清除登录 |
| `qce qzone me` | 自己空间信息 |
| `qce qzone user <QQ号>` | 他人空间名片 |
| `qce qzone feeds [QQ号] [-n 20] [-p 0]` | 说说列表 |
| `qce qzone post "内容"` | 发说说 |
| `qce qzone delete <tid>` | 删说说 |
| `qce qzone comments <tid> [QQ号] [-n 20]` | 查看评论（含回复） |
| `qce qzone comment <QQ号> <tid> "内容"` | 发表评论 |
| `qce qzone like <tid>` | 查点赞数 |
| `qce qzone friends` | 好友列表 |
| `qce qzone visitors` | 空间访客 |
| `qce qzone board [QQ号] [-n 10]` | 留言板 |
| `qce qzone albums [QQ号]` | 相册列表 |

## A.4 运维脚本

### 通用脚本（根目录，不含隐私信息）

```bash
# 完整聊天历史导出（走 qce-bridge :3001，无 200 条限制）
npx tsx export-html.mjs <QQ号>          # HTML（图片 base64 内嵌）
npx tsx export-full-history.mjs <QQ号>   # Markdown

# QZone 说说导出（含评论，HTML）
npx tsx export-qzone-feeds.mjs [QQ号]   # 不传默认当前登录用户

# QZone 登录
npx tsx qzone-login.mjs                 # 检查/刷新 cookie
```

### 隐私脚本（`private/`，读取 `config.json`）

> 使用前需配置：`cp private/config.example.json private/config.json`

```bash
# QZone 运维（一个脚本覆盖所有操作）
npx tsx private/qzone-ops.mjs feeds <名称>    # 查看全部说说
npx tsx private/qzone-ops.mjs check <名称>    # 逐条检查点赞状态
npx tsx private/qzone-ops.mjs like <名称>     # 检查+批量补赞
npx tsx private/qzone-ops.mjs export <名称>   # 导出 HTML（含评论）

# 消息监听
npx tsx private/monitor-live.mjs              # 实时监听+人格回复
npx tsx private/monitor-notify.mjs            # 轻量监听→pending-messages.json
```

`config.json` 结构：
```json
{
  "myQQ": 你的QQ号,
  "monitoredFriends": [监听的好友QQ号],
  "monitoredGroups": [监听的群号],
  "qzoneTargets": {
    "好友名": QQ号
  }
}
```

## A.5 典型工作流

### 导出某人的 QZone 说说+评论
```bash
# 方式1：传 QQ 号（通用脚本）
npx tsx export-qzone-feeds.mjs TARGET_QQ_1

# 方式2：用配置名（隐私脚本，需已配置 config.json）
npx tsx private/qzone-ops.mjs export 郭楠
```

### 给某人补赞
```bash
npx tsx private/qzone-ops.mjs like 郭楠
```

### 导出完整聊天记录
```bash
npx tsx export-html.mjs TARGET_QQ_1
# → output/full-history-TARGET_QQ_1.html
```

### 检查某人空间状态并查看说说
```bash
qce qzone user TARGET_QQ_1
qce qzone feeds TARGET_QQ_1 -n 20
```

## A.6 关键陷阱

| 陷阱 | 说明 |
|------|------|
| **分页** | `getFeeds()` 用 `pos += batch.length`，不能 `pos += 50` |
| **unikey** | 必须用 `http://` 而非 `https://`，否则点赞数据全 0 |
| **2017 老帖** | 无法点赞，服务端静默拒绝 |
| **限流** | 批量操作加 200-300ms 间隔，`-10000` 后等 15-30 分钟 |
| **Cookie** | `.qzone-cookie` 定期过期，执行 QZone 操作前先 `qzone-login.mjs` |

---

# Part B: 人类操作清单

> 以下步骤 AI 无法代劳，需要你手动完成。

## B.1 一次性环境

### 1. 本机已就绪

| 组件 | 路径 | 状态 |
|------|------|------|
| Node.js 18+ | 系统安装 | ✅ |
| NapCat Shell | `E:\CodeProject\NapCat.Shell\` | 已部署 |
| qce-bridge 插件 | `E:\CodeProject\NapCat.Shell\plugins\qce-bridge\` | 已加载 |
| qchat-cli | `E:\CodeProject\qchat-cli\` | 已安装 |

### 2. 给别人的安装步骤

```bash
git clone https://github.com/zhuobichen/qchat-cli.git
cd qchat-cli
npm install && npm link

# 配置隐私信息
cp private/config.example.json private/config.json
# 编辑 config.json，填入 QQ 号和目标列表
```

## B.2 每次使用

### 1. 启动 NapCat（如需聊天功能）
```powershell
cd E:\CodeProject\NapCat.Shell
.\launcher-user.bat
# → 弹出登录窗口 → 手机 QQ 扫码登录
```

### 2. 登录 QZone（如需空间功能）
```bash
cd E:\CodeProject\qchat-cli
npx tsx qzone-login.mjs
# → 弹出二维码 → 手机 QQ 扫码 → 确认登录
```

### 3. 配置 AI 人格（可选）
编辑 `identity.md`，自定义自动回复风格。`monitor-live.mjs` 下次轮询自动生效，无需重启。

## B.3 告诉 AI 做什么

全部 CLI 化，直接用自然语言告诉 AI：

```
"导出 TARGET_QQ_1 的聊天记录为 HTML"
"查看郭楠的全部说说并导出"
"给郭楠补赞"
"启动消息监听和自动回复"
"切换 QZone 账号"
```

---

## B.4 私密信息保护

| 文件 | 状态 |
|------|------|
| `private/config.json` | `.gitignore` 排除，`config.example.json` 是模板 |
| `.qzone-cookie` | `.gitignore` 排除 |
| `qzone-qrcode.png` | `.gitignore` 排除 |
| `output/` | `.gitignore` 排除 |
| `dist/` | `.gitignore` 排除 |

## B.5 故障排查

| 现象 | 解决 |
|------|------|
| `qce login --test` 失败 | 启动 NapCat Shell |
| `:3001/health` 无响应 | 重启 NapCat Shell |
| QZone "未登录" | `npx tsx qzone-login.mjs` |
| 导出只有 200 条 | 用 `export-html.mjs`（走 qce-bridge） |
| 点赞不生效（2017 老帖） | 服务端限制，无法绕过 |
| 请求过多 -10000 | 等 15-30 分钟 |

---

## 功能对照：refactor 前后

| 旧脚本 (已删除) | 新方式 | 说明 |
|------|------|------|
| `all-feeds.mjs` | `private/qzone-ops.mjs feeds` | 查看全部说说 |
| `check-likes.mjs` | `private/qzone-ops.mjs check` | 检查点赞 |
| `bulk-like.mjs` | `private/qzone-ops.mjs like` | 批量补赞 |
| `fix-likes.mjs` | `private/qzone-ops.mjs like` | 同上，分页逻辑已内置 |
| `test-qzone.mjs` | `qce qzone me/user/feeds/...` | 用 CLI 命令逐项验证 |
| `monitor-live.mjs` | `private/monitor-live.mjs` | 改为读 `config.json` |
| `monitor-notify.mjs` | `private/monitor-notify.mjs` | 改为读 `config.json` |
| `monitor-daemon.mjs` | `private/monitor-live.mjs` | 功能合并 |
| `watch-and-reply.mjs` | `private/monitor-live.mjs` | 功能合并 |

> **无功能丢失**。所有能力已覆盖，QQ 号统一从 `config.json` 读取，不再硬编码。
