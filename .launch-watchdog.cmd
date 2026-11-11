@echo off
set "PROJ=D:\GITHUB~1\ZHAOWE~1\QCHAT-~1"
cd /d "%PROJ%"
echo [%DATE% %TIME%] launch watchdog >> output\qq-watchdog.log
start "" /B cmd /c "node scripts\qq-watchdog.mjs >> output\qq-watchdog.log 2>&1"
echo [ok] watchdog launched
exit /b 0
