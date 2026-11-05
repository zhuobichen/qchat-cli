# 本地 NapCat 启动失败排查记录（2026-11-05）

> 给接手排查的会话：这份文档只记录**观测到的事实**与已排除的可能，不含未经验证的结论。
> 所有命令、路径、日志片段都来自实机。

## 一句话

本机曾成功运行 NapCat（2026-11-02），今天（11-05）再次用同样命令启动时，QQ 弹出「文件已损坏，请重新安装 QQ」，NapCat 后端没有真正加载。

## 环境

| 项 | 值 |
|---|---|
| OS | Windows（Administrator 账户，管理员组） |
| QQ | 9.9.33-52230，安装在 `C:\QQ`（`C:\QQ\QQ.exe`） |
| NapCat | `%USERPROFILE%\.qchat-cli\NapCat.Shell\napcat`（含 `napcat.mjs`、`node.exe`、`NapCatWinBootHook.dll`） |
| 配置 | `config\onebot11_20002000.json`：HTTP `127.0.0.1:3000`，token 已配，`enable:true` |
| qchat-cli 配置 | `%APPDATA%\qchat-cli-nodejs\Config\config.json` → host 127.0.0.1:3000，`allowSending:true`，白名单 `[123456789]` |

## 现象

### 启动命令（与 11-02 成功时一致）

```powershell
cd "$env:USERPROFILE\.qchat-cli\NapCat.Shell\napcat"
.\NapCatWinBootMain.exe "C:\QQ\QQ.exe" "$env:USERPROFILE\.qchat-cli\NapCat.Shell\napcat\NapCatWinBootHook.dll"
```

### 成功时（`napcat-run.log`，11-02 19:05）

```
argv[1]:C:\QQ\QQ.exe
argv[2]:...\NapCatWinBootHook.dll
Boot Command:"C:\QQ\QQ.exe" --enable-logging
[NapCat Backend] Main Process ID:35320
Creating pipe: \\.\pipe\NapCat_35320
[NapCat Backend] Process resumed
config_current_version:9.9.33-52230
load from:C:\QQ\versions\9.9.33-52230\QQNT.dll
NapCat Shell App Loading...
11-02 19:05:34 [info] [QQ版本兼容性检测] 当前版本Appid未内置 通过Major获取
```

### 现在

```
argv[0..2] 同上
Boot Command:"C:\QQ\QQ.exe" --enable-logging
[NapCat Backend] Main Process ID:51448
Creating pipe: \\.\pipe\NapCat_51448
[NapCat Backend] Process resumed
（到此为止，没有 config_current_version，没有 NapCat Shell App Loading）
```

并且：
- QQ 弹出「**文件已损坏，请重新安装 QQ**」
- `napcat\logs\` 没有新文件（说明 NapCat 的 node 侧根本没起来）
- `napcat\cache\qrcode.png` 停留在 11-02 19:05，没有更新
- 端口 3000 不监听
- QQ 进程变成 **22MB × N 个且无法杀死**（`taskkill /F`、`Stop-Process -Force`、`NtResumeProcess` 后仍不可杀），重启后消失

## 已排除

| 假设 | 证据 |
|---|---|
| QQ 安装文件被改坏 | `QQ.exe` 1,717,800B / 10-25 21:10，`versions\9.9.33-52230\QQNT.dll` 214,599,728B / 10-25 21:10，与早先复制出的副本完全一致；文件总数 1877 |
| QQ 版本不兼容 | 当前版本与 11-02 成功日志里的 `config_current_version:9.9.33-52230` 相同 |
| OneBot 配置没开 | `onebot11_20002000.json` 里 `enable:true`、httpServers 指向 3000、token 正确 |
| 路径含中文导致解析失败 | 已改用 8.3 短名 `D:\github_project\ZHAOWE~1\...` 与 `%USERPROFILE%` 原生路径都试过，结果相同 |

## 仍然可疑（未验证）

1. **管理员 PowerShell 启动**：最后一次复现是在「管理员: Windows PowerShell」里执行的。QQ NT 对提权启动较敏感，可能触发完整性告警。11-02 那次是否在非管理员窗口执行，未确认。
2. **hook DLL 与 QQ 构建不匹配**：NapCat 版本较旧（本机 `NapCat.Shell.Windows.OneKey.zip` 日期 2026-01-13），11-02 日志里就有「当前版本 Appid 未内置 通过 Major 获取，为了更好的性能请尝试更新 NapCat」的提示。
3. **残留状态**：本次排查期间曾多次强杀 QQ、并用便携副本（`D:\...\_napcat`，1.19GB 复制）启动过，可能留下锁或 profile 状态。**重启后是否仍复现，尚未验证**——这是最重要的一个未知数。
4. **低完整性令牌写入受限**：排查方的 shell 进程处于 `Mandatory Label\Low`，对 `%USERPROFILE%`、`%TEMP%`、`C:\` 全部 `Access denied`，只能写工作区。因此 NapCat 需要写 `loadNapCat.js` / `cache` 时必然失败。这是排查方环境的限制，**不代表用户本机有同样问题**。

## 建议的下一步（按优先级）

1. **重启后，在普通（非管理员）PowerShell 里重跑一次上面的命令**，先确认「文件已损坏」是否还复现。
2. 若仍复现：查看 `napcat\logs\` 是否产生文件；若没有，说明 `NapCatWinBootHook.dll` 没被 QQ 加载，考虑换匹配版本的 NapCat。
3. 下载最新 NapCat 时注意：`github.com` 的 release 直链在本机下载会 SSL 失败（`api.github.com` 可通），需要走代理或镜像。
4. 若本地始终不通：改用云服务器上的 NapCat（`/home/mapmate/napcat`），打开
   `config/onebot11_20002000.json` 的 `network.httpServers`，本地用 SSH 隧道
   `ssh -N -L 3000:127.0.0.1:3000 <host>`，qchat-cli 配置不用改。

## 集成测试脚本（已写好，未跑通）

`scripts/integration-onebot.ts` —— 需要 OneBot 可达才会执行，否则直接 `跳过` 并退出码 2。

```bash
QCE_IT_ALLOW=1 QCE_IT_TARGET=<QQ号或群号> npx tsx scripts/integration-onebot.ts
```

断言四条：

1. 未授权 QQ 号 → 被拒（`未获发送授权`）
2. `safety disable` 后 → 连白名单目标也被拒
3. 授权目标 → 真发一条 `[qce-it xxxxxxxx]` 标记消息
4. **回读确认** 标记出现在该会话历史里（不只信 CLI 的「已发送」）

> 注意：第 3 步会真实发消息，务必用测试号/文件传输助手。

## 本次排查留下的东西

- 已清理：`D:\...\ZHAOWE~1\_napcat`、`_nc`（临时复制，共约 1.5GB）
- 未改动：`%USERPROFILE%\.qchat-cli\NapCat.Shell`（只读过）、`C:\QQ`（只读过）
- 本仓库新增：`scripts/integration-onebot.ts`、`src/core/safety.test.ts`、`.github/workflows/ci.yml`
