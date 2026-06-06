import fs from "fs";
import os from "os";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
import puppeteer from "puppeteer-core";
import chalk from "chalk";
import { sleep, randomInt, askQuestion, closeActivePrompt, ensureOnline } from "./lib/utils.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ───────────────────────────── Configuration ─────────────────────────────

export const CONFIG = {
  malBaseUrl: "https://myanimelist.net",

  // Per-user Chrome profiles (each MAL account keeps its own login session here)
  // and per-user state files. Both are keyed by a sanitized login username.
  profilesBaseDir: path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    "Google",
    "Chrome",
    "MalBotProfiles"
  ),
  stateDir: path.join(ROOT, ".mal-state"),

  selectors: {
    friendProfileLinks: ".di-tc.va-t.pl8.data .title a",
    friendRequestButton: "#request",
    submitButton: "input[type='submit']",
    // Login page (myanimelist.net/login.php)
    loginUsername: "#loginUserName",
    loginPassword: "#login-password",
    loginRemember: "input[name='cookie']",
    loginSubmit: "input[type='submit'].btn-form-submit",
    loginError: ".badresult", // e.g. "Your username or password is incorrect."
  },

  delays: {
    betweenProfiles: 5000,
    afterRequest: 25000,
    pageSettle: 2000,
    wsFetchInterval: 1000,
    chromeCloseTimeout: 4000,
    loginAutofillSettle: 2000,
    typeMin: 100,
    typeMax: 1000,
    beforeSubmitMin: 600,
    beforeSubmitMax: 1800,
  },

  wsFetchRetries: 20,
};

const friendsPageUrl = (username) => `${CONFIG.malBaseUrl}/profile/${username}/friends`;

/** Standard Chrome install locations, checked in order. */
const CHROME_PATH_CANDIDATES = [
  process.env.PROGRAMFILES &&
    path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
  process.env["PROGRAMFILES(X86)"] &&
    path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
].filter(Boolean);

/** Run Chrome without a visible window (set HEADLESS=true in prod). */
const isHeadless = () => /^(1|true|yes|on)$/i.test(process.env.HEADLESS || "");

// ──────────────────────── Shared low-level helpers ───────────────────────

/** Returns the first chrome.exe found in the standard locations, or throws. */
function findChromePath() {
  for (const candidate of CHROME_PATH_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Could not find chrome.exe in standard install locations. Set it manually in script.js (CHROME_PATH_CANDIDATES)."
  );
}

/** Resolves to an OS-assigned free TCP port. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Polls a Chrome instance's /json/version until it returns a webSocketDebuggerUrl. */
async function getWebSocketDebuggerUrl(port) {
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 1; attempt <= CONFIG.wsFetchRetries; attempt++) {
    try {
      const res = await fetch(versionUrl);
      if (res.ok) {
        const { webSocketDebuggerUrl } = await res.json();
        if (webSocketDebuggerUrl) return webSocketDebuggerUrl;
      }
    } catch {
      // endpoint not up yet — keep polling
    }
    await sleep(CONFIG.delays.wsFetchInterval);
  }
  throw new Error(`Timed out waiting for ${versionUrl} (Chrome remote-debugging endpoint).`);
}

/** Filesystem-safe key derived from a MAL username. */
function sanitizeName(name) {
  return (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "default";
}

/** Types `text` into `selector` one character at a time with random human-like pauses. */
async function typeLikeHuman(page, selector, text) {
  await page.focus(selector);
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(randomInt(CONFIG.delays.typeMin, CONFIG.delays.typeMax));
  }
}

/**
 * Closes every Chrome started by this tool (matched by the profiles base dir),
 * leaving the user's normal Chrome alone. Windows-only; call once on startup to
 * clear leftovers from a crashed run. No-op elsewhere.
 */
export function killManagedChrome() {
  if (process.platform !== "win32") return;
  const marker = path.basename(CONFIG.profilesBaseDir);
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore" }
    );
  } catch {
    // best-effort cleanup
  }
}

// ─────────────────────────────── MalSession ──────────────────────────────

/**
 * One MAL account = one MalSession. Each owns an isolated Chrome instance
 * (its own profile dir + debug port) and a per-user state file, so several
 * sessions can run concurrently without colliding.
 */
export class MalSession {
  /** All live sessions, so shutdown handlers can close every Chrome. */
  static instances = new Set();

  constructor(loginUsername) {
    this.loginUsername = loginUsername || "default";
    this.safe = sanitizeName(this.loginUsername);
    this.profileDir = path.join(CONFIG.profilesBaseDir, this.safe);
    this.stateFile = path.join(CONFIG.stateDir, `${this.safe}.json`);
    this.port = null;
    this.browser = null;
    this.page = null;
    this.child = null;
  }

  // ---- per-user state file ----

