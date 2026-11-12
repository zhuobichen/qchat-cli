@echo off
REM ============================================================
REM 启动 NapCat + QQ（修正版）
REM
REM 修正了什么：
REM   旧版顺序是「先删二维码 → 再杀进程」，但 NapCat 正占用那个文件，
REM   删除会静默失败（del 失败不报错），随后才杀掉进程。
REM   新启动的 NapCat 读到的还是那张旧二维码 →「二维码已过期」。
REM   2026-11-08 这个问题连续踩了好几次。
REM
REM 正确顺序：杀进程 → 等文件句柄释放 → 删二维码 → 确认删掉 → 才启动。
REM 任何一步没成，直接中止并报错，不带病启动。
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "NCDIR=%USERPROFILE%\.qchat-cli\NapCat.Shell\napcat"
set "QR=%NCDIR%\cache\qrcode.png"

echo [1/4] 杀掉旧的 NapCat 和 QQ ...
taskkill /F /IM NapCatWinBootMain.exe >nul 2>&1
taskkill /F /IM QQ.exe >nul 2>&1

REM 等文件句柄释放；进程退出不等于句柄立刻释放
echo       等待句柄释放 ...
for /l %%i in (1,1,10) do (
  if exist "%QR%" (
    ping -n 2 127.0.0.1 >nul
  )
)

echo [2/4] 删除旧二维码 ...
if exist "%QR%" (
  del /f /q "%QR%" >nul 2>&1
)

echo [3/4] 确认二维码已清除 ...
if exist "%QR%" (
  echo       [x] 删除失败：%QR%
  echo           文件仍被占用，或权限不足。
  echo           这个脚本必须以管理员身份运行。
  echo.
  echo           手动处理办法：关掉所有 QQ 进程，再删这个文件：
  echo             %QR%
  echo.
  pause
  exit /b 1
)
echo       已清除，接下来生成的会是新码

echo [4/4] 启动 NapCat + QQ（账号 2396130865）...
echo.
node "dist\cli.js" napcat start -q 2396130865
set "RC=%ERRORLEVEL%"

echo.
echo 退出码 %RC%
echo   出二维码就用手机扫，约 2 分钟有效。
echo   看到「登录成功」就不用管了，这个窗口可以关掉。
echo.
pause
endlocal
