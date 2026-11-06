# 开机拉起全部服务（由计划任务在登录时调用，需管理员权限）
#
# 顺序很重要：NapCat 必须先在线，watcher / qce-auto 才有意义。
# 所以这里会等 NapCat 真正 online 再启动后面的。

param(
  [string]$Root = 'D:\github_project\ZhaoWen_GitHub维护\qchat-cli',
  [int]$WaitSeconds = 180
)

$ErrorActionPreference = 'Continue'
$log = Join-Path $Root 'output\boot.log'
function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m
  Write-Output $line
  try {
    New-Item -ItemType Directory -Force -Path (Join-Path $Root 'output') | Out-Null
    Add-Content -Path $log -Value $line -Encoding utf8
  } catch {}
}

Set-Location $Root
Log '=== boot-all 开始 ==='

# ---------- 1. 启动 NapCat + QQ ----------
$already = $false
try {
  $cfgPath = Join-Path $env:USERPROFILE '.qchat-cli\NapCat.Shell\napcat\config\onebot11_2396130865.json'
  $token = (Get-Content $cfgPath -Raw | ConvertFrom-Json).network.httpServers[0].token
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/get_status' -Method Post -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
  if ($r.data.online -eq $true) { $already = $true }
} catch { }

if ($already) {
  Log 'NapCat 已在线，跳过启动'
} else {
  Log '启动 NapCat + QQ（快速登录）…'
  # 先清掉可能残留的多实例（同账号多开会互相踢）
  Get-Process QQ -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  & node (Join-Path $Root 'dist\cli.js') napcat start -q 2396130865 2>&1 | Out-Null
}

# ---------- 2. 等 NapCat 真正 online ----------
Log "等待 NapCat 在线（最多 $WaitSeconds 秒）…"
$online = $false
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  try {
    $cfgPath = Join-Path $env:USERPROFILE '.qchat-cli\NapCat.Shell\napcat\config\onebot11_2396130865.json'
    $token = (Get-Content $cfgPath -Raw | ConvertFrom-Json).network.httpServers[0].token
    $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/get_status' -Method Post -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 5
    if ($r.data.online -eq $true) { $online = $true; break }
  } catch { }
  Start-Sleep -Seconds 5
}

if ($online) { Log 'NapCat 在线 ✅' } else { Log 'NapCat 未上线 ⚠（可能需要在 QQ 窗口扫码）' }

# ---------- 3. 启动 workers ----------
function Start-Worker($name, $script) {
  $existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*$name*" }
  if ($existing) { Log "$name 已在运行 pid=$($existing[0].ProcessId)，跳过"; return }

  Log "启动 $name …"
  Start-Process -FilePath 'node' -ArgumentList (Join-Path $Root $script) `
    -WorkingDirectory $Root -WindowStyle Hidden
}

Start-Worker 'qq-watch.mjs' 'private\qq-watch.mjs'
Start-Worker 'qce-auto.mjs' 'scripts\qce-auto.mjs'

Log '=== boot-all 完成 ==='
