Write-Host 'stopping QQ bridge ...'
$bridges = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*qq-bridge.mjs*' }
if (-not $bridges) {
  Write-Host '  no bridge process running'
} else {
  foreach ($b in $bridges) {
    try { Stop-Process -Id $b.ProcessId -Force -ErrorAction Stop; Write-Host ("  killed bridge pid " + $b.ProcessId) } catch {
      Write-Host ("  failed to kill " + $b.ProcessId + ": " + $_.Exception.Message)
    }
  }
}

Write-Host 'stopping message watcher ...'
 = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -like '*qq-watch.mjs*' }
if (-not $watchers) { Write-Host '  no watcher running' } else { foreach ($w in $watchers) { try { Stop-Process -Id $w.ProcessId -Force -ErrorAction Stop; Write-Host ('  killed watcher pid ' + $w.ProcessId) } catch { Write-Host ('  failed to kill ' + $w.ProcessId) } } }

Write-Host 'stopping QQ / NapCat ...'
for ($round = 1; $round -le 8; $round++) {
  $qq = @(Get-Process QQ -ErrorAction SilentlyContinue)
  if ($qq.Count -eq 0) { break }
  foreach ($p in $qq) { try { $p.Kill() } catch {} }
  Start-Sleep -Seconds 2
}
$left = @(Get-Process QQ -ErrorAction SilentlyContinue).Count
Write-Host "  remaining QQ processes: $left"
if ($left -gt 0) { Write-Host '  tip: it auto-restarts a few times, run this again if needed.' }

