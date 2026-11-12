# ops/ —— 运维脚本（不是日常命令）

这里放的是**一次性或历史遗留**的启动/排查脚本。日常请用 `qce <子命令>`，
不要从这里找入口。

## 常用（还活着的）

| 脚本 | 干什么 | 什么时候用 |
|---|---|---|
| `start-napcat-admin-fixed.cmd` | 管理员权限起 NapCat + QQ | `qce napcat start` 起不来时 |
| `start-napcat-fixed.cmd` | 普通权限起 NapCat | 同上，不需要管理员时 |
| `stop-all.bat` | 停掉 QQ / NapCat / 相关进程 | 要彻底重来之前 |
| `open-qr.bat` | 打开二维码图片 | 扫码窗口没弹出来时 |

## 根目录那几个 `.launch-*.cmd`

`ops/` 之外，仓库根目录还有四个 dotfile 启动器，它们是**被文档和脚本直接引用的固定入口**，
所以留在根目录没动：

```
.launch-napcat.cmd      起 NapCat + QQ（看门狗和提醒里都直接调它）
.launch-watch.cmd       起 qq-watch（新消息投递）
.launch-poke.cmd        起 qq-poke-watch（收戳 + 还手）
.launch-watchdog.cmd    起 qq-watchdog（体检 / 熔断 / 推码）
```

四个都是 ASCII-only + CRLF，内部用 8.3 短路径 `D:\GITHUB~1\...`：
`host_exec` 走 cmd 时是 GBK 代码页，中文字面路径会被解错，短路径不会。

## 历史遗留（大概率用不到）

`start-all.bat` / `start-bridge.*` / `tunnel*.ps1` / `watchdog.ps1` / `wait-onebot.ps1` /
`setup-napcat.bat` / `setup-autostart.ps1` / `start-watch.ps1` —— 早期远程部署和自启方案，
现在统一走 `.launch-*.cmd` + `host_exec`，留着只是图个可查。

## 和 archive/ 的分工

- `ops/`：**可能还要用**的脚本，进 git
- `archive/`：老二维码截图、老日志、一次性探针，**不进 git**（已在 `.gitignore`）
