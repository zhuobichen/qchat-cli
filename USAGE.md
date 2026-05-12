# qchat-cli 使用文档

> 全 CLI 化 QQ 运维工具。人类负责启动服务 + 扫码，AI 负责所有操作。

---

# Part A: AI 操作手册

## A.1 前置条件

| 组件 | 检查命令 | 说明 |
|------|----------|------|
| OneBot | `curl http://127.0.0.1:3000/get_login_info` | NapCat QQ 协议层 |
| qce-bridge | `curl http://127.0.0.1:3001/health` | 完整聊天记录导出 |
| QZone | `npx tsx qzone-login.mjs` | 扫码登录，cookie 缓存在 `.qzone-cookie` |
| 隐私配置 | `test -f private/config.json` | 不存在则提示人类创建 |

## A.2 项目路径

```bash
cd E:/CodeProject/qchat-cli
```

## A.3 命令全集

### OneBot 聊天

```bash
# 连接
qce login --host localhost --port 3000
qce login --test                     # 验证连接

# 列表
qce list friends                     # 好友（QQ号 + 昵称）
qce list groups                      # 群组
qce list friends -s 关键词           # 搜索

# 导出（OneBot API，最多 200 条）
qce export <QQ号> --format json
qce export <QQ号> --format md
qce export <QQ号> --format html

# 发送（需白名单）
qce send <QQ号> "消息内容"

# 安全
qce safety status
qce safety allow <QQ号>
qce safety deny <QQ号>

# 监听
qce monitor start <QQ号> --auto-reply
```

### QZone 空间

```bash
# 登录
qce qzone login                     # 扫码（AI 提示人类操作）
qce qzone logout                    # 清除

# 信息
qce qzone me                        # 自己空间信息
qce qzone user <QQ号>              # 他人名片（昵称/备注/亲密度）

# 说说
qce qzone feeds [QQ号] [-n 20]     # 列表（不传默认自己）
qce qzone post "内容"               # 发布
qce qzone delete <tid>              # 删除

# 评论
qce qzone comments <tid> [QQ号]    # 查看评论+回复
qce qzone comment <QQ号> <tid> "内容"  # 发表评论

# 互动
qce qzone like <tid>                # 查点赞数
qce qzone board [QQ号] [-n 10]     # 留言板

# 社交
qce qzone friends                   # 好友列表
qce qzone visitors                  # 访客记录
qce qzone albums [QQ号]            # 相册列表
```

## A.4 脚本

### 通用脚本（根目录）

```bash
# 聊天记录完整导出（qce-bridge :3001，无 200 条限制）
npx tsx export-html.mjs <QQ号>           # HTML，图片 base64 内嵌
npx tsx export-full-history.mjs <QQ号>    # Markdown

# QZone 说说 HTML 导出（含评论，可选传 QQ 号）
npx tsx export-qzone-feeds.mjs [QQ号]

# QZone 登录
npx tsx qzone-login.mjs                   # 检查 cookie → 过期则扫码
```

### 隐私脚本（`private/`，读取 `config.json`）

```bash
# QZone 运维（一个脚本四种操作）
npx tsx private/qzone-ops.mjs feeds <名称>    # 查看全部说说
npx tsx private/qzone-ops.mjs check <名称>    # 逐条检查点赞
npx tsx private/qzone-ops.mjs like <名称>     # 检查 + 补赞
npx tsx private/qzone-ops.mjs export <名称>   # HTML 导出（含评论）

# 消息监听
npx tsx private/monitor-live.mjs              # 实时监听 + 人格回复
npx tsx private/monitor-notify.mjs            # 轻量监听 → pending-messages.json
```

`monitor-live.mjs` 依赖 `identity.md`（人格文档）和 `ANTHROPIC_API_KEY` 环境变量。

## A.5 典型工作流

### 导出聊天记录
```bash
npx tsx export-html.mjs <QQ号>
# → output/full-history-<QQ号>.html（含图片）
```

### 查看并导出某人 QZone
```bash
qce qzone user <QQ号>                              # 先看名片
qce qzone feeds <QQ号> -n 5                        # 看最近说说
npx tsx export-qzone-feeds.mjs <QQ号>              # 导出 HTML
```

### 批量补赞（使用隐私脚本）
```bash
npx tsx private/qzone-ops.mjs like <配置名>
```

## A.6 关键陷阱

| 陷阱 | 正确做法 |
|------|----------|
| **分页漏帖** | `pos += batch.length`，不能 `pos += 50` |
| **unikey 协议** | 必须 `http://` 不能 `https://`，否则点赞数据全 0 |
| **2017 老帖** | 点赞返回 `code:0` 但不生效，服务端限制 |
| **限流 -10000** | 批量请求间隔 200-300ms，触发后等 15-30 分钟 |
| **Cookie 过期** | QZone 操作前先 `npx tsx qzone-login.mjs` |

---

# Part B: 人类操作手册

