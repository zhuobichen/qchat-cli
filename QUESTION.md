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

## Q12: GPT-SoVITS 本地合成一次要 19 秒（cuDNN autotune）

**现象**：本地语音克隆（`qce tts --provider local`）单次合成 19–45 秒，且**耗时随文本长度线性增长**；GPU 显存占着但利用率只有 3–20%。

**排查过程**（值得记下来，因为前三层全是假象）：

1. 先怀疑**中文路径导致 venv 失效** —— 确实有问题（见 Q13），但不是慢的原因
2. 再怀疑 **torchcodec DLL 加载失败** —— 确实有问题（见 Q14），也不是慢的原因
3. 逐段计时定位到 `vits.decode` 里的 `dec`（HiFi-GAN 解码器）占 **15 秒**
4. 关键实验：**同样的输入在同一进程里跑第二次只要 0.01 秒** → 锁定 cuDNN autotune

```
[PROBE] dec with RANDOM ge:      15.204s   ← 第一次
[PROBE] dec repeat:               0.010s   ← 第二次起
```

**原因**：`GPT_SoVITS/Accel/PyTorch/__init__.py` 硬编码了 `torch.backends.cudnn.benchmark = True`。

TTS 每次合成的文本长度都不同 → 卷积形状每次都变 → benchmark 模式**每次都要重新 autotune**，一次 15 秒。官方在别处写的 `cudnn.benchmark = False` 是**被注释掉的**。

**解决**：
```python
# GPT_SoVITS/Accel/PyTorch/__init__.py
torch.backends.cudnn.benchmark = False   # 原来是 True
```

**效果**：

| 文本 | 修复前 | 修复后 |
|---|---:|---:|
| 短句（2字） | 19s | **0.43s** |
| 正常句（25字） | 38s | **1.53s** |
| 长句（200字） | — | 10.3s |

**通用教训**：形状天然多变的任务（TTS / 变长文本 / 流式）不要开 `cudnn.benchmark`。autotune 假定形状稳定，形状一变就白费。

---

## Q13: venv 在中文路径下静默失效 → 加载 CPU 版 torch

**现象**：`venv\Scripts\python.exe` 里 `torch.cuda.is_available()` 返回 `True`，但服务实际跑的却是 CPU。

**验证方法**（关键）：看**运行中进程**的 `sys.executable` 和 `torch.__file__`，别只看交互式验证。
```bash
# 看起来对
./venv/Scripts/python.exe -c "import torch;print(torch.__version__)"
# 2.11.0+cu128 ✅

# 但 api_v2 子进程实际用的是 base python：
#   exe = C:\...\Python311\python.exe     ← 不是 venv
#   torch = 2.14.1+cpu                    ← 无 CUDA
```

**原因**：venv 在中文路径（`ZhaoWen_GitHub维护`）下，`pyvenv.cfg` 解析失败，回落到 base Python，于是加载了系统 site-packages 里的 CPU 版 torch。

**解决**：显式设 `PYTHONPATH` 指向 venv 的 site-packages。
```powershell
$env:PYTHONPATH = "D:\...\_tts\venv\Lib\site-packages"
```

**注意**：改英文路径**解决不了**——D 盘根目录和 `C:\Users\Administrator` 低权限进程写不了，可写路径必然在中文父目录下；且 Python 会把 8.3 短名（`ZHAOWE~1`）自动展开成长名。

---

## Q14: torchcodec 在中文路径下 DLL 加载失败

**现象**：
```
FileNotFoundError: Could not find module '...\torchcodec\libtorchcodec_core4.dll'
```

**原因**：torchaudio 2.9+ 的 `load()` 默认走 torchcodec；torchcodec 用 `os.path` 拼 DLL 路径，中文被错误解码成 `ZhaoWen_GitHubά��`，Windows 找不到文件。

**绕行方案**（二选一）：

1. **禁用 torchcodec，让 torchaudio 回退 soundfile**（本项目采用）
```bash
mv venv/Lib/site-packages/torchcodec venv/Lib/site-packages/torchcodec.disabled
```
然后给 `torchaudio/_torchcodec.py` 的 `load_with_torchcodec` 加 soundfile 回退。
**注意**：soundfile 返回 `(frames, channels)`，torchaudio 约定 `(channels, frames)`，必须转置，否则 `shape[-1]` 变成 1，触发 GPT-SoVITS 的「参考音频在 3~10 秒范围外」误报。

2. 把 venv 搬到纯 ASCII 路径（本机受权限限制做不到）

---

## Q15: 语音条发送失败「语音转换失败」

**现象**：`send_private_msg` 带 `{type:'record', data:{file:'file://...'}}` 报「语音转换失败，请检查语音文件是否正常」。

**三个坑**：

| 坑 | 现象 | 解法 |
|---|---|---|
| wav 不被接受 | 直接发 wav 失败 | 用 ffmpeg 转 **AMR**（`-c:a libopencore_amrnb -b:a 12.2k -ar 8000 -ac 1`） |
| `file://` 不被接受 | 文件存在但转换失败 | 改用 **`base64://`**（读文件后 base64） |
| 静态编译 ffmpeg 无 DLL | torchcodec 找不到依赖 | 用 shared 构建（BtbN `ffmpeg-master-latest-win64-gpl-shared`） |

