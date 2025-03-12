@echo off
echo Closing all Chrome instances...
taskkill /F /IM chrome.exe >nul 2>&1

echo Starting Chrome with remote debugging...
cd /d "C:\Program Files\Google\Chrome\Application"

start chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\user\AppData\Local\Google\Chrome\User Data" --profile-directory="Profile 2"

echo Waiting for Chrome to start...
timeout /t 5 >nul

@echo off
echo Fetching WebSocket Debugger URL...
curl -s http://127.0.0.1:9222/json/version > ws_temp.json

for /f %%i in ('node lib/extractWsUrl.js') do set WSEndpoint=%%i

del ws_temp.json

if "%WSEndpoint%"=="" (
    echo Failed to retrieve WebSocket Debugger URL.
    exit /b 1
)

echo WebSocket Debugger URL: %WSEndpoint%

echo Running Puppeteer script...
node index.js "%WSEndpoint%"



