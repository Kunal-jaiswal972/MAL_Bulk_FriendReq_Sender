# MAL Bulk Friend Request Sender

Automatically sends a friend request to **every friend** of a given MyAnimeList
(MAL) user. It does this by driving an **already-logged-in** Chrome instance with
[`puppeteer-core`](https://pptr.dev/) over Chrome's remote debugging protocol —
so you stay logged in as yourself and don't re-enter credentials each run.

---

## ⚡ Quick start

```sh
npm install      # once, after cloning
npm start        # every time you want to run it
```

On the **first** run, a fresh Chrome window opens that is **not** logged into MAL.
Log into [myanimelist.net](https://myanimelist.net) once with the account you want
to send requests *from*, then re-run `npm start`. The login is remembered after
that.

> ℹ️ Windows-only as written (`npm start` runs `script.bat`). On other platforms,
> follow the **Running manually** section below instead.

---

## 🧠 How it works

```
npm start ─▶ script.bat
              │
              1. find chrome.exe
              2. launch Chrome:  --remote-debugging-port=9222
                                 --user-data-dir=<dedicated debug profile>
              3. GET http://127.0.0.1:9222/json/version
                 └─ lib/extractWsUrl.js parses the "webSocketDebuggerUrl"
              4. node index.js "<wsUrl>"
                                 │
                                 ▼
                    puppeteer-core connects to the running Chrome
                    ├─ scrape the target user's friends list
                    ├─ open each friend's profile → click "Add Friend"
                    └─ on finish / error / Ctrl+C → close Chrome
```

Key data flow detail: the WebSocket URL is **passed to `index.js` as a
command-line argument** (`process.argv[2]`) — it is **not** hard-coded inside the
script. `script.bat` discovers it at runtime and forwards it automatically.

Pacing (built into `index.js` to stay gentle on MAL): **5 seconds** between
profiles, **25 seconds** between sent requests.

**Clean exit:** `index.js` closes the Chrome it connected to whenever the run ends
— on success, on error, or on `Ctrl+C` — so the next run always starts from a
fresh browser launch. This does **not** log you out (the session is saved on disk
in the debug profile). As a safety net for cases Node can't catch (e.g. closing the
terminal window), `script.bat` also kills any leftover debug-profile Chrome at the
start of each run.

---

## ⚠️ Why a dedicated Chrome profile (the core design decision)

> **Since Chrome 136, `--remote-debugging-port` is _silently ignored_ when Chrome
> is launched against its _default_ user-data directory**
> (`...\Google\Chrome\User Data`).

This was a deliberate **security fix**: attackers had been abusing the remote
debugging port to extract cookies from people's main Chrome profile (made more
attractive once App-Bound Encryption shipped). So Google disabled the port for the
default profile. See https://developer.chrome.com/blog/remote-debugging-port.

**Consequence:** you cannot drive your normal, already-logged-in Chrome profile
(`Default`, `Profile 2`, …) with Puppeteer anymore — the debugging endpoint simply
never comes up, so the connection fails.

**The fix used here:** launch Chrome with a **dedicated, non-default**
`--user-data-dir`:

```
%LocalAppData%\Google\Chrome\DebugProfile
```

Google explicitly kept remote debugging working for non-default profiles, so this
is the **officially supported** path, not a loophole. You log into MAL **once** in
that profile and the session persists across all future runs.

**Why not just copy your existing logged-in profile?** Chrome's **App-Bound
Encryption** ties each profile's cookies to the original `User Data\Local State`
encryption key and location. Copying the profile folder elsewhere leaves those
cookies undecryptable — you'd end up logged out anyway. (That dead end is why
`copyProfile.bat` exists but is fully commented out.) Logging in once in the
dedicated profile is the clean solution.

---

## ✅ Prerequisites

- **Node.js** (the project uses ES modules — see `"type": "module"` in
  `package.json`).
- **Google Chrome** installed at a standard location. `script.bat` auto-detects it
  in `Program Files`, `Program Files (x86)`, and `LocalAppData`.

---

## ▶️ Running (`npm start`)

`npm start` runs `script.bat`, which automatically:

1. Locates `chrome.exe`.
2. Launches Chrome with remote debugging on the **dedicated debug profile**.
3. Waits for `http://127.0.0.1:9222/json/version` and reads the
   `webSocketDebuggerUrl` (via `lib/extractWsUrl.js`).
4. Runs `node index.js "<wsUrl>"`, connecting Puppeteer to that Chrome.
5. Prompts you for a MAL username, then visits each of that user's friends and
   sends a friend request.
6. Closes Chrome when the run ends (success, error, or `Ctrl+C`), so the next run
   starts from a fresh browser.

### First-run login (one time only)

The debug profile starts out **not logged into MAL**. The order of events on the
first run makes this easy — the terminal pauses for a username *before* any
scraping starts:

1. Run `npm start`. A fresh Chrome window opens **and** the terminal prompts
   `Enter MAL username`.
