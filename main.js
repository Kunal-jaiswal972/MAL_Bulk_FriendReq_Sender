import chalk from "chalk";
import { askQuestion } from "./src/lib/utils.js";
import { MalSession, registerShutdownHandlers } from "./src/script.js";

// Load MAL_USERNAME / MAL_PASSWORD / HEADLESS from .env (optional).
try {
  process.loadEnvFile();
} catch {
  // no .env file present
}

registerShutdownHandlers();

/** Renders a progress event as a colored console line. */
function logEvent(ev) {
  switch (ev.type) {
    case "start":
      console.log(chalk.cyanBright(` 🚀 Found ${ev.total} friends of ${ev.target}.`));
      break;
    case "visiting":
      console.log(chalk.cyan(` 🔗 Visiting profile (${ev.done}/${ev.total}): ${ev.url}`));
      break;
    case "completed":
      console.log(chalk.green(` ✅ Completed (${ev.done}/${ev.total}) — ${ev.status}`));
      break;
    case "done":
      console.log(chalk.bgGreen.black(" ✅ All friend requests processed! "));
      break;
  }
}

(async () => {
  const loginUsername = process.env.MAL_USERNAME || "default";
  const session = new MalSession(loginUsername);
  try {
    await session.launch();

    const result = await session.ensureLoggedIn({
      password: process.env.MAL_PASSWORD,
      allowManual: true, // CLI is interactive, so manual fallback is allowed
    });
    if (!result.ok) throw new Error(result.error);

    // Always prompt for the target username; default to the last one used.
    const stored = session.loadState().lastTarget;
    let target;
    while (!target) {
      const answer = await askQuestion(
        chalk.yellow(stored ? ` 📝 Enter MAL username (default: ${stored}): ` : " 📝 Enter MAL username: ")
      );
      target = answer || stored;
      if (!target) console.log(chalk.red(" ⚠️ A username is required — please enter one."));
    }
    session.saveState({ lastTarget: target });

    console.log(chalk.cyanBright(" 🚀 Fetching all friend profiles..."));
    for await (const ev of session.runFriendRequests(target)) {
      logEvent(ev);
    }
  } catch (mainError) {
    process.exitCode = 1;
    console.error(chalk.bgRed.white(" ❌ Error: "), mainError.message || mainError);
  } finally {
    await session.close();
  }
})();
