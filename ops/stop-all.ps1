# Stop the whole QQ automation stack (resident nodes + NapCat + QQ) and write the pause marker.
#
# Why this script exists: `qce automation stop` runs inside the sandbox, cannot see host
# processes, reported "killed 0 processes" while killing nothing - yet it wrote the pause
# marker. Result: qq-health said "paused" while watchdog kept restarting NapCat and QR codes
# kept popping (2026-11-14). The real kill has to happen in the host context.
# This file previously had ` = Get-CimInstance ...` (variable name lost) on line 15, so it
# never parsed - i.e. it had never worked.
#
# NOTE: ASCII only on purpose. Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI and
# chokes on CJK comments.

$ErrorActionPreference = 'SilentlyContinue'

# Repo root = parent of this script's folder; avoids hardcoding a CJK path in the source.
$repo = Split-Path -Parent $PSScriptRoot
$killed = @()

$nodePats = @('qq-watch.mjs', 'qq-watchdog.mjs', 'qq-poke-watch.mjs', 'diary-scheduler.mjs',
              'qce-auto.mjs', 'napcat start', 'launch-napcat')

foreach ($p in Get-CimInstance Win32_Process -Filter "Name='node.exe'") {
  foreach ($pat in $nodePats) {
    if ($p.CommandLine -and $p.CommandLine -like "*$pat*") {
      Stop-Process -Id $p.ProcessId -Force
      $killed += ('node#' + $p.ProcessId + ':' + $pat)
      break
    }
  }
}

foreach ($c in Get-CimInstance Win32_Process -Filter "Name='cmd.exe'") {
  if ($c.CommandLine -match 'qq-watch|watchdog|poke-watch|launch-napcat|napcat start') {
    Stop-Process -Id $c.ProcessId -Force
    $killed += ('cmd#' + $c.ProcessId)
  }
}

foreach ($p in Get-Process NapCatWinBootMain -ErrorAction SilentlyContinue) {
  Stop-Process -Id $p.Id -Force
  $killed += ('NapCatWinBootMain#' + $p.Id)
}

# QQ revives itself a few times, so clear it in rounds.
for ($i = 0; $i -le 6; $i++) {
  $qq = @(Get-Process QQ -ErrorAction SilentlyContinue)
  if ($qq.Count -eq 0) { break }
  foreach ($p in $qq) {
    Stop-Process -Id $p.Id -Force
    $killed += ('QQ#' + $p.Id)
  }
  Start-Sleep -Seconds 2
}

# Pause marker: qq-health reads it and reports "paused" instead of down,
# so nothing auto-restarts while the human is away.
$mark = Join-Path $repo 'private\.automation-paused'
@{
  at     = (Get-Date -Format 'yyyy/MM/dd HH:mm:ss')
  reason = 'ops/stop-all.ps1 full stop'
  killed = $killed.Count
} | ConvertTo-Json | Set-Content -Path $mark -Encoding UTF8

Write-Output ('killed: ' + ($killed -join ', '))
Write-Output ('paused marker: ' + $mark)

$left = Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'qq-watch|watchdog|poke-watch|NapCatWinBoot|QQ\.exe' -and $_.Name -ne 'powershell.exe' }
if ($left) {
  Write-Output 'still alive:'
  $left | ForEach-Object { Write-Output ('  ' + $_.ProcessId + ' ' + $_.Name) }
} else {
  Write-Output 'all clear'
}
