param([string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path))

$script = Join-Path $Root 'private\qq-bridge.mjs'
if (-not (Test-Path $script)) {
  Write-Host "[x] missing: $script"
  exit 1
}

$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*qq-bridge.mjs*' }

if ($existing) {
  Write-Host ("bridge already running, pid " + ($existing.ProcessId -join ','))
  exit 0
}

# 自签证书：允许子进程跳过 TLS 校验（仅连自己的服务器）
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
Start-Process -FilePath 'node' -ArgumentList 'private\qq-bridge.mjs' -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 3

$after = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*qq-bridge.mjs*' }

if ($after) {
  Write-Host ("bridge started, pid " + ($after.ProcessId -join ','))
  exit 0
}

Write-Host '[x] bridge failed to stay alive, check output\qq-bridge.log'
exit 1
