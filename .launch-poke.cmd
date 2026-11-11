@echo off
set "PROJ=D:\GITHUB~1\ZHAOWE~1\QCHAT-~1"
cd /d "%PROJ%"
echo [%DATE% %TIME%] launch poke-watch >> output\poke-watch.log
start "" /B cmd /c "node scripts\qq-poke-watch.mjs --pvp >> output\poke-watch.log 2>&1"
echo [ok] poke-watch launched
exit /b 0
