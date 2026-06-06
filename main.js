import chalk from "chalk";
import { sleep } from "./src/lib/utils.js";
import {
  CONFIG,
  launchChromeAndConnect,
  ensureLoggedIn,
  resolveUsername,
  fetchFriendProfileLinks,
  processProfileLink,
  closeBrowser,
  registerShutdownHandlers,
} from "./src/script.js";

// Load MAL_USERNAME / MAL_PASSWORD from .env (used for automatic login). Optional —
// if there's no .env, login falls back to manual.
try {
  process.loadEnvFile();
} catch {
  // no .env file present
}

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

    const total = profileLinks.length;
    for (let i = 0; i < total; i++) {
      await processProfileLink(page, profileLinks[i], i, total);
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