  loadState() {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    } catch {
      return {};
    }
  }

  saveState(patch) {
    const next = { ...this.loadState(), ...patch };
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(next, null, 2));
    } catch (error) {
      console.error(chalk.bgRed.white(" ❌ Could not write state file:"), error.message);
    }
    return next;
  }

  // ---- browser lifecycle ----

  /** Launches this session's Chrome on a free port and connects Puppeteer. */
  async launch() {
    this.port = await findFreePort();
    const chromePath = findChromePath();
    const headless = isHeadless();
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
    if (headless) args.push("--headless=new", "--window-size=1280,800");

    console.log(
      chalk.cyanBright(
        ` 🚀 [${this.loginUsername}] Launching Chrome (${headless ? "headless" : "visible"}) on port ${this.port}...`
      )
    );
    this.child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
    this.child.unref();

    const ws = await getWebSocketDebuggerUrl(this.port);
    this.browser = await puppeteer.connect({ browserWSEndpoint: ws });
    this.page = await this.browser.newPage();
    const { width, height } = await this.page.evaluate(() => ({
      width: window.screen.width || 1280,
      height: window.screen.height || 800,
    }));
    await this.page.setViewport({ width, height });

    MalSession.instances.add(this);
    return this;
  }

  /** Closes this session's Chrome. Safe to call more than once. */
  async close() {
    MalSession.instances.delete(this);
    try {
      if (this.browser) {
        await Promise.race([this.browser.close(), sleep(CONFIG.delays.chromeCloseTimeout)]);
      }
    } catch {
      // best-effort
    }
    this.browser = null;
    this.page = null;
  }

  // ---- login ----

  /** True when logged in: loading login.php redirects away (to home) only when logged in. */
  async verifyLoggedIn() {
    await ensureOnline();
    await this.page.goto(`${CONFIG.malBaseUrl}/login.php`, { waitUntil: "domcontentloaded" });
    return !this.page.url().includes("login.php");
  }

  /** Fills the login form (human-like) and submits. Returns MAL's error text, or "" on apparent success. */
  async autoLogin(password) {
    const page = this.page;
    const tag = `[${this.loginUsername}]`;
    await ensureOnline();
    console.log(chalk.cyan(` 🌐 ${tag} Opening MAL login page...`));
    await page.goto(`${CONFIG.malBaseUrl}/login.php`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(CONFIG.selectors.loginUsername, { timeout: 10000 });

    console.log(chalk.gray(` ⌛ ${tag} Letting autofill settle (${CONFIG.delays.loginAutofillSettle}ms)...`));
    await sleep(CONFIG.delays.loginAutofillSettle);
    console.log(chalk.gray(` 🧽 ${tag} Clearing any autofilled values...`));
    await page.$eval(CONFIG.selectors.loginUsername, (el) => (el.value = ""));
    await page.$eval(CONFIG.selectors.loginPassword, (el) => (el.value = ""));

    console.log(chalk.blue(` ⌨️  ${tag} Typing username...`));
    await typeLikeHuman(page, CONFIG.selectors.loginUsername, this.loginUsername);
    console.log(chalk.blue(` ⌨️  ${tag} Typing password...`));
    await typeLikeHuman(page, CONFIG.selectors.loginPassword, password);

    console.log(chalk.gray(` ☑️  ${tag} Enabling 'remember me'...`));
    await page.evaluate((sel) => {
      const c = document.querySelector(sel);
      if (c && !c.checked) c.click();
    }, CONFIG.selectors.loginRemember);

    const wait = randomInt(CONFIG.delays.beforeSubmitMin, CONFIG.delays.beforeSubmitMax);
    console.log(chalk.gray(` ⌛ ${tag} Waiting ${wait}ms before clicking Login...`));
    await sleep(wait);

    console.log(chalk.cyanBright(` 🖱️  ${tag} Clicking the Login button...`));
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
      page.click(CONFIG.selectors.loginSubmit),
    ]);
    await sleep(CONFIG.delays.pageSettle);

    return page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : "";
    }, CONFIG.selectors.loginError);
  }

  /** Opens the login page and waits for the user to log in by hand (local/visible only). */
  async manualLogin() {
    if (isHeadless()) {
      throw new Error(
        "Manual login can't run in headless mode (no visible window). Provide credentials, or unset HEADLESS."
      );
    }
    await ensureOnline();
    await this.page.goto(`${CONFIG.malBaseUrl}/login.php`, { waitUntil: "domcontentloaded" });
    await askQuestion(
      chalk.yellow(" 🔑 Log into MAL in the opened browser, then press Enter here to continue... ")
    );
  }

  /**
   * Ensures this session is logged in. Always verifies the live session first.
   * @param {object} opts
   * @param {string} [opts.password] - credential for auto-login
   * @param {boolean} [opts.allowManual] - allow a visible manual-login fallback (CLI/local)
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async ensureLoggedIn({ password, allowManual = false } = {}) {
    const tag = `[${this.loginUsername}]`;

    if (await this.verifyLoggedIn()) {
      console.log(chalk.green(` ✅ ${tag} Already logged in (existing session).`));
      return { ok: true };
    }

    if (password) {
      const error = await this.autoLogin(password);
      if (error) console.log(chalk.bgRed.white(` ❌ ${tag} MAL login error: ${error} `));
      if (await this.verifyLoggedIn()) {
        console.log(chalk.green(` ✅ ${tag} Auto-login succeeded.`));
        return { ok: true };
      }
      if (!allowManual) {
        return {
          ok: false,
          error: error || "Login failed (wrong credentials, or a captcha/challenge blocked it).",
        };
      }
      console.log(chalk.yellowBright(` ⚠️ ${tag} Auto-login failed — falling back to manual login.`));
    }

    if (allowManual) {
      await this.manualLogin();
      if (await this.verifyLoggedIn()) {
        console.log(chalk.green(` ✅ ${tag} Login confirmed.`));
        return { ok: true };
      }
      return { ok: false, error: "Still not detected as logged in after manual login." };
    }

    return { ok: false, error: "No credentials provided." };
  }

  // ---- scraping & friend requests ----

  /** Returns every friend's profile URL from the target user's friends page. */
  async fetchFriendProfileLinks(target) {
    const url = friendsPageUrl(target);
    await ensureOnline();
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(CONFIG.delays.pageSettle);
    return this.page.evaluate(
      (selector) => Array.from(document.querySelectorAll(selector)).map((a) => a.href),
      CONFIG.selectors.friendProfileLinks
    );
  }

  /** Navigates to the Add-Friend URL and clicks submit. Returns true if clicked. */
  async sendFriendRequest(friendRequestUrl) {
    await ensureOnline();
    await this.page.goto(friendRequestUrl, { waitUntil: "domcontentloaded" });
    await sleep(CONFIG.delays.pageSettle);
    const clicked = await this.page.evaluate((submitSelector) => {
      const btn = document.querySelector(submitSelector);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, CONFIG.selectors.submitButton);
    if (clicked) await sleep(CONFIG.delays.afterRequest);
    return clicked;
  }

  /** Visits one profile, reads its friend button, and acts. Returns a status string. */
  async processProfile(profileUrl) {
    try {
      await ensureOnline();
      await this.page.goto(profileUrl, { waitUntil: "domcontentloaded" });
      await sleep(CONFIG.delays.pageSettle);

      const info = await this.page.evaluate((requestSelector) => {
        const btn = document.querySelector(requestSelector);
        if (!btn) return null;
        const t = btn.tagName.toLowerCase();
        if (t === "a") {
          const href = btn.href;
          if (href.includes("go=add")) return { type: "add", link: href };
          if (href.includes("go=remove")) return { type: "remove" };
          return { type: "invalid" };
        }
        if (t === "span") {
          return { type: "disabled", title: (btn.getAttribute("title") || "").toLowerCase() };
        }
        return null;
      }, CONFIG.selectors.friendRequestButton);

      if (!info) return "no-button";
      if (info.type === "add") return (await this.sendFriendRequest(info.link)) ? "sent" : "send-failed";
      if (info.type === "remove") return "already-friends";
      if (info.type === "invalid") return "invalid";
      if (info.type === "disabled") {
        if (info.title.includes("pending")) return "pending";
        if (info.title.includes("add friend")) return "disabled";
        return "unknown";
      }
      return "unknown";
    } catch (error) {
      return "error";
    }
  }

  /**
   * Sends a friend request to each of `target`'s friends, yielding progress events:
   *   {type:'start', total} → {type:'visiting', done, total, url}
   *   → {type:'completed', done, total, url, status} → ... → {type:'done', total}
   * @param {string} target
   * @param {{aborted: boolean}} [signal] - set .aborted = true to stop between profiles
   */
  async *runFriendRequests(target, signal = { aborted: false }) {
    const links = await this.fetchFriendProfileLinks(target);
    const total = links.length;
    yield { type: "start", total, target };

    for (let i = 0; i < total; i++) {
      if (signal.aborted) {
        yield { type: "aborted", done: i, total };
        return;
      }
      yield { type: "visiting", done: i, total, url: links[i] };
      const status = await this.processProfile(links[i]);
      yield { type: "completed", done: i + 1, total, url: links[i], status };
      if (i < total - 1 && !signal.aborted) await sleep(CONFIG.delays.betweenProfiles);
    }

    yield { type: "done", total };
  }
}

// ─────────────────────────── Shutdown handling ───────────────────────────

/** Closes every live session's Chrome. */
export async function closeAllSessions() {
  await Promise.all([...MalSession.instances].map((s) => s.close()));
}

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  closeActivePrompt();
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // stdin may not be a TTY
  }
  console.log(chalk.gray("\n 🧹 Closing all Chrome sessions..."));
  await closeAllSessions();
  process.exit(code);
}

/** Wires Ctrl+C / termination so every Chrome session is closed before exit. */
export function registerShutdownHandlers() {
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => shutdown(sig === "SIGINT" ? 130 : 0));
  }
}
