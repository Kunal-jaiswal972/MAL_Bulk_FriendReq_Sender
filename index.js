import puppeteer from "puppeteer-core";
import chalk from "chalk";
import {
  sleep,
  askQuestion,
  waitForInternet,
  closeActivePrompt,
} from "./lib/utils.js";
import isOnline from "is-online";

const browserWSEndpoint = process.argv[2];

if (!browserWSEndpoint) {
  console.error(
    chalk.bgRed.white(" ❌ Error: No WebSocket Debugger URL provided. ")
  );
  process.exit(1);
}

let browser; // assigned once connected; used by the cleanup handlers below
let cleaningUp = false;

/**
 * Closes the Chrome instance we connected to so the NEXT run starts from a
 * fresh browser launch. Safe to call repeatedly. The MAL login lives on disk in
 * the debug profile, so closing the window does NOT log you out.
 * @param {string} reason - why we're closing (shown in the log line)
 */
async function closeBrowser(reason) {
  if (cleaningUp || !browser) return;
  cleaningUp = true;
  try {
    console.log(
      chalk.gray(
        `\n 🧹 Closing Chrome (${reason}) so the next run starts fresh...`
      )
    );
    // Don't let an unresponsive browser hang the exit.
    await Promise.race([browser.close(), sleep(4000)]);
  } catch {
    // best-effort — script.bat's targeted kill is the fallback
  }
}

/**
 * Single shutdown path: restore the terminal (close any open prompt + leave raw
 * mode), close Chrome, then exit. A second Ctrl+C while this is running forces an
 * immediate exit (closeBrowser short-circuits via its guard).
 */
async function shutdown(reason, code) {
  closeActivePrompt();
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // ignore — stdin may not be a TTY (piped/redirected)
  }
  await closeBrowser(reason);
  process.exit(code);
}

// Close Chrome on Ctrl+C / termination too, not just on normal completion.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(signal, signal === "SIGINT" ? 130 : 0));
}

(async () => {
  try {
    let userName = await askQuestion(
      chalk.yellow(" 📝 Enter MAL username (default: Ashhk): ")
    );
    if (!userName) {
      userName = "Ashhk";
      console.log(chalk.blue(` 🔹 Using default username: ${userName}`));
    }

    browser = await puppeteer.connect({ browserWSEndpoint });
    const page = await browser.newPage();

    const { width, height } = await page.evaluate(() => ({
      width: window.screen.width,
      height: window.screen.height,
    }));
    await page.setViewport({ width, height });

    console.log(chalk.cyanBright(" 🚀 Fetching all friend profiles..."));

    const profileLinks = await fetchLinksFromPage({
      page,
      url: `https://myanimelist.net/profile/${userName}/friends`,
      selector: ".di-tc.va-t.pl8.data .title a",
    });

    for (const profileUrl of profileLinks) {
      await processProfileLink(page, profileUrl);
      console.log(
        chalk.gray(" ⏳ Waiting 5 seconds before visiting the next profile...")
      );
      await sleep(5000);
    }

    console.log(chalk.bgGreen.black(" ✅ All friend requests sent! "));
  } catch (mainError) {
    process.exitCode = 1;
    console.error(chalk.bgRed.white(" ❌ Error in main function: "), mainError);
  } finally {
    await closeBrowser("run finished");
  }
})();

/**
 * Visits a user's profile and finds the "Add Friend" request link.
 * @param {object} page - Puppeteer page instance
 * @param {string} profileUrl - The profile URL to visit
 */
async function processProfileLink(page, profileUrl) {
  try {
    console.log(chalk.cyan(` 🔗 Visiting Profile: ${profileUrl}`));

    while (!(await isOnline())) await waitForInternet();
    await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    await getFrndReqLink(page, profileUrl);
  } catch (error) {
    console.error(
      chalk.bgRed.white(` ❌ Error visiting profile ${profileUrl}:`),
      error
    );
  }
}

/**
 * Navigates to the Add Friend page and clicks the request button.
 * @param {object} page - Puppeteer page instance
 * @param {string} profileUrl - The profile URL (for logging)
 * @param {string} friendRequestUrl - The URL to send the friend request
 */
