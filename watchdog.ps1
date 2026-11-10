# qq-watch 看门狗：常驻，发现监视器掉了就拉起（每 60 秒巡检一次）
$Root = 'D:\github_project\ZHAOWE~1\QCHAT-~1'
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
$logFile = Join-Path $Root 'output\watchdog.log'

function Write-Log($msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg
  Add-Content -Path $logFile -Value $line -Encoding utf8
}

Write-Log 'watchdog started'
while ($true) {
  $alive = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*qq-watch.mjs*' }
  if (-not $alive) {
    try {
      Start-Process -FilePath 'node' -ArgumentList 'private\qq-watch.mjs' -WorkingDirectory $Root -WindowStyle Hidden
      Write-Log 'watcher not running -> restarted'
      Start-Sleep -Seconds 5
    } catch {
      Write-Log ('restart failed: ' + $_.Exception.Message)
    }
  }
  Start-Sleep -Seconds 60
}