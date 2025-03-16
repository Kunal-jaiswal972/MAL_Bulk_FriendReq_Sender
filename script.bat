@echo off
echo Closing all Chrome instances...
taskkill /F /IM chrome.exe >nul 2>&1

echo Starting Chrome with remote debugging...
start "" chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\user\AppData\Local\Google\Chrome\User Data" --profile-directory="Profile 2"

echo Waiting for Chrome to start...
timeout /t 5 >nul

echo Fetching WebSocket Debugger URL...
curl -s http://127.0.0.1:9222/json/version > ws_temp.json

if not exist ws_temp.json (
    echo Error: Failed to retrieve WebSocket Debugger URL. Chrome may not have started properly.
    exit /b 1
)

for /f %%i in ('node lib/extractWsUrl.js') do set WSEndpoint=%%i

del ws_temp.json

if "%WSEndpoint%"=="" (
    echo Error: Could not extract WebSocket Debugger URL.
    exit /b 1
)

echo WebSocket Debugger URL: %WSEndpoint%

echo Running Puppeteer script...
node index.js "%WSEndpoint%"
