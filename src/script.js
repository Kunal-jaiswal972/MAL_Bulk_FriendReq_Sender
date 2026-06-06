import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
import puppeteer from "puppeteer-core";
import chalk from "chalk";
import { sleep, askQuestion, closeActivePrompt, ensureOnline } from "./lib/utils.js";

// ───────────────────────────── Configuration ─────────────────────────────

export const CONFIG = {
  debuggingPort: 9222,

  // Local, gitignored file remembering login state + the last username used.
  stateFile: ".mal-bot-state.json",

  // Dedicated, non-default profile (Chrome 136+ blocks remote debugging on the
  // default "User Data" dir). Log into MAL here once.
  debugProfileDir: path.join(
    process.env.LOCALAPPDATA || os.homedir(),
    "Google",
    "Chrome",
    "DebugProfile"
  ),

  malBaseUrl: "https://myanimelist.net",

  selectors: {
    friendProfileLinks: ".di-tc.va-t.pl8.data .title a",
    friendRequestButton: "#request",
    submitButton: "input[type='submit']",
  },

  delays: {
    betweenProfiles: 5000,
    afterRequest: 25000,
    pageSettle: 2000,
    postKill: 1000,
    wsFetchInterval: 1000,
    chromeCloseTimeout: 4000,
  },

  wsFetchRetries: 20,
};

/** Builds the friends-list URL for a given MAL username. */
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

/** Absolute path to the local state file (kept at the project root, next to main.js). */
const STATE_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", CONFIG.stateFile);

// Holds the connected browser so the shutdown handlers can close it.
let browser;
let cleaningUp = false;

// ───────────────────────── Persisted state (local) ───────────────────────

/** Reads the state file, returning {} if it's missing or unreadable. */
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** Merges `patch` into the saved state and writes it back. */
function saveState(patch) {
  const next = { ...loadState(), ...patch };
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  } catch (error) {
    console.error(chalk.bgRed.white(" ❌ Could not write state file:"), error.message);
  }
  return next;
}

// ─────────────────────────── Chrome bootstrap ────────────────────────────

/** Returns the first chrome.exe found in the standard locations, or throws. */
function findChromePath() {
  for (const candidate of CHROME_PATH_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    "Could not find chrome.exe in standard install locations. Set it manually in script.js (CHROME_PATH_CANDIDATES)."
  );
}

/** Closes only the debug-profile Chrome (Windows-only) so each run starts clean. */
function killExistingDebugChrome() {
  if (process.platform !== "win32") return;
  const profileName = path.basename(CONFIG.debugProfileDir);
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${profileName}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: "ignore" }
    );
  } catch {
    // best-effort cleanup
  }
}

