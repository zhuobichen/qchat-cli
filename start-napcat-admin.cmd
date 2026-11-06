@echo off
REM Start NapCat + QQ as administrator (zhaowen 2396130865, OneBot :3000)
REM Why admin: NapCat writes logs/qrcode/cache under %USERPROFILE%\.qchat-cli
REM A low-integrity process cannot write there and fails silently
REM (old QR code -> "scan expired").
cd /d "%~dp0"
if not exist "dist\cli.js" (
  echo [x] dist\cli.js missing - run: npm run build
  pause
  exit /b 1
)
echo Starting NapCat + QQ (zhaowen 2396130865) ...
echo Close all QQ.exe first if the QR code looks stale.
echo.
node "dist\cli.js" napcat start -q 2396130865
echo.
echo [done]
pause
