# 一键安装：开机自启 + 掉线自愈
#
# ⚠ 必须【以管理员身份】运行本脚本（右键 → 以管理员身份运行 PowerShell，再执行）：
#     powershell -ExecutionPolicy Bypass -File .\setup-autostart.ps1
#
# 注册两个计划任务：
#   1. qce-boot     —— 登录时拉起 NapCat + qq-watch + qce-auto
#   2. qce-watchdog —— 每 5 分钟检查 NapCat 是否掉线，掉线自动重启
#
# 卸载：powershell -ExecutionPolicy Bypass -File .\setup-autostart.ps1 -Uninstall

param(
  [switch]$Uninstall,
  [string]$Root = 'D:\github_project\ZhaoWen_GitHub维护\qchat-cli'
)

$ErrorActionPreference = 'Stop'

# ---------- 权限自检 ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host ''
  Write-Host '  [x] 需要管理员权限' -ForegroundColor Red
  Write-Host '      右键「开始菜单 → PowerShell」→ 以管理员身份运行，然后：' -ForegroundColor Yellow
  Write-Host "      cd `"$Root`"" -ForegroundColor Gray
  Write-Host '      powershell -ExecutionPolicy Bypass -File .\setup-autostart.ps1' -ForegroundColor Gray
  Write-Host ''
  exit 1
}

$bootTask = 'qce-boot'
$watchTask = 'qce-watchdog'

# ---------- 卸载 ----------
if ($Uninstall) {
  foreach ($t in @($bootTask, $watchTask)) {
    $exists = schtasks /query /tn $t 2>$null
    if ($exists) { schtasks /delete /tn $t /f | Out-Null; Write-Host "已删除任务 $t" -ForegroundColor Green }
    else { Write-Host "任务 $t 不存在" -ForegroundColor Gray }
  }
  Write-Host ''
  Write-Host '提醒：之前由 boot 任务拉起的 node 进程不会自动退出。' -ForegroundColor Yellow
  Write-Host '      要一并停掉：Get-CimInstance Win32_Process -Filter "Name=''node.exe''" | Where-Object { $_.CommandLine -match ''qq-watch|qce-auto'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }' -ForegroundColor Gray
  exit 0
}

# ---------- 前置检查 ----------
$bootScript = Join-Path $Root 'scripts\boot-all.ps1'
$watchScript = Join-Path $Root 'scripts\watchdog.mjs'
$cli = Join-Path $Root 'dist\cli.js'

foreach ($f in @($bootScript, $watchScript, $cli)) {
  if (-not (Test-Path $f)) {
    Write-Host "  [x] 缺少文件: $f" -ForegroundColor Red
    if ($f -eq $cli) { Write-Host '      先跑：npm run build' -ForegroundColor Yellow }
    exit 1
  }
}

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
  Write-Host '  [x] PATH 里找不到 node' -ForegroundColor Red
  exit 1
}
Write-Host "node: $nodePath" -ForegroundColor Gray

# ---------- 注册：开机启动 ----------
Write-Host ''
Write-Host '注册 qce-boot（登录时拉起全部服务）…' -ForegroundColor Cyan
$bootCmd = "pwsh -NoProfile -ExecutionPolicy Bypass -File `"$bootScript`" -Root `"$Root`""
schtasks /create /tn $bootTask /tr "$bootCmd" /sc onlogon /rl highest /f | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host '  [x] qce-boot 注册失败' -ForegroundColor Red; exit 1 }
Write-Host '  ✅ qce-boot' -ForegroundColor Green

# ---------- 注册：看门狗（每 5 分钟） ----------
Write-Host '注册 qce-watchdog（每 5 分钟检查掉线）…' -ForegroundColor Cyan
$watchCmd = "`"$nodePath`" `"$watchScript`""
schtasks /create /tn $watchTask /tr "$watchCmd" /sc minute /mo 5 /rl highest /f | Out-Null
if ($LASTEXITCODE -ne 0) { Write-Host '  [x] qce-watchdog 注册失败' -ForegroundColor Red; exit 1 }
Write-Host '  ✅ qce-watchdog' -ForegroundColor Green

# ---------- 完成 ----------
Write-Host ''
Write-Host '══════════════════════════════════════' -ForegroundColor Green
Write-Host ' 安装完成' -ForegroundColor Green
Write-Host '══════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host '现在就能试跑一次（不用等重启）：' -ForegroundColor Yellow
Write-Host "  pwsh -File `"$bootScript`"" -ForegroundColor Gray
Write-Host ''
Write-Host '查看状态：' -ForegroundColor Yellow
Write-Host "  node `"$watchScript`" --status" -ForegroundColor Gray
Write-Host '  日志: output\boot.log / output\watchdog.log' -ForegroundColor Gray
Write-Host ''
Write-Host '卸装：' -ForegroundColor Yellow
Write-Host '  powershell -ExecutionPolicy Bypass -File .\setup-autostart.ps1 -Uninstall' -ForegroundColor Gray
Write-Host ''
Write-Host '⚠ 注意：QQ 若掉线且无有效会话，仍需人工扫码。看门狗会写' -ForegroundColor Yellow
Write-Host "   output\NAPCAT-OFFLINE-ALERT.txt 提醒你。" -ForegroundColor Gray
