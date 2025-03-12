# Chrome Debugging with Puppeteer

## 🚀 Running the Project
To start the project, simply run:
```sh
npm run start
```
This command executes a batch script that automates all the necessary steps.

---

## ⚙️ What the Batch File Does
When you run `npm run start`, the batch file performs the following actions:
1. **Closes Chrome** if it's running.
2. **Finds your Chrome executable path** automatically.
3. **Starts Chrome with remote debugging enabled** for the correct user profile.
4. **Fetches the WebSocket Debugger URL** from Chrome.
5. **Passes the WebSocket Debugger URL** to your Puppeteer script.
6. **Runs Puppeteer** and connects to the existing Chrome instance.

All these steps are automated, so manual intervention is not required.

---

## 🛠️ Manual Debugging Instructions (If Needed)
If you encounter issues, follow these steps manually:

### 1️⃣ Fully Close Chrome
Before starting, ensure Chrome is completely closed.

#### Windows:
```sh
taskkill /F /IM chrome.exe
```

### 2️⃣ Find Your Chrome Executable Path
To locate your Chrome executable:
- Open a new Chrome tab and visit:
  ```
  chrome://version/
  ```
- Copy the **Executable Path** (usually `C:\Program Files\Google\Chrome\Application`).

### 3️⃣ Start Chrome with Remote Debugging
Use the correct path to start Chrome with remote debugging:

#### 🔹 Default Profile:
```sh
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\user\AppData\Local\Google\Chrome\User Data"
```

#### 🔹 Specific Profile (e.g., "Profile 2"):
```sh
chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\Users\user\AppData\Local\Google\Chrome\User Data" --profile-directory="Profile 2"
```

### 4️⃣ Verify Chrome Debugging is Active
Open the following URL in your browser:
```
http://127.0.0.1:9222/json/version
```
- If you see a JSON response, Chrome debugging is active.
- If not, restart Chrome using **Step 3**.

### 5️⃣ Get the WebSocket Debugger URL
After starting Chrome, visit:
```
http://127.0.0.1:9222/json/version
```
- Copy the **webSocketDebuggerUrl** (e.g., `ws://127.0.0.1:9222/devtools/browser/xxxx`).
- Paste it into the `index.js` file.
- If you get a **404 error**, restart Chrome using **Step 1**.

### 6️⃣ Run Your Puppeteer Script Manually
Once Chrome is running with debugging enabled and the correct **webSocketDebuggerUrl** is set in `index.js`, execute:
```sh
node index.js
```
This allows Puppeteer to connect to the existing Chrome instance, removing the need to log into MAL repeatedly.

---

## 🔍 Additional Debugging Steps
If you still encounter errors, check for conflicts on port `9222`.

#### Check If Another Process is Using Port 9222:
```sh
netstat -ano | findstr :9222
```
If another process is using the port, find its PID and terminate it:
```sh
taskkill /PID <PID> /F
```
Then, restart Chrome with debugging enabled.

---

## 🎯 Conclusion
By running `npm run start`, the batch script automates all the necessary steps. If you face issues, follow the manual debugging instructions above to troubleshoot effectively.

