import readline from "readline";
import isOnline from "is-online";

export const sleep = (time) =>
  new Promise((resolve) => setTimeout(resolve, time));

export const askQuestion = (query) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
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
