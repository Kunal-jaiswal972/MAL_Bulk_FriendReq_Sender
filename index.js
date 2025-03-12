import puppeteer from "puppeteer-core";
import chalk from "chalk";

const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

(async () => {
  try {
    const browser = await puppeteer.connect({
      browserWSEndpoint:
        "ws://127.0.0.1:9222/devtools/browser/ec0aca69-5a73-4761-8f7d-a97d995e8351",
    });

    const page = await browser.newPage();

    const { width, height } = await page.evaluate(() => ({
      width: window.screen.width,
      height: window.screen.height,
    }));
    await page.setViewport({ width, height });

    const userName = "EdySilva";
    const friendsPage = `https://myanimelist.net/profile/${userName}/friends`;

    console.log(chalk.blue(`📌 Visiting Friends List: ${friendsPage}`));
    await page.goto(friendsPage, { waitUntil: "domcontentloaded" });

    await sleep(2000);

    const hrefs = await page.evaluate(() => {
      return Array.from(
        document.querySelectorAll(".di-tc.va-t.pl8.data .title a")
      ).map((a) => a.href);
    });

    console.log(chalk.green(`✅ Extracted ${hrefs.length} Profile Links.`));

    for (const href of hrefs) {
      try {
        console.log(chalk.cyan(`🔗 Visiting Profile: ${href}`));
        await page.goto(href, { waitUntil: "domcontentloaded" });

        await sleep(2000);

        const friendLink = await page.evaluate(() => {
          const friendBtn = document.querySelector("a#request");
          return friendBtn ? friendBtn.href : null;
        });

        if (friendLink) {
          console.log(
            chalk.blue(`📌 Navigating to Add Friend Page: ${friendLink}`)
          );
          await page.goto(friendLink, { waitUntil: "domcontentloaded" });

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
              chalk.green(`✅ Friend request sent successfully for ${href}`)
            );
            console.log(
              chalk.yellow(
                "⏳ Waiting 30 seconds before sending next request..."
              )
            );
            await sleep(30000);
          } else {
            console.log(
              chalk.red(`⚠️ Friend request button not found for ${href}`)
            );
          }
        } else {
          console.log(chalk.magenta(`❌ No Add Friend link found on ${href}`));
        }
      } catch (profileError) {
        console.error(
          chalk.red(`❌ Error visiting profile ${href}:`),
          profileError
        );
      }
    }

    console.log(chalk.green("✅ All friend requests sent! Disconnecting..."));
    browser.disconnect();
  } catch (mainError) {
    console.error(chalk.red("❌ Error in main function:"), mainError);
  }
})();
