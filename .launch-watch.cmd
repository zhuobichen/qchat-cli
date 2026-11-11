@echo off
set "PROJ=D:\GITHUB~1\ZHAOWE~1\QCHAT-~1"
cd /d "%PROJ%"
set "QCE_WATCH_STATE=private\qq-watch-v2.state.json"
set "QCE_WATCH_LOG=output\qq-watch-v2.log"
echo [%DATE% %TIME%] launch qq-watch >> output\qq-watch-v2.log
start "" /B cmd /c "node private\qq-watch.mjs >> output\qq-watch-v2.log 2>&1"
echo [ok] watch launched
exit /b 0