async function sendFriendRequest(page, profileUrl, friendRequestUrl) {
  try {
    while (!(await isOnline())) await waitForInternet();
    await page.goto(friendRequestUrl, { waitUntil: "domcontentloaded" });
    await sleep(2000);

    const clicked = await page.evaluate(() => {
      const frSendBtn = document.querySelector("input[type='submit']");
      if (frSendBtn) {
        frSendBtn.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      console.log(
        chalk.greenBright(
          ` ✅ Friend request sent successfully for ${profileUrl}`
        )
      );
      console.log(
        chalk.yellow(
          " ⏳ Waiting 25 seconds before sending the next request..."
        )
      );
      await sleep(25000);
    } else {
      console.log(
        chalk.redBright(` ⚠️ Friend request button NOT found for ${profileUrl}`)
      );
    }
  } catch (error) {
    console.error(
      chalk.bgRed.white(` ❌ Error sending friend request for ${profileUrl}:`),
      error
    );
  }
}

/**
 * Fetches all links from a given page URL based on the provided CSS selector.
 * @param {object} page - Puppeteer page instance
 * @param {string} url - The URL to visit
 * @param {string} selector - The CSS selector to extract links
 * @returns {Promise<string[]>} - Array of extracted links
 */
async function fetchLinksFromPage({ page, url, selector }) {
  console.log(chalk.blueBright(` 📌 Visiting Page: ${url}`));

  while (!(await isOnline())) await waitForInternet();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(2000);

  const links = await page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(selector)).map((a) => a.href),
    selector
  );

  console.log(
    chalk.greenBright(` ✅ Extracted ${links.length} links from ${url}`)
  );
  return links;
}

/**
 * Extracts the friend request link from a profile page.
 * Handles different button types: `<a>` for request, `<span>` for disabled/pending requests.
 * Calls `sendFriendRequest()` only if a valid "Add Friend" link is found.
 * @param {object} page - Puppeteer page instance
 * @param {string} profileUrl - The profile URL (for logging)
 */
async function getFrndReqLink(page, profileUrl) {
  const frndBtnStatus = await page.evaluate(() => {
    const friendBtn = document.querySelector("#request");

    if (!friendBtn) return null;

    if (friendBtn.tagName.toLowerCase() === "a") {
      const href = friendBtn.href;
      if (href.includes("go=add")) {
        return { type: "add", link: href };
      } else if (href.includes("go=remove")) {
        return { type: "remove", link: href };
      } else {
        return { type: "invalid", link: href };
      }
    } else if (friendBtn.tagName.toLowerCase() === "span") {
      const title = friendBtn.getAttribute("title") || "";
      return { type: "disabled", title: title.toLowerCase() };
    }

    return null;
  });

  if (frndBtnStatus) {
    if (frndBtnStatus.type === "add") {
      console.log(
        chalk.blueBright(
          ` 📌 Navigating to Add Friend Page: ${frndBtnStatus.link}`
        )
      );
      await sendFriendRequest(page, profileUrl, frndBtnStatus.link);
    } else if (frndBtnStatus.type === "remove") {
      console.log(
        chalk.magentaBright(` 🔄 Already Friends: ${frndBtnStatus.link}`)
      );
    } else if (frndBtnStatus.type === "invalid") {
      console.log(
        chalk.red(` ❌ Not a valid friend request URL: ${frndBtnStatus.link}`)
      );
    } else if (frndBtnStatus.type === "disabled") {
      if (frndBtnStatus.title.includes("pending")) {
        console.log(
          chalk.yellowBright(
            ` ⏳ Friend request already sent for ${profileUrl}.`
          )
        );
      } else if (frndBtnStatus.title.includes("add friend")) {
        console.log(
          chalk.bgRed.white(
            ` ❌ User has disabled friend requests for ${profileUrl}.`
          )
        );
      }
    }
  } else {
    console.log(chalk.gray(` ❌ No Add Friend link found on ${profileUrl}`));
  }
}