2. **Before typing anything**, switch to that Chrome window and log into
   [myanimelist.net](https://myanimelist.net) with the account you want to send
   requests *from*.
3. Switch back to the terminal, type the target username, and press Enter. The run
   proceeds (now authenticated) and closes Chrome when finished.

The login is saved on disk in the debug profile, so **every later run opens already
logged in** — you only do this once. (Closing Chrome between runs does not log you
out.)

---

## 🛠️ Running manually

Use this if you're not on Windows, or want to drive each step yourself.

**1. Start Chrome with remote debugging on a dedicated profile:**

```sh
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LocalAppData%\Google\Chrome\DebugProfile"
```

(Adjust the `chrome.exe` path if yours differs — check `chrome://version` ➜
*Executable Path*.)

**2. Verify debugging is active** — open in a browser:

```
http://127.0.0.1:9222/json/version
```

You should see JSON containing a `webSocketDebuggerUrl`.

**3. Log into MAL** (first run only) in the Chrome window that opened.

**4. Run the script, passing the WS URL as an argument:**

```sh
node index.js "ws://127.0.0.1:9222/devtools/browser/xxxxxxxx"
```

---

## 🔍 Troubleshooting

| Symptom | Cause & fix |
|---------|-------------|
| `/json/version` returns nothing / 404 | Chrome was launched against the **default** profile (blocked since Chrome 136), or a Chrome is already running on the debug profile **without** the port. Fully close that Chrome and relaunch with the dedicated `--user-data-dir`. |
| `No WebSocket Debugger URL provided` | You ran `node index.js` with no WS-URL argument. Use `npm start`, or pass the URL manually (manual step 4). |
| Every profile logs *"Not a valid friend request URL"* | You're **not logged into MAL** in the debug profile (the request link points to `login.php`). Log in first. |
| `0 friends extracted` | The target user's friends list is private, or MAL changed its page markup (selectors live in `index.js`). |
| Port 9222 already in use | Find and kill the holder: `netstat -ano \| findstr :9222` then `taskkill /PID <PID> /F`. |
| After `Ctrl+C`, cmd shows `Terminate batch job (Y/N)?` | Expected when running via `npm start` — `cmd` always asks this when a batch is interrupted. Press `Y`. (`index.js` already closed Chrome and restored the terminal, so input works.) To skip the prompt entirely, run `node index.js "<wsUrl>"` directly instead of `npm start`. |

---

## 🔮 Future-proofing: if a Chrome update ever breaks the connection

The current setup (regular Chrome + a **dedicated `--user-data-dir`**) is Google's
officially supported automation path, so it should keep working across Chrome
updates. But if a future Chrome version ever tightens remote debugging *again* and
`npm start` can no longer connect (`/json/version` stays empty even with the
dedicated profile), switch to **Chrome for Testing** — a separate Chrome build
Google maintains specifically for automation, with guaranteed-stable debugging
behavior. See https://developer.chrome.com/blog/chrome-for-testing.

**How to switch:**

1. **Install it** (uses the `@puppeteer/browsers` CLI that ships with the
   Puppeteer toolchain — no extra dependency):

   ```sh
   npx @puppeteer/browsers install chrome@stable
   ```

   This downloads Chrome for Testing into a `chrome\` folder under the project and
   **prints the full path** to the `chrome.exe` it installed, e.g.:

   ```
   chrome@<version> C:\...\MAL_Bulk_FriendReq_Sender\chrome\win64-<version>\chrome-win64\chrome.exe
   ```

2. **Point `script.bat` at it** — add one line right after the `echo Using Chrome:
   %CHROME%` line, pasting the exact path from step 1:

   ```bat
   set "CHROME=C:\...\chrome\win64-<version>\chrome-win64\chrome.exe"
   ```

3. **Everything else stays the same** — it still uses the dedicated debug profile
   and the same port. Run `npm start`; first run only, log into MAL once.

> - Chrome for Testing does **not** auto-update, so it won't break unexpectedly —
>   but it also won't get security patches automatically. Re-run the install
>   command occasionally to bump it (and update the path if the version folder
>   changes).
> - The downloaded `chrome\` folder is large and is already in `.gitignore`, so it
>   won't be committed.

---

## 📁 Project layout

| File | Purpose |
|------|---------|
| `index.js` | Main script: connects Puppeteer, scrapes the friends list, sends requests, and closes Chrome on exit (success / error / `Ctrl+C`). |
| `lib/utils.js` | Helpers: `sleep`, `askQuestion`, `waitForInternet`. |
| `lib/extractWsUrl.js` | Parses `webSocketDebuggerUrl` out of Chrome's `/json/version`. |
| `script.bat` | Orchestrates launch + WS extraction + run (invoked by `npm start`). |
| `copyProfile.bat` | *(Disabled)* abandoned experiment that copied a real profile — see **Why a dedicated Chrome profile** above. |
