param(
  [string]$Token = '',
  [int]$TimeoutSec = 240
)

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  try {
    $headers = @{}
    if ($Token -ne '') { $headers['Authorization'] = "Bearer $Token" }
    $r = Invoke-RestMethod 'http://127.0.0.1:3000/get_login_info' -Headers $headers -TimeoutSec 2
    if ($r.status -eq 'ok' -and $r.data) {
      Write-Host ("  login ok: " + $r.data.nickname + " (" + $r.data.user_id + ")")
      exit 0
    }
  } catch { }
  Start-Sleep -Seconds 2
}
Write-Host '  timeout: OneBot :3000 not ready'
exit 1
