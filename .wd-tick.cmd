@echo off
REM Single watchdog tick, launched by Windows Task Scheduler every 5 minutes.
REM ASCII only + CRLF. Task Scheduler runs this outside any shell, so it does
REM not die when the agents shell exits.
set "PROJ=D:\GITHUB~1\ZHAOWE~1\QCHAT-~1"
cd /d "%PROJ%"
set "TEMP=%PROJ%\.tmp-vitest"
set "TMP=%TEMP%"
node scripts\qq-watchdog.mjs --once >> output\wd-task.out 2>&1
exit /b 0
