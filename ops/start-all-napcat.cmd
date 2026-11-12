@echo off
REM Start all three NapCat instances (OneBot ports 3000 / 3002 / 3003).
REM Each instance has its own NapCat.Shell directory under %USERPROFILE%\.qchat-cli.
REM If injection fails, close any QQ.exe that is already running first.
REM After starting, the CLI prints a QR code - scan it with the matching account.

setlocal
set HERE=%~dp0
set NC=%USERPROFILE%\.qchat-cli
cd /d "%HERE%"

if not exist "dist\cli.js" (
  echo [x] dist\cli.js missing, run: npm run build
  pause
  exit /b 1
)

echo === main (3318524732) :3000 ===
node "dist\cli.js" napcat start --path "%NC%\NapCat.Shell" -p 3000 -q 3318524732
echo.

echo === acc2 (1245581875) :3002 ===
node "dist\cli.js" --account acc2 napcat start --path "%NC%\NapCat.Shell-acc2" -p 3002 -q 1245581875
echo.

echo === acc3 (10001000) :3003 ===
node "dist\cli.js" --account acc3 napcat start --path "%NC%\NapCat.Shell-acc3" -p 3003 -q 10001000
echo.

echo [done] check with: node dist\cli.js account list
echo        or:         node dist\cli.js napcat status
pause
