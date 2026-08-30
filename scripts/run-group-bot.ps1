param(
  [string]$GroupId = '1109256353',
  [string]$NodePath = ''
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$node = if ($NodePath) { $NodePath } else { (Get-Command node -ErrorAction Stop).Source }
$cli = Join-Path $projectRoot 'dist\cli.js'
$instanceLock = New-Object System.Threading.Mutex($false, "qchat-cli-group-bot-$GroupId")

if (!$instanceLock.WaitOne(0, $false)) {
  exit 0
}

Set-Location -LiteralPath $projectRoot

if (!(Test-Path -LiteralPath $node)) {
  throw 'Node.js executable was not found.'
}

if (!(Test-Path -LiteralPath $cli)) {
  throw 'Built CLI was not found. Run npm run build first.'
}

function Test-OneBotReady {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connection = $client.BeginConnect('127.0.0.1', 3000, $null, $null)
    if (!$connection.AsyncWaitHandle.WaitOne(1000, $false)) { return $false }
    $client.EndConnect($connection)
    return $true
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

try {
  while ($true) {
    try {
      if (!(Test-OneBotReady)) {
        Start-Sleep -Seconds 5
        continue
      }

      & $node $cli group-bot start $GroupId --auto-reply
    } catch {
      Write-Warning 'Group bot stopped; retrying in 5 seconds.'
    }

    Start-Sleep -Seconds 5
  }
} finally {
  $instanceLock.ReleaseMutex()
  $instanceLock.Dispose()
}