> 以下步骤需要你手动完成，AI 无法代劳。

## B.1 环境搭建（新用户一次性）

### 1. 安装依赖

要求 Node.js 18+，已安装则跳过。

### 2. 克隆仓库

```bash
git clone https://github.com/zhuobichen/qchat-cli.git
cd qchat-cli
npm install && npm link
```

### 3. 部署 NapCatQQ

1. 下载 [NapCat.Shell](https://github.com/NapNeko/NapCatQQ/releases) 发行版
2. 解压到本地，如 `E:\CodeProject\NapCat.Shell\`
3. 将 `qce-bridge` 插件放入 `NapCat.Shell/plugins/qce-bridge/`

### 4. 创建隐私配置

```bash
cp private/config.example.json private/config.json
```

编辑 `private/config.json`：

```json
{
  "myQQ": 你的QQ号,
  "monitoredFriends": [需要监听的好友QQ号],
  "monitoredGroups": [需要监听的群号],
  "qzoneTargets": {
    "给好友起的名字": QQ号,
    "另一个好友": QQ号
  }
}
```

> ⚠️ `private/config.json` 已在 `.gitignore` 中排除，不会提交。

### 5. 配置 AI 人格（可选）

编辑根目录的 `identity.md`，定义自动回复风格。`monitor-live.mjs` 每次轮询重新读取，无需重启。

## B.2 每次使用

### 启动 NapCat（聊天功能需要）

```powershell
cd E:\CodeProject\NapCat.Shell
.\launcher-user.bat
# → 弹出 QQ 登录窗口 → 手机扫码
```

### 登录 QZone（空间功能需要）

```bash
cd E:\CodeProject\qchat-cli
npx tsx qzone-login.mjs
# → 弹出二维码 → 手机 QQ 扫码 → 确认登录
```

### 告诉 AI 做什么

全 CLI 化，直接用自然语言：

```
"导出 1234567890 的聊天记录为 HTML"
"查看郭楠的全部说说"
"给所有好友批量补赞"
"启动消息监听开始自动回复"
"切换 QZone 账号到另一个 QQ"
```

## B.3 文件与隐私

| 目录/文件 | 是否提交 | 说明 |
|-----------|----------|------|
| `private/config.example.json` | ✅ 提交 | 配置模板（无真实数据） |
| `private/config.json` | ❌ gitignore | 真实配置（含 QQ 号） |
| `private/*.mjs` | ✅ 提交 | 隐私脚本（无硬编码 QQ 号） |
| `.qzone-cookie` | ❌ gitignore | QZone 登录缓存 |
| `qzone-qrcode.png` | ❌ gitignore | 临时二维码 |
| `output/` | ❌ gitignore | 导出文件 |
| `src/` | ✅ 提交 | TypeScript 源码 |
| `identity.md` | ✅ 提交 | AI 人格模板 |

## B.4 项目结构速览

```
qchat-cli/
├── src/
│   ├── cli.ts                    # CLI 入口，注册所有子命令
│   ├── commands/                 # 子命令（login/list/export/send/monitor/qzone）
│   └── core/                     # 核心模块
│       ├── onebot-client.ts      # OneBot HTTP 客户端
│       ├── qzone-client.ts       # QZone Web API 客户端
│       ├── auth.ts               # 认证管理
│       ├── safety.ts             # 发送安全机制
│       ├── monitor.ts            # 监听器
│       └── exporter/             # 导出格式（json/txt/html/excel）
├── private/                      # 🔒 隐私操作（不提交 config.json）
│   ├── config.example.json       # 配置模板
│   ├── config.json               # 真实配置（gitignore）
│   ├── load-config.mjs           # 配置加载器
│   ├── qzone-ops.mjs             # QZone 运维（feeds/check/like/export）
│   ├── monitor-live.mjs          # 实时监听 + 人格回复
│   ├── monitor-notify.mjs        # 轻量监听 → pending-messages
│   └── README.md                 # 隐私目录说明
├── identity.md                   # AI 人格文档
├── *.mjs                         # 通用脚本（无隐私信息）
├── README.md                     # 项目 README
├── USAGE.md                      # 本文件
└── WORKFLOW-REPORT.md            # 全流程开发记录
```

## B.5 故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| `qce login --test` 失败 | NapCat 未启动 | 启动 NapCat Shell |
| `:3001/health` 无响应 | qce-bridge 未加载 | 重启 NapCat Shell |
| QZone "未登录" | Cookie 过期 | `npx tsx qzone-login.mjs` |
| 导出只有 200 条 | 走了 OneBot | 用 `export-html.mjs`（qce-bridge） |
| 点赞不生效 | 2017 年老帖 | 服务端限制，无法绕过 |
| 连续 -10000 | 请求过多限流 | 等 15-30 分钟 |
| `private/qzone-ops.mjs` 报错 | 未配 config.json | `cp config.example.json config.json` |
