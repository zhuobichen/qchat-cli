# 踩坑记录

> 随开发和使用实时更新，避免重复踩坑。

---

## Q1: `qce` 命令找不到

**现象**：终端输入 `qce` 报 `command not found`

**原因**：`npm link` 后全局 bin 目录不在当前 shell 的 PATH 中（尤其在 Git Bash 下）

**解决**：用 `npx tsx src/cli.ts` 替代 `qce`

```bash
npx tsx src/cli.ts qzone me          # ← 等价于 qce qzone me
npx tsx src/cli.ts export ...        # ← 等价于 qce export ...
```

---

## Q2: `tsx -e` 内联脚本无输出

**现象**：`npx tsx -e "console.log('hello')"` 没有任何输出

**原因**：在 Git Bash 下 stdout 被管道吞掉

**解决**：写成 `.mjs` 临时文件再执行，或用 `Write` 工具创建后 `npx tsx xxx.mjs`

```bash
npx tsx temp.mjs                     # ✅ 有输出
npx tsx -e "console.log(1)"          # ❌ 无输出（Git Bash）
```

---

## Q3: 历史清洗后的占位符问题

**现象**：`qce qzone feeds TARGET_QQ_1` 返回 `NaN`

**原因**：`git filter-branch` 清洗历史时将真实 QQ 号全部替换为 `YOUR_QQ`、`TARGET_QQ_1` 等占位符，CLI 命令无法识别这些字符串

**解决**：使用 `private/qzone-ops.mjs` 脚本（自动从 `config.json` 读真实 QQ 号），或直接传数字 QQ 号

```bash
# ❌ 占位符不能用
npx tsx src/cli.ts qzone feeds TARGET_QQ_1

# ✅ 用隐私脚本
npx tsx private/qzone-ops.mjs feeds 郭楠

# ✅ 直接传数字
npx tsx src/cli.ts qzone feeds 1234567890
```

---

## Q4: `qce send` 子命令是 `send msg` 而非直接 `send`

**现象**：`qce send 1234567890 "消息"` 报 `unknown command`

**原因**：CLI 设计为 `program.command('send')` → `send.command('msg')` 二级结构

**解决**：
```bash
qce send msg <QQ号> "消息内容"
```

---

## Q5: `qce send msg` 需要交互确认，无法在自动化中使用

**现象**：`qce send msg` 弹出 inquirer 交互提示 "确认发送消息？(y/N)"，无法自动回复

**原因**：安全机制中 `requireConfirmation` 默认为 `true`，且 inquirer 在非 TTY 环境下崩溃

**解决**（二选一）：
```bash
# 方案1：关掉确认
qce safety confirm false

# 方案2：绕过 CLI，直接用 OneBot API
```
```javascript
await fetch('http://127.0.0.1:3000/send_private_msg', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    user_id: 1234567890,
    message: [{type: 'text', data: {text: '消息内容'}}]
  })
});
```

---

## Q6: curl 直接发 JSON 中文乱码

**现象**：`curl -d '{"text":"中文"}'` 发送后对方收到乱码

**原因**：Git Bash 下 curl 对 Unicode 处理有问题，JSON 中的中文被错误编码

**解决**：用 `npx tsx` 执行 Node.js 脚本发请求，不要用 curl 传中文

```javascript
// ✅ 中文正常
const r = await fetch('http://127.0.0.1:3000/send_private_msg', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    user_id: 1234567890,
    message: [{type: 'text', data: {text: '中文消息'}}]
  })
});
```

---

## Q7: 发消息前需要启用安全机制 + 加白名单

**现象**：`qce send msg` 报 "会话未授权发送消息"

**原因**：发送功能默认禁用，且目标必须在白名单中

**解决**：
```bash
qce safety enable                    # 启用发送功能
qce safety allow <QQ号>              # 添加白名单
qce safety confirm false             # 可选：关闭交互确认
```

---

## Q8: `private/qzone-ops.mjs` 与 CLI 命令的 QQ 号来源不同

**现象**：CLI 命令需要传数字 QQ 号，隐私脚本用配置名

**原因**：设计如此 — 根目录脚本和 CLI 是通用工具（接受任意 QQ 号），`private/` 内的脚本是个人配置驱动（保护隐私）

| 使用方式 | QQ 号来源 |
|----------|-----------|
| `qce qzone feeds 1234567890` | 命令行直接传数字 |
| `npx tsx private/qzone-ops.mjs feeds 郭楠` | 从 `private/config.json` 读取 |
| `npx tsx export-html.mjs 1234567890` | 命令行直接传数字 |

---

## Q9: QZone Cookie 有效期短

**现象**：上次还能用的 QZone 功能突然报 "Session expired"

**原因**：`.qzone-cookie` 中的 `p_skey` 几小时就过期

**解决**：
```bash
npx tsx qzone-login.mjs              # 自动检测过期 → 重新扫码
```

---

## Q10: `qce send msg` 需要交互确认，自动化受阻

> 已合并到 Q5

---

## Q11: 自动回复双模式

**背景**：`monitor-live.mjs` 有两种回复方式：

| 模式 | 条件 | 机制 |
|------|------|------|
| 云端 API | 设置 `ANTHROPIC_API_KEY` | 直接调 Claude API，立即回复 |
| 本地管道 | 未设 `ANTHROPIC_API_KEY` | 写入 `pending-messages.json`，由 Claude Code 读取并生成回复 |

**本地管道工作流**：
```
monitor-live.mjs → 检测新消息 → pending-messages.json
                                        ↓
                              Claude Code 定时检查
                                        ↓
                     读取 identity.md → 生成回复 → 发送
```

**注意**：本地管道模式需要额外的 cron/定时脚本消费 `pending-messages.json`，否则消息只写入不处理。

---

*持续更新中...*
