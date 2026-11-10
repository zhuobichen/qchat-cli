@echo off
REM Launched via host_exec. ASCII-only on purpose:
REM the workspace path contains CJK characters and cmd under host_exec
REM decodes them with the GBK code page, so a literal CJK path fails.
REM Using the 8.3 short path keeps everything ASCII.
set "PROJ=D:\GITHUB~1\ZHAOWE~1\QCHAT-~1"
cd /d "%PROJ%"

taskkill /F /IM NapCatWinBootMain.exe >nul 2>&1
taskkill /F /IM QQ.exe >nul 2>&1
ping -n 4 127.0.0.1 >nul

set "QR=C:\Users\Administrator\.qchat-cli\NapCat.Shell\napcat\cache\qrcode.png"
if exist "%QR%" del /f /q "%QR%" >nul 2>&1
if exist "%QR%" (
  echo [x] QR still locked
  exit /b 1
)
echo [ok] clean

start "" /B cmd /c "node dist\cli.js napcat start -q 2396130865 > .napcat-start.log 2>&1"
echo [ok] launched
exit /b 0
