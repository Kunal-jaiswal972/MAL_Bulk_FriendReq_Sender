import readline from "readline";
import isOnline from "is-online";
import chalk from "chalk";

/** Resolves after `ms` milliseconds. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let activeRl = null;

/** Prompts on the terminal and resolves with the trimmed answer. */
export const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  activeRl = rl;

  // Ctrl+C without this just pauses stdin (readline's default) — looks frozen.
  // Forward it so the app's shutdown handler can run.
  rl.on("SIGINT", () => {
    rl.close();
    activeRl = null;
    process.emit("SIGINT");
  });

  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      activeRl = null;
      rl.close();
      resolve(answer.trim());
    })
  );
};

/** Closes the active prompt (if any) and restores the terminal. */
export const closeActivePrompt = () => {
  if (activeRl) {
    activeRl.close();
    activeRl = null;
  }
};

/** Blocks until an internet connection is available, logging while it waits. */
export async function ensureOnline() {
  if (await isOnline()) return;
  console.log(chalk.yellow(" ⏳ Waiting for internet connection..."));
  while (!(await isOnline())) {
    await sleep(5000);
  }
  console.log(chalk.green(" ✅ Internet connection restored! Resuming..."));
}
