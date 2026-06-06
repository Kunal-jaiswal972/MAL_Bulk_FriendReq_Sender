import readline from "readline";
import isOnline from "is-online";
import chalk from "chalk";

export const sleep = (time) =>
  new Promise((resolve) => setTimeout(resolve, time));

let activeRl = null;

export const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  activeRl = rl;

  // Without an explicit 'SIGINT' listener, readline's default on Ctrl+C is to just
  // PAUSE stdin (no signal is raised), which looks like a frozen terminal. Close
  // the prompt — restoring the terminal — and forward to the process handler so the
  // app can close Chrome and exit cleanly.
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

// Closes the active prompt (if any) and restores the terminal. Used on shutdown.
export const closeActivePrompt = () => {
  if (activeRl) {
    activeRl.close();
    activeRl = null;
  }
};

export async function waitForInternet() {
  console.log(chalk.yellow("⏳ Waiting for internet connection..."));
  while (!(await isOnline())) {
    await sleep(5000);
  }
  console.log(
    chalk.green("✅ Internet connection restored! Resuming execution...")
  );
}
