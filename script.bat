@echo off
setlocal enabledelayedexpansion

echo Locating Chrome executable...
set "CHROME="
for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
  if exist "%%~P" set "CHROME=%%~P"
)
if "%CHROME%"=="" (
  echo Error: Could not find chrome.exe. Open script.bat and set CHROME manually.
  exit /b 1
)
echo Using Chrome: %CHROME%

REM Dedicated debug profile (NOT the default "User Data" dir). Log into MAL here once.
set "DEBUG_PROFILE=%LocalAppData%\Google\Chrome\DebugProfile"

REM Close ONLY Chrome instances using the debug profile (matched by command line),
REM so every run starts clean. Your normal Chrome windows are left untouched.
echo Closing any existing debug-profile Chrome (your normal Chrome is left alone)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*DebugProfile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 1 >nul

echo Starting Chrome with remote debugging on the dedicated debug profile...
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%DEBUG_PROFILE%"

echo Waiting for the Chrome remote-debugging endpoint to come up...
set "WSEndpoint="
for /l %%i in (1,1,20) do (
  curl -s http://127.0.0.1:9222/json/version > ws_temp.json 2>nul
  if exist ws_temp.json (
    for /f "usebackq delims=" %%u in (`node lib/extractWsUrl.js 2^>nul`) do set "WSEndpoint=%%u"
  )
  if not "!WSEndpoint!"=="" goto :gotws
  timeout /t 1 >nul
)

:gotws
if exist ws_temp.json del ws_temp.json

if "%WSEndpoint%"=="" (
  echo Error: Could not extract WebSocket Debugger URL after waiting 20s.
  echo Check that http://127.0.0.1:9222/json/version returns JSON in your browser.
  exit /b 1
)

echo WebSocket Debugger URL: %WSEndpoint%

echo Running Puppeteer script...
node index.js "%WSEndpoint%"

endlocal
