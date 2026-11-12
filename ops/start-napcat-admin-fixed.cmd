@echo off
REM ============================================================
REM 启动 NapCat + QQ（管理员 + 正确顺序）
REM
REM 为什么两个都要：
REM   「管理员权限」和「操作顺序」是两个独立的坑，各自都会导致同一个症状
REM   ——扫的是过期二维码 / 二维码根本不出来。
REM
REM   坑 1（顺序）旧版先 del qrcode.png 再 taskkill，但 NapCat 正占着那个文件，
REM        del 会静默失败（不报错），随后才杀进程 → 新进程读到的还是旧码。
REM   坑 2（权限）NapCat 要往 %USERPROFILE%\.qchat-cli 写日志和二维码缓存。
REM        普通权限写不进去，日志里只有一行 warn，表现同样是"二维码是旧的"。
REM        实测：没提权时 90 秒都不生成新码，QQ.exe 也起不来。
REM
REM 正确顺序：提权 → 杀进程 → 等句柄释放 → 删二维码 → 确认删掉 → 启动。
REM 任何一步没成直接中止，不带病启动。
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ── 0) 自己提权 ──────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
  echo 需要管理员权限，正在请求提权 ...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "NCDIR=%USERPROFILE%\.qchat-cli\NapCat.Shell\napcat"
set "QR=%NCDIR%\cache\qrcode.png"

echo [1/5] 杀掉旧的 QQ 和 NapCat ...
REM QQ 也要杀：NapCat 挂在 QQ 里面。旧 QQ 不退，新 NapCat 就抢不到 :3000，
REM 表现是登进去了但 get_status.online 永远是 false。
taskkill /F /IM NapCatWinBootMain.exe >nul 2>&1
taskkill /F /IM QQ.exe >nul 2>&1

echo       等待句柄释放 ...
for /l %%i in (1,1,12) do (
  ping -n 2 127.0.0.1 >nul
)

echo [2/5] 删除旧二维码 ...
if exist "%QR%" del /f /q "%QR%" >nul 2>&1

echo [3/5] 确认已清除 ...
if exist "%QR%" (
  echo       [x] 删除失败：%QR%
  echo           文件仍被占用。请手动关掉所有 QQ 进程后重试。
  pause
  exit /b 1
)
echo       已清除

echo [4/5] 确认有写入权限 ...
echo test > "%NCDIR%\cache\.wtest" 2>nul
if not exist "%NCDIR%\cache\.wtest" (
  echo       [x] 无法写入 %NCDIR%\cache
  echo           NapCat 会静默失败，出不来新二维码。
  pause
  exit /b 1
)
del /f /q "%NCDIR%\cache\.wtest" >nul 2>&1
echo       权限正常

echo [5/5] 启动 NapCat + QQ（账号 2396130865）...
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
