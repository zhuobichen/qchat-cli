@echo off
setlocal
REM (comment stripped: non-ascii)
REM ASCII only: host_exec runs cmd with the GBK code page.
set "SHELL=C:\Users\Administrator\.qchat-cli\NapCat.Shell"
set "OLD=%SHELL%\napcat"
set "BAK=%SHELL%\napcat.bak-4181"
set "NEW=D:\GITHUB~1\ZHAOWE~1\QCHAT-~1\_napcat-v2"

echo [1/8] kill QQ
taskkill /F /IM NapCatWinBootMain.exe >nul 2>&1
taskkill /F /IM QQ.exe >nul 2>&1
ping -n 5 127.0.0.1 >nul

if not exist "%NEW%\napcat.mjs" (
  echo [x] source missing: %NEW%\napcat.mjs
  exit /b 1
)

echo [2/8] move old napcat aside
if exist "%BAK%" rmdir /s /q "%BAK%"
move "%OLD%" "%BAK%" >nul
if exist "%OLD%" (
  echo [x] move failed, old dir still there
  exit /b 1
)
if not exist "%BAK%\napcat.mjs" (
  echo [x] backup looks wrong, aborting
  exit /b 1
)

echo [3/8] copy new napcat
xcopy "%NEW%" "%OLD%\" /E /I /H /Y /Q >nul
if not exist "%OLD%\napcat.mjs" (
  echo [x] copy failed
  goto rollback
)

echo [4/8] restore account config
if exist "%BAK%\config" xcopy "%BAK%\config" "%OLD%\config\" /E /I /H /Y /Q >nul
if exist "%BAK%\plugins" xcopy "%BAK%\plugins" "%OLD%\plugins\" /E /I /H /Y /Q >nul
if exist "%BAK%\qqnt.json" copy /y "%BAK%\qqnt.json" "%OLD%\qqnt.json" >nul

echo [5/8] verify
for %%F in ("%OLD%\napcat.mjs") do echo     napcat.mjs = %%~zF bytes
if not exist "%OLD%\NapCatWinBootMain.exe" goto rollback
if not exist "%OLD%\config\onebot11_2396130865.json" (
  echo [x] onebot config lost
  goto rollback
)
echo [ok] swapped
exit /b 0

:rollback
echo [!!] rolling back
if exist "%OLD%" rmdir /s /q "%OLD%"
move "%BAK%" "%OLD%" >nul
echo [!!] rolled back to 4.18.1
exit /b 1
