@echo off
title qchat-cli NapCat launcher
cd /d "%~dp0"
if not exist "dist\cli.js" (
  echo [x] dist\cli.js missing, run: npm run build
  pause
  exit /b 1
)
echo Starting NapCat + QQ ...
echo Close any running QQ first if injection fails.
echo.
node "dist\cli.js" napcat start
echo.
echo [done]
pause
