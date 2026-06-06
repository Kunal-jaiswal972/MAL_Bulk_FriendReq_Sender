# MAL Bulk Friend Request Sender

Automatically sends a friend request to **every friend** of a given MyAnimeList
(MAL) user. It drives an **already-logged-in** Chrome instance with
[`puppeteer-core`](https://pptr.dev/) over Chrome's remote debugging protocol — so
you stay logged in as yourself and never re-enter credentials.

Everything (launching Chrome, finding the debug endpoint, scraping, and cleanup)
runs in Node — there's no batch file or manual setup.

---

## ⚡ Quick start

```sh
npm install      # once, after cloning
npm start        # every time you want to run it  (= node main.js)
```

For automatic login, copy `.env.example` to `.env` and fill in the MAL account you
want to send requests *from*:

```sh
cp .env.example .env     # then edit MAL_USERNAME / MAL_PASSWORD
```

On the first run the app logs into MAL using those credentials, confirms it landed
on the home page, and remembers the session for future runs. No `.env`? It falls
back to manual login (opens the login page and waits for you).

> ℹ️ Built and tested on **Windows**. See [Other platforms](#-other-platforms) for
> notes on running elsewhere.

---

## 🧠 How it works

```
npm start ─▶ node main.js          (orchestration only)
                  │
                  ▼  calls into script.js:
          1. launchChromeAndConnect()
               ├─ kill any old debug-profile Chrome  (clean start)
               ├─ find chrome.exe
               ├─ spawn Chrome:  --remote-debugging-port=9222
               │                 --user-data-dir=<dedicated debug profile>
               ├─ poll http://127.0.0.1:9222/json/version → webSocketDebuggerUrl
               └─ puppeteer.connect(...) → { browser, page }
          2. ensureLoggedIn(page)   → first run only: open MAL login, wait, remember
          3. resolveUsername()      → prompt (defaults to your last-used name)
          4. fetchFriendProfileLinks(page, username)
          5. for each friend → processProfileLink() → click "Add Friend"
          6. on finish / error / Ctrl+C → closeBrowser()   (next run starts fresh)
```

**Clean exit:** `script.js` closes the Chrome it launched whenever the run ends —
on success, on error, or on `Ctrl+C` — so the next run always starts from a fresh
browser. This does **not** log you out (the session is saved on disk in the debug
profile). Because the launcher is plain Node (no batch wrapper), `Ctrl+C` returns
you straight to the shell with no `Terminate batch job (Y/N)?` prompt.

Pacing (to stay gentle on MAL): **5 s** between profiles, **25 s** after each sent
request. All timing lives in `CONFIG` — see [Configuration](#️-configuration).

---

## ⚠️ Why a dedicated Chrome profile (the core design decision)

> **Since Chrome 136, `--remote-debugging-port` is _silently ignored_ when Chrome
> is launched against its _default_ user-data directory**
> (`...\Google\Chrome\User Data`).

This was a deliberate **security fix**: attackers had been abusing the remote
debugging port to extract cookies from people's main Chrome profile (more
attractive once App-Bound Encryption shipped). So Google disabled the port for the
default profile. See https://developer.chrome.com/blog/remote-debugging-port.

**Consequence:** you cannot drive your normal, already-logged-in Chrome profile
(`Default`, `Profile 2`, …) with Puppeteer anymore — the debugging endpoint never
comes up, so the connection fails.

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
cookies undecryptable — you'd end up logged out anyway. Logging in once in the
dedicated profile is the clean solution.

---

## ✅ Prerequisites

- **Node.js 20.12+** (uses ES modules, global `fetch`, and `process.loadEnvFile()`).
- **Google Chrome** installed at a standard location. `script.js` auto-detects it
  via `CHROME_PATH_CANDIDATES` (Program Files, Program Files (x86), LocalAppData).

---

## ▶️ Running

```sh
npm start        # == node main.js
```

What happens:

1. `main.js` calls `launchChromeAndConnect()` in `script.js`, which closes any old
   debug-profile Chrome, launches a fresh one with remote debugging on the
   dedicated profile, waits for the endpoint, and connects Puppeteer.
2. **First run only:** it logs into MAL (see below) and confirms the session.
3. You're prompted for a MAL username (the target whose friends get requests).
4. It scrapes that user's friends list and sends a friend request to each friend.
5. Chrome closes when the run ends (success, error, or `Ctrl+C`), so the next run
   starts from a fresh browser.

### Login (first run only)

Login state is tracked in a local, gitignored file (`.mal-bot-state.json`). On the
first run, `ensureLoggedIn()` works through this order:

1. **Saved flag** — if `isLoggedIn` is already `true`, skip straight to the request flow.
2. **Existing session** — if the debug profile already has a live MAL session, record it and continue.
3. **Auto-login from `.env`** — if `MAL_USERNAME` / `MAL_PASSWORD` are set, it opens
   `login.php`, waits for any autofill, clears the fields, and **types each character
   with a random 100–1000 ms pause** (with a random pause before clicking **Login**)
   to look human. Each step is logged in color. It then **confirms login by loading
   `login.php` and checking it redirects to the home page** (MAL only redirects away
   from `login.php` when logged in). On success the session is saved. If MAL rejects
   the login credentials, its error is printed in red in the terminal — e.g.
   *"Your username or password is incorrect."*, or after repeated failures
   *"Too many failed login attempts. Please try to login again after several hours."*
4. **Manual fallback** — if there's no `.env`, or auto-login doesn't go through, it
   opens the login page and waits for you to log in by hand, then verifies the same way.

After any successful login, the session persists on disk in the debug profile and
`isLoggedIn: true` is saved, so later runs skip the whole step.

> ⚠️ MAL's login uses **reCAPTCHA**. Auto-login usually works from your real Chrome
> profile, but if MAL shows a challenge it will fail verification and fall back to
> manual login — just complete it once in the window; the session is then remembered.

> 🔁 To **switch accounts** or recover from being logged out, delete
> `.mal-bot-state.json` — the next run logs in again (auto from `.env`, or manually).

### The username prompt

You must enter a MAL username — there's no hard-coded default. The last name you
used is remembered (in `.mal-bot-state.json`) and shown as the default, so on later
runs you can just press Enter to reuse it:

```
📝 Enter MAL username:                       ← first time (input required)
📝 Enter MAL username (default: SomeUser):   ← later (Enter reuses SomeUser)
```

---

## ⚙️ Configuration

**Credentials** — login uses environment variables loaded from `.env` (gitignored):

| Variable | Purpose |
|----------|---------|
| `MAL_USERNAME` | MAL account username for auto-login. |
| `MAL_PASSWORD` | MAL account password for auto-login. |
| `HEADLESS` | `true`/`1`/`yes`/`on` runs Chrome with no visible window (servers / prod). Requires the credentials above — manual login needs a window. |

Copy `.env.example` → `.env` and fill these in. Leave the credentials out to use manual login.

**Everything else** lives in the `CONFIG` object at the top of [`src/script.js`](src/script.js):

| Setting | What it controls |
|---------|------------------|
| `debuggingPort` | Chrome remote-debugging port (default `9222`). |
| `stateFile` | Name of the local state file (login flag + last-used username). |
| `debugProfileDir` | The dedicated profile path you log into MAL once. |
| `malBaseUrl` | MAL base URL. |
| `selectors` | CSS selectors for the friends list, friend button, submit button, and **login form** (username/password/remember/submit) — update if MAL changes its markup. |
| `delays` | All pacing/timeouts: between profiles, after a request, page settle, and the human-typing ranges (`typeMin`/`typeMax`, `beforeSubmitMin`/`beforeSubmitMax`). |
| `wsFetchRetries` | How many times to poll the debugging endpoint before giving up. |

Chrome install locations are in `CHROME_PATH_CANDIDATES` just below `CONFIG`.

---

## 🌐 Other platforms

`npm start` does everything — there is no separate launch or WS-URL step to run by
hand. Two Windows-specific notes if you run elsewhere:

- The "close old debug-profile Chrome" step uses PowerShell and is **skipped** on
  non-Windows (harmless — Puppeteer just reconnects to any running instance).
- Add your OS's Chrome path to `CHROME_PATH_CANDIDATES` in `script.js` (e.g.
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS).

---

## 🔍 Troubleshooting

| Symptom | Cause & fix |
|---------|-------------|
| `Timed out waiting for .../json/version` | The debugging endpoint never came up. Usually another Chrome is already bound to the port, or Chrome failed to launch. Close stray Chrome on the debug profile and retry; check the port isn't taken. |
| `Could not find chrome.exe ...` | Chrome isn't in a standard location. Add its path to `CHROME_PATH_CANDIDATES` in `script.js` (find it via `chrome://version` ➜ *Executable Path*). |
| `MAL login error: Your username or password is incorrect.` | Wrong `MAL_USERNAME` / `MAL_PASSWORD` in `.env`. Fix them and re-run. |
| `MAL login error: Too many failed login attempts. Please try to login again after several hours.` | MAL **rate-limited your IP** after repeated failed logins. There's no bypass — wait a few hours, then retry with correct credentials. (Getting your password right the first time avoids this.) |
| Every profile logs *"Not a valid friend request URL"* | You're **not logged into MAL** in the debug profile (the request link points to `login.php`). Log in first (see First-run login). |
| `Extracted 0 friend profile links` | The target user's friends list is private, or MAL changed its markup (update `CONFIG.selectors`). |
| Port 9222 already in use | Find and kill the holder: `netstat -ano \| findstr :9222` then `taskkill /PID <PID> /F`, or change `CONFIG.debuggingPort`. |

`Ctrl+C` stops the run cleanly at any point — it closes the prompt, closes Chrome,
and returns you to the shell.

---

## 🔮 Future-proofing: if a Chrome update ever breaks the connection

The current setup (regular Chrome + a **dedicated `--user-data-dir`**) is Google's
officially supported automation path, so it should keep working across Chrome
updates. But if a future Chrome ever tightens remote debugging *again* and the
connection fails even with the dedicated profile, switch to **Chrome for Testing** —
a separate Chrome build Google maintains for automation, with guaranteed-stable
debugging behavior. See https://developer.chrome.com/blog/chrome-for-testing.

**How to switch:**

1. Install it (no extra dependency — ships with the Puppeteer toolchain):

   ```sh
   npx @puppeteer/browsers install chrome@stable
   ```

   It downloads Chrome for Testing into a `chrome\` folder and **prints the full
   path** to the `chrome.exe` it installed.

2. Put that path **first** in `CHROME_PATH_CANDIDATES` (top of `script.js`), so it's
   preferred over your normal Chrome:

   ```js
   const CHROME_PATH_CANDIDATES = [
     "C:\\...\\chrome\\win64-<version>\\chrome-win64\\chrome.exe", // Chrome for Testing
     // ...existing entries below
   ].filter(Boolean);
   ```

3. Run `npm start` as usual; first run only, log into MAL once.

> - Chrome for Testing does **not** auto-update, so it won't break unexpectedly —
>   but it also won't get security patches automatically. Re-run the install
>   command occasionally to bump it (and update the path).
> - The downloaded `chrome\` folder is large and is already in `.gitignore`.

---

## 📁 Project layout

| File | Purpose |
|------|---------|
| `main.js` | Entry point at the project root: the orchestration IIFE (`npm start` runs this). |
| `src/script.js` | Config (`CONFIG`) + all app logic: launch/connect Chrome, login + username handling, scrape friends, send requests, and close Chrome on exit. |
| `src/lib/utils.js` | Pure, reusable helpers: `sleep`, `askQuestion`, `closeActivePrompt`, `ensureOnline`. |
| `.env.example` | Template for login credentials — copy to `.env` and fill in. |
| `.env` | *(you create it, gitignored)* `MAL_USERNAME` / `MAL_PASSWORD` for auto-login. |
| `.mal-bot-state.json` | *(generated at root, gitignored)* remembers `isLoggedIn` and the last-used username. Delete it to reset/switch accounts. |
