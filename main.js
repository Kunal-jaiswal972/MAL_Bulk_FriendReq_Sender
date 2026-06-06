import chalk from "chalk";
import { askQuestion, sleep } from "./lib/utils.js";
import {
  CONFIG,
  launchChromeAndConnect,
  fetchFriendProfileLinks,
  processProfileLink,
  closeBrowser,
  registerShutdownHandlers,
} from "./script.js";

// Close Chrome on Ctrl+C / termination, not just on normal completion.
registerShutdownHandlers();

(async () => {
  try {
    // Launch + connect FIRST so the Chrome window is open while we prompt — on the
    // first run you can log into MAL in that window before entering a username.
    const { page } = await launchChromeAndConnect();

    let username = await askQuestion(
      chalk.yellow(` 📝 Enter MAL username (default: ${CONFIG.defaultUsername}): `)
    );
    if (!username) {
      username = CONFIG.defaultUsername;
      console.log(chalk.blue(` 🔹 Using default username: ${username}`));
    }

    console.log(chalk.cyanBright(" 🚀 Fetching all friend profiles..."));
    const profileLinks = await fetchFriendProfileLinks(page, username);

    for (const profileUrl of profileLinks) {
      await processProfileLink(page, profileUrl);
      console.log(
        chalk.gray(` ⏳ Waiting ${CONFIG.delays.betweenProfiles / 1000}s before the next profile...`)
      );
      await sleep(CONFIG.delays.betweenProfiles);
    }

    console.log(chalk.bgGreen.black(" ✅ All friend requests sent! "));
  } catch (mainError) {
    process.exitCode = 1;
    console.error(chalk.bgRed.white(" ❌ Error in main: "), mainError);
  } finally {
    await closeBrowser("run finished");
  }
})();
