import chalk from "chalk";
import { sleep } from "./lib/utils.js";
import {
  CONFIG,
  launchChromeAndConnect,
  ensureLoggedIn,
  resolveUsername,
  fetchFriendProfileLinks,
  processProfileLink,
  closeBrowser,
  registerShutdownHandlers,
} from "./script.js";

// Close Chrome on Ctrl+C / termination, not just on normal completion.
registerShutdownHandlers();

(async () => {
  try {
    const { page } = await launchChromeAndConnect();

    // First run: log into MAL. Later runs skip straight to the request flow.
    await ensureLoggedIn(page);

    const username = await resolveUsername();

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