**可用组合**：wav → ffmpeg → AMR → base64 → `{type:'record', data:{file:'base64://...'}}`

---

## Q16: 同一 QQ 号只能一端在线

**现象**：本地登录后，云端的 NapCat 掉线；云端重启，本地又被踢。

**原因**：QQ 协议限制，同一账号同时只能有一个客户端在线。

**处置**：确定单端策略（本项目改为**只在本地跑**），并停掉另一端：
```bash
sudo systemctl stop cloud-qq && sudo systemctl disable cloud-qq
sudo docker stop napcat
```

---

## Q17: NapCat 启动静默失败 + 弹出旧二维码

**现象**：启动后弹出二维码，扫码提示「已过期」；反复重试都一样。

**原因**（两层）：
1. 弹的是 `cache/qrcode.png` **历史缓存**（文件时间可能是几小时前）
2. **低完整性进程写不了** `C:\Users\Administrator\.qchat-cli\`，NapCat 启动要写日志/缓存 → 静默退出，根本没生成新码

**解决**：
- 用**管理员权限**运行 `start-napcat-admin.cmd`
- 启动前做写权限自检，不可写就明确提示（`qce napcat start` 已内置）
- `loadNapCat.js` 已存在且内容一致时不再重写（避免 EPERM 崩溃）

**排查要点**：不要只看它打印的「等待登录」，直接问接口：
```bash
curl -s -H "Authorization: Bearer <token>" -X POST http://127.0.0.1:3000/get_login_info
```

---

## Q18: `qce napcat start` 一直显示「等待账号登录」

**现象**：QQ 明明登上了（`get_login_info` 返回正常），CLI 却一直转圈。

**原因**：轮询 `get_login_info` 时**没带 Bearer token** → 接口 401 → 解析成 null → 永远等不到。

**解决**：启动前从 `config/onebot11_<uin>.json` 读 token 并带上。

**教训**：NapCat 的 OneBot HTTP 接口**全部需要 token**，漏了就静默失败。

---

## Q19: watcher 把历史消息当新消息（重启后刷屏）

**现象**：watcher 停过一段时间再启动，把几天前的消息逐条当「刚发生」推送。

**原因**：水位（`lastTime`）停摆，重启后所有比水位新的历史消息都算「新」。

**解决**：
- 新增 `maxAgeHours`（默认 6h）：超龄消息**只推进水位、不投递**
- 水位改为按「看到过的最新时间」推进，否则陈旧消息每轮重扫

**两个自己犯的错**（记下来避免再犯）：
1. 把 `cutoff` 算在过滤之后，导致内层循环用了未声明的变量 → `Cannot access 'fresh' before initialization`
2. 配置默认值插到了对象外面，运行时是 `undefined` → `cutoff` 算出 `NaN` → 所有消息都被判为陈旧 → **watcher 静默失效，却还在刷日志**

---

## Q20: 常驻进程「看起来在跑其实啥也没干」

三个真实案例，共同特征都是**不报错、日志还在滚**：

| 案例 | 表象 | 真因 |
|---|---|---|
| `qce-auto` 每轮只处理第一条 | 有日志、无报错 | debug 分支引用了已改名的 `message.time`（应为 `meta.time`），异常被外层 catch 吞掉 |
| `qce-auto` 一条消息都收不到 | 轮询计数在涨 | 好友列表取 `peerUin`，实际字段是 `user_id` |
| watcher 全部消息被跳过 | 日志显示「跳过 N 条」 | `maxAgeHours` 未生效 → `cutoff = NaN` |

**排查套路**：不要信日志里的「轮询成功」，要验**副作用**（消息条数、处理计数、DB/队列是否有变化）。

---

## Q21: Node 24 + undici 在 Windows 上退出触发 uv assertion

**现象**：脚本业务跑完，退出时崩：
```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

**原因**：`process.exit()` 与 undici 的 keep-alive socket 清理撞车。

**解决**：改成自然退出，别硬 `exit()`：
```js
process.exitCode = 0;
setTimeout(() => process.exit(0), 2000).unref();  // 兜底
```

---

## Q22: `cmd` 批处理中文路径乱码导致跑错目录

**现象**：双击 `.cmd` 报一串「'chat-cli' 不是内部或外部命令」，实际在 `C:\Windows\System32` 下执行。

**原因**：脚本存成了 **UTF-8**，`cmd` 按 GBK 解析 → `cd /d "%~dp0"` 里的中文路径被破坏 → `cd` 失败 → 留在 System32。

**解决**：批处理用**纯 ASCII + CRLF**（注释也别写中文）：
```python
open('x.cmd','w',encoding='ascii',newline='')
```

---

## Q23: pip 批量装依赖卡死（依赖求解）

**现象**：`pip install -r requirements.txt` 跑 20 分钟零进展，`tmp` 目录大小不变，进程 CPU 却一直涨。

**原因**：依赖解析器（resolver）在复杂约束下回溯，不是网络慢。

**解决**：**一个包一个包装**，隔离约束：
```powershell
foreach ($p in $pkgs) { & $py -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple $p }
```
实测 26 个包 3 分钟装完（批量装 21 分钟没动）。

**另一个坑**：`torchvision` 会把 torch 降级成 CPU 版，装完必须检查：
```bash
python -c "import torch;print(torch.__version__, torch.cuda.is_available())"
```

---

*持续更新中...*
