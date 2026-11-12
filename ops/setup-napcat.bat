@echo off
echo ========================================
echo NapCatQQ 下载和配置脚本
echo ========================================
echo.

REM 创建目录
if not exist "napcat" mkdir napcat
cd napcat

echo [1/3] 正在下载 NapCatQQ v4.18.1...
echo.

REM 下载 Shell 版本（更轻量）
curl -L -o "NapCat.Shell.Windows.OneKey.zip" "https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.1/NapCat.Shell.Windows.OneKey.zip"

if %errorlevel% neq 0 (
    echo 下载失败！请手动下载：
    echo https://github.com/NapNeko/NapCatQQ/releases/latest
    pause
    exit /b 1
)

echo.
echo [2/3] 正在解压...
powershell -Command "Expand-Archive -Path 'NapCat.Shell.Windows.OneKey.zip' -DestinationPath '.' -Force"

echo.
echo [3/3] 正在配置 HTTP 服务...

REM 创建配置目录
if not exist "config" mkdir config

REM 写入 OneBot 配置
(
echo {
echo   "network": {
echo     "httpServers": [
echo       {
echo         "enable": true,
echo         "name": "HTTP-API",
echo         "host": "127.0.0.1",
echo         "port": 3000,
echo         "enableCors": true,
echo         "enableWebsocket": false,
echo         "messagePostFormat": "array",
echo         "token": "",
echo         "debug": false
echo       }
echo     ],
echo     "httpSseServers": [],
echo     "httpClients": [],
echo     "websocketServers": [],
echo     "websocketClients": [],
echo     "plugins": []
echo   },
echo   "enableLocalFile2Url": false,
echo   "parseMultMsg": false
echo }
) > config\onebot11_1.json

echo.
echo ========================================
echo 配置完成！
echo ========================================
echo.
echo 启动步骤：
echo   1. 进入 napcat 目录
echo   2. 运行 launcher-user.bat
echo   3. 用 QQ 扫码登录
echo   4. 然后运行：qce login --host 127.0.0.1 --port 3000
echo.
pause
