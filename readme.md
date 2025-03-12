# Chrome Debugging with Puppeteer

## 1️⃣ Fully Close Chrome
Before starting, make sure Chrome is completely closed.

### Windows:
```sh
taskkill /F /IM chrome.exe
```

---

## 2️⃣ Start Chrome with the Correct Debugging Command
Now, manually start Chrome with debugging enabled using the correct profile.

### Find Your Chrome Executable Path
To locate your Chrome executable, open a new Chrome tab and visit:
```
chrome://version/
```
Go to the **Executable Path** (normally `C:\Program Files\Google\Chrome\Application`).

### Run This Command
Use the correct path to start Chrome with remote debugging:

### 🔹 If Using the Default Profile:
```sh
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\user\AppData\Local\Google\Chrome\User Data"
```

### 🔹 If Using a Specific Profile (e.g., "Profile 2"):
```sh
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\user\AppData\Local\Google\Chrome\User Data" --profile-directory="Profile 2"
```

---

## 3️⃣ Run Your Puppeteer Script
Once Chrome is running with debugging enabled, execute your Puppeteer script:
```sh
node index.js
```
Puppeteer will connect to the already running Chrome instead of launching a new instance.

---

## ✅ Additional Debugging Steps
If you still get an error, follow these steps:

### Ensure Chrome is Running with Debugging
Open the following URL in your browser:
```
http://127.0.0.1:9222/json/version
```
- If you see a JSON response, Chrome debugging is active.
- If not, Chrome was not started with debugging—rerun the correct command from **Step 2**.

### Check If Another Process is Using Port 9222
#### Windows:
```sh
netstat -ano | findstr :9222
```
If the output shows an active process using this port, find its PID and terminate it:
```sh
taskkill /PID <PID> /F
```
Then, restart Chrome with debugging enabled.

### Get the WebSocket Debugger URL
After starting Chrome, open this link in your browser:
```
http://127.0.0.1:9222/json/version
```
- If you see a JSON response, copy the **webSocketDebuggerUrl** (it looks like `ws://127.0.0.1:9222/devtools/browser/xxxx`).
- If you get a **404 error**, Chrome was not started with remote debugging—restart using **Step 1**.

---

## 🎯 Conclusion
By following these steps, you should be able to run Puppeteer with an already running Chrome instance, avoiding issues with launching a new one.

