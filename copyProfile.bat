
@REM @echo off
@REM setlocal

@REM echo 🔒 Closing all Chrome instances...
@REM taskkill /F /IM chrome.exe >nul 2>&1

@REM echo 🗂️ Copying Chrome Profile 2 to temporary debug profile...
@REM rmdir /S /Q "C:\Temp\ChromeDebugProfile" >nul 2>&1
@REM xcopy /E /H /K /Y "C:\Users\user\AppData\Local\Google\Chrome\User Data\Profile 2" "C:\Temp\ChromeDebugProfile" >nul

@REM echo 🚀 Starting Chrome with remote debugging...
@REM start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" ^
@REM   --remote-debugging-port=9222 ^
@REM   --user-data-dir="C:\Temp\ChromeDebugProfile" ^
@REM   --profile-directory="Profile 2"

@REM echo ⏳ Waiting for Chrome to start...
@REM timeout /t 5 >nul

@REM echo 🌐 Fetching WebSocket Debugger URL...
@REM curl -s http://127.0.0.1:9222/json/version > ws_temp.json

@REM if not exist ws_temp.json (
@REM     echo ❌ Error: Failed to retrieve WebSocket Debugger URL. Chrome may not have started properly.
@REM     exit /b 1
@REM )

@REM for /f %%i in ('node lib/extractWsUrl.js') do set WSEndpoint=%%i

@REM del ws_temp.json

@REM if "%WSEndpoint%"=="" (
@REM     echo ❌ Error: Could not extract WebSocket Debugger URL.
@REM     exit /b 1
@REM )

@REM echo 🔌 WebSocket Debugger URL: %WSEndpoint%
@REM echo ▶️ Running Puppeteer script...

@REM node index.js "%WSEndpoint%"

@REM echo 🧹 Cleaning up temporary debug profile...
@REM rmdir /S /Q "C:\Temp\ChromeDebugProfile"

@REM echo ✅ Done.
@REM endlocal

