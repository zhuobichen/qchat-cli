@echo off
chcp 65001 >nul
title QQ assistant - stop
echo stopping QQ assistant (bridge + QQ + NapCat) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-all.ps1"
echo.
pause
