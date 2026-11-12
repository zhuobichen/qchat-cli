# 外层守卫：确保 tunnel.ps1（内层）一直在跑
# 判据：tunnel.status 心跳 + 进程存在性；异常则重启内层
$Root = 'D:\github_project\ZHAOWE~1\QCHAT-~1'
$StatusFile = Join-Path $Root 'output\tunnel.status'
$GuardLog = Join-Path $Root 'output\tunnel-guard.log'
$Inner = Join-Path $Root 'tunnel.ps1'

function Write-GLog([string]$m) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $m
  try { Add-Content -Path $GuardLog -Value $line -Encoding utf8 } catch {}
}

Write-GLog ('守卫启动 (pid ' + $PID + ')')

while ($true) {
  $running = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*tunnel.ps1*' -and $_.ProcessId -ne $PID })

  $stale = $true
  if (Test-Path $StatusFile) {
    try {
      $raw = Get-Content $StatusFile -Raw
      $parts = $raw.Trim() -split '\|'
      if ($parts.Count -ge 3) {
        $ts = [datetime]::ParseExact($parts[0], 'yyyy-MM-dd HH:mm:ss', $null)
        $stale = ((Get-Date) - $ts).TotalMinutes -gt 5
      }
    } catch { $stale = $true }
  }

  if ($running.Count -eq 0 -or $stale) {
    Write-GLog ('内层缺失或心跳过期(running=' + $running.Count + ', stale=' + $stale + ')，拉起')
    Start-Process -FilePath 'powershell.exe' `
      -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$Inner `
      -WindowStyle Hidden
    Start-Sleep -Seconds 20
  }

  Start-Sleep -Seconds 180
}