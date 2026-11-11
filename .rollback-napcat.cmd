@echo off
REM Roll back napcat.mjs to the 4.18.1 build.
REM ASCII only: this path has CJK segments and cmd decodes with GBK.

setlocal

set "T=C:\Users\Administrator\.qchat-cli\NapCat.Shell\napcat\napcat.mjs"
set "B=C:\Users\Administrator\.qchat-cli\NapCat.Shell\napcat\napcat.mjs.bak-4.18.1"

if not exist "%B%" (
  echo [x] backup missing
  exit /b 1
)

copy /Y "%B%" "%T%" >nul
if errorlevel 1 (
  echo [x] copy failed
  exit /b 2
)

for %%A in ("%T%") do echo [ok] size=%%~zA
echo [ok] rolled back to 4.18.1
exit /b 0
