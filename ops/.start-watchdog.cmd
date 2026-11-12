@echo off
REM Started via host_exec. Pure ASCII, CRLF line endings.
REM Reason: cmd needs CRLF and chokes on parentheses in REM lines.
set "PROJ=D:\GITHUB~1\ZHAOWE~1\QCHAT-~1"
cd /d "%PROJ%"
set "TEMP=%PROJ%\.tmp-vitest"
set "TMP=%TEMP%"
start "qq-watchdog" /MIN cmd /c "node scripts\qq-watchdog.mjs >> output\wd.out 2>&1"
echo [ok] watchdog started
exit /b 0