/** Spawns Chrome (detached) with remote debugging on the dedicated profile. */
function launchChrome(chromePath) {
  const args = [
    `--remote-debugging-port=${CONFIG.debuggingPort}`,
    `--user-data-dir=${CONFIG.debugProfileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  const child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
  child.unref();
}

/** Polls Chrome's /json/version until it returns a webSocketDebuggerUrl. */
async function getWebSocketDebuggerUrl() {
  const versionUrl = `http://127.0.0.1:${CONFIG.debuggingPort}/json/version`;
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
  throw new Error(
    `Timed out waiting for ${versionUrl}. Chrome's remote-debugging endpoint never came up.`
  );
}

/** Cleans up old Chrome, launches a fresh one, and connects Puppeteer to it. */
export async function launchChromeAndConnect() {
  console.log(
    chalk.gray(" 🧹 Closing any existing debug-profile Chrome (your normal Chrome is left alone)...")
  );
  killExistingDebugChrome();
  await sleep(CONFIG.delays.postKill);

  const chromePath = findChromePath();
  console.log(chalk.gray(` 🧭 Using Chrome: ${chromePath}`));
  console.log(
    chalk.cyanBright(" 🚀 Launching Chrome with remote debugging on the dedicated debug profile...")
  );
  launchChrome(chromePath);

  const browserWSEndpoint = await getWebSocketDebuggerUrl();
  console.log(chalk.gray(` 🔌 Connected to: ${browserWSEndpoint}`));

  browser = await puppeteer.connect({ browserWSEndpoint });
  const page = await browser.newPage();

  const { width, height } = await page.evaluate(() => ({
    width: window.screen.width,
    height: window.screen.height,
  }));
  await page.setViewport({ width, height });

  return { browser, page };
}

// ───────────────────────── Session & username ────────────────────────────

/** On first ever run, opens the MAL login page and waits; remembers login after. */
export async function ensureLoggedIn(page) {
  if (loadState().isLoggedIn) {
    console.log(chalk.green(" ✅ Already logged in (saved from a previous run)."));
    return;
  }

  console.log(chalk.cyanBright(" 🔑 First run — opening the MAL login page..."));
  await ensureOnline();
  await page.goto(`${CONFIG.malBaseUrl}/login.php`, { waitUntil: "domcontentloaded" });

  await askQuestion(
    chalk.yellow(" 🔑 Log into MAL in the opened browser, then press Enter here to continue... ")
  );

  saveState({ isLoggedIn: true });
  console.log(chalk.green(" ✅ Login saved — future runs will skip this step."));
}

/**
 * Always prompts for a MAL username. Falls back to the last-used name when the
 * input is empty, and requires one the first time (no built-in default).
 */
export async function resolveUsername() {
  const stored = loadState().lastUsername;

  let username;
  while (!username) {
    const prompt = stored
      ? ` 📝 Enter MAL username (default: ${stored}): `
      : " 📝 Enter MAL username: ";
    const answer = await askQuestion(chalk.yellow(prompt));
    username = answer || stored;
    if (!username) console.log(chalk.red(" ⚠️ A username is required — please enter one."));
  }

  saveState({ lastUsername: username });
  return username;
}

// ──────────────────────── Scraping & friend requests ─────────────────────

/** Returns every friend's profile URL from a user's friends page. */
export async function fetchFriendProfileLinks(page, username) {
  const url = friendsPageUrl(username);
  console.log(chalk.blueBright(` 📌 Visiting friends page: ${url}`));

  await ensureOnline();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(CONFIG.delays.pageSettle);

  const links = await page.evaluate(
    (selector) => Array.from(document.querySelectorAll(selector)).map((a) => a.href),
    CONFIG.selectors.friendProfileLinks
  );

  console.log(chalk.greenBright(` ✅ Extracted ${links.length} friend profile links.`));
  return links;
}

/** Opens the Add-Friend URL and clicks the submit button. */
async function sendFriendRequest(page, profileUrl, friendRequestUrl) {
  try {
    await ensureOnline();
    await page.goto(friendRequestUrl, { waitUntil: "domcontentloaded" });
    await sleep(CONFIG.delays.pageSettle);

    const clicked = await page.evaluate((submitSelector) => {
      const btn = document.querySelector(submitSelector);
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    }, CONFIG.selectors.submitButton);

    if (clicked) {
      console.log(chalk.greenBright(` ✅ Friend request sent for ${profileUrl}`));
      console.log(
        chalk.yellow(` ⏳ Waiting ${CONFIG.delays.afterRequest / 1000}s before the next request...`)
      );
      await sleep(CONFIG.delays.afterRequest);
    } else {
      console.log(chalk.redBright(` ⚠️ Friend request button NOT found for ${profileUrl}`));
    }
  } catch (error) {
    console.error(chalk.bgRed.white(` ❌ Error sending friend request for ${profileUrl}:`), error);
  }
}

/** Reads the friend button on a profile and acts on its state. */
async function getFriendRequestStatus(page, profileUrl) {
  const status = await page.evaluate((requestSelector) => {
    const friendBtn = document.querySelector(requestSelector);
    if (!friendBtn) return null;

    const tag = friendBtn.tagName.toLowerCase();
    if (tag === "a") {
      const href = friendBtn.href;
      if (href.includes("go=add")) return { type: "add", link: href };
      if (href.includes("go=remove")) return { type: "remove", link: href };
      return { type: "invalid", link: href };
    }
    if (tag === "span") {
      const title = (friendBtn.getAttribute("title") || "").toLowerCase();
      return { type: "disabled", title };
    }
    return null;
  }, CONFIG.selectors.friendRequestButton);

  if (!status) {
    console.log(chalk.gray(` ❌ No Add Friend button found on ${profileUrl}`));
    return;
  }

  switch (status.type) {
    case "add":
      console.log(chalk.blueBright(` 📌 Navigating to Add Friend page: ${status.link}`));
      await sendFriendRequest(page, profileUrl, status.link);
      break;
    case "remove":
      console.log(chalk.magentaBright(` 🔄 Already friends: ${profileUrl}`));
      break;
    case "invalid":
      console.log(chalk.red(` ❌ Not a valid friend request URL: ${status.link}`));
      break;
    case "disabled":
      if (status.title.includes("pending")) {
        console.log(chalk.yellowBright(` ⏳ Friend request already pending for ${profileUrl}.`));
      } else if (status.title.includes("add friend")) {
        console.log(chalk.bgRed.white(` ❌ User has disabled friend requests: ${profileUrl}`));
      } else {
        console.log(chalk.gray(` ❔ Unknown friend-button state for ${profileUrl}.`));
      }
      break;
  }
}

/** Visits one friend's profile and processes its friend button. `done`/`total` drive the progress count. */
export async function processProfileLink(page, profileUrl, done, total) {
  try {
    console.log(chalk.cyan(` 🔗 Visiting profile (${done + 1}/${total}): ${profileUrl}`));
    await ensureOnline();
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await sleep(CONFIG.delays.pageSettle);
    await getFriendRequestStatus(page, profileUrl);
  } catch (error) {
    console.error(chalk.bgRed.white(` ❌ Error visiting profile ${profileUrl}:`), error);
  } finally {
    console.log(chalk.green(` ✅ Completed (${done + 1}/${total})`));
  }
}

// ─────────────────────────── Lifecycle / shutdown ────────────────────────

/** Closes the connected Chrome so the next run starts fresh (idempotent; keeps you logged in). */
export async function closeBrowser(reason) {
  if (cleaningUp || !browser) return;
  cleaningUp = true;
  try {
    console.log(chalk.gray(`\n 🧹 Closing Chrome (${reason}) so the next run starts fresh...`));
    // Cap the wait so an unresponsive browser can't hang the exit.
    await Promise.race([browser.close(), sleep(CONFIG.delays.chromeCloseTimeout)]);
  } catch {
    // best-effort — Chrome may already be gone
  }
}

/** Restores the terminal, closes Chrome, then exits with `code`. */
async function shutdown(reason, code) {
  closeActivePrompt();
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // stdin may not be a TTY (piped/redirected)
  }
  await closeBrowser(reason);
  process.exit(code);
}

/** Wires Ctrl+C / termination signals to the single shutdown path. */
export function registerShutdownHandlers() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => shutdown(signal, signal === "SIGINT" ? 130 : 0));
  }
}
