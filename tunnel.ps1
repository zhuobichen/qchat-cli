# QQ 助手隧道守护进程
# 职责：维持「本机 DSH(:3080) → 服务器 127.0.0.1:13080」的反向隧道
# 特性：单实例锁 / 指数退避重连 / 心跳状态 / 日志轮转 / 本地 DSH 未起时不空转

$ErrorActionPreference = 'Continue'
$Root = 'D:\github_project\ZHAOWE~1\QCHAT-~1'
$Key = Join-Path $Root '_seed\id_cloud'
$LogFile = Join-Path $Root 'output\tunnel.log'
$StatusFile = Join-Path $Root 'output\tunnel.status'
$LockFile = Join-Path $Root 'output\tunnel.lock'
$Ssh = 'C:\Windows\System32\OpenSSH\ssh.exe'
$Remote = 'mapmate@43.133.171.234'

function Write-Log([string]$msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 2MB)) {
      Move-Item $LogFile ($LogFile + '.1') -Force -ErrorAction SilentlyContinue
    }
    Add-Content -Path $LogFile -Value $line -Encoding utf8
  } catch {}
}

function Write-Status([string]$state, [int]$pidValue) {
  try {
    ('{0}|{1}|{2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $state, $pidValue) |
      Set-Content -Path $StatusFile -Encoding utf8
  } catch {}
}

# ── 单实例锁 ────────────────────────────────────────────────
try {
  if (Test-Path $LockFile) {
    $old = (Get-Content $LockFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($old -and (Get-Process -Id $old -ErrorAction SilentlyContinue)) {
      Write-Log ("已有实例在运行 (pid " + $old + ")，本实例退出")
      exit 0
    }
  }
  Set-Content -Path $LockFile -Value $PID -Encoding utf8
} catch {}

Write-Log ('隧道守护启动 (pid ' + $PID + ')')
Write-Status 'starting' $PID

$backoff = 5
while ($true) {
  if (-not (Test-Path $Key)) { Write-Log '缺少私钥，退出'; break }

  # 本地 DSH 没起时不要空跑
  $localUp = $false
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $task = $tcp.ConnectAsync('127.0.0.1', 3080)
    $localUp = $task.Wait(2000) -and $tcp.Connected
    $tcp.Close()
  } catch { $localUp = $false }

  if (-not $localUp) {
    Write-Status 'waiting-local-dsh' $PID
    Start-Sleep -Seconds 15
    continue
  }

  Write-Status 'connecting' $PID
  $started = Get-Date
  & $Ssh -i $Key -N -R 127.0.0.1:13080:127.0.0.1:3080 `
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 `
      -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=no `
      -o BatchMode=yes $Remote 2>> $LogFile

  $code = $LASTEXITCODE
  $aliveFor = ((Get-Date) - $started).TotalSeconds
  Write-Log ('隧道断开 code=' + $code + ' 持续 ' + [int]$aliveFor + 's，' + $backoff + 's 后重连')

  if ($aliveFor -gt 120) { $backoff = 5 }
  Start-Sleep -Seconds $backoff
  $backoff = [Math]::Min($backoff * 2, 60)
}

Write-Status 'stopped' $PID
Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
