@echo off
REM Start NapCat + QQ as administrator (zhaowen 2396130865, OneBot :3000)
REM
REM Why admin: NapCat writes logs/qrcode/cache under %USERPROFILE%\.qchat-cli
REM A low-integrity process cannot write there and fails silently
REM (old QR code -> "scan expired").
REM
REM Why delete qrcode.png first: NapCat reuses an existing cache file, so a
REM leftover QR from a previous session gets shown again even though it has
REM long expired. Deleting it forces a fresh one to be generated.
setlocal
cd /d "%~dp0"
if not exist "dist\cli.js" (
  echo [x] dist\cli.js missing - run: npm run build
  pause
  exit /b 1
)

set "NCDIR=%USERPROFILE%\.qchat-cli\NapCat.Shell\napcat"

echo [1/3] Clearing stale QR code and old NapCat processes ...
if exist "%NCDIR%\cache\qrcode.png" del /f /q "%NCDIR%\cache\qrcode.png"
taskkill /F /IM NapCatWinBootMain.exe >nul 2>&1
echo       done

echo [2/3] Starting NapCat + QQ (zhaowen 2396130865) ...
echo       QR code expires in about 2 minutes - scan it as soon as it appears.
echo.
node "dist\cli.js" napcat start -q 2396130865
set "RC=%ERRORLEVEL%"

echo.
echo [3/3] Result: exit code %RC%
echo.
echo   If a QR code appeared, scan it now with your phone QQ.
echo   If it says logged in, you are done - this window can be closed.
echo   Check status any time with:  node dist\cli.js napcat status
echo.
pause
endlocal
