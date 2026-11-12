@echo off
chcp 65001 >nul
title QQ assistant - launcher (server mode)
setlocal
set "ROOT=%~dp0"
echo [1/2] checking server OneBot ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=@{Authorization='Bearer 75277e324f924d73255a5d0b77543e035af0e509bc7d7559'}; try { $r=Invoke-RestMethod 'https://43.133.171.234:8443/onebot/get_login_info' -Headers $h -TimeoutSec 10 -SkipCertificateCheck; Write-Host ('  server ok: ' + $r.data.nickname + ' (' + $r.data.user_id + ')') } catch { Write-Host '  [x] server unreachable'; exit 1 }"
if errorlevel 1 ( pause & exit /b 1 )
echo [2/2] starting message watcher ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%start-watch.ps1" -Root "%ROOT%"
echo.
echo READY - watcher log: output\qq-watch.log
timeout /t 5 >nul
exit /b 0
