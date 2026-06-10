const { chromium } = require("playwright");

const TARGET_URL =
  "https://www.vagaro.com/listings/massage/austin--tx?service=Swedish%20Massage%20-%2060%20minute";

function isInteresting(url) {
  const u = url.toLowerCase();

  return (
    u.includes("vagaro.com") &&
    (
      u.includes("asmx") ||
      u.includes("availability") ||
      u.includes("appointment") ||
      u.includes("book") ||
      u.includes("schedule") ||
      u.includes("calendar") ||
      u.includes("service") ||
      u.includes("search") ||
      u.includes("listing")
    )
  );
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1800,
      height: 1200
    }
  });

  page.on("request", (request) => {
    const url = request.url();

    if (!isInteresting(url)) {
      return;
    }

    console.log("\n================ REQUEST ================");
    console.log(request.method(), url);

    const body = request.postData();

    if (body) {
      console.log("\nPOST BODY:");
      console.log(body.slice(0, 10000));
    }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (!isInteresting(url)) {
      return;
    }

    console.log("\n================ RESPONSE ================");
    console.log(response.status(), url);

    try {
      const contentType =
        response.headers()["content-type"] || "";

      if (
        contentType.includes("json") ||
        contentType.includes("text")
      ) {
        const text = await response.text();

        if (
          text.toLowerCase().includes("massage") ||
          text.toLowerCase().includes("availability") ||
          text.toLowerCase().includes("appointment") ||
          text.toLowerCase().includes("book") ||
          text.toLowerCase().includes("service")
        ) {
          console.log("\nBODY SAMPLE:");
          console.log(text.slice(0, 8000));
        }
      }
    } catch (e) {}
  });

  console.log("\nOPENING PAGE...");

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  console.log("\nPAGE LOADED:");
  console.log(page.url());

  await page.waitForTimeout(12000);

  // get visible buttons
  const buttons = await page
    .locator("button")
    .allTextContents();

  console.log("\n=========== BUTTONS ===========");
  console.log(buttons.slice(0, 200));

  // specifically click booking buttons
  const allButtons = page.locator("button");

  const count = await allButtons.count();

  console.log(`\nFOUND ${count} BUTTONS`);

  for (let i = 0; i < count; i++) {
    try {
      const button = allButtons.nth(i);

      const text = await button.innerText();

      if (
        text.includes("Book") ||
        text.includes(":00") ||
        text.includes(":15") ||
        text.includes(":30") ||
        text.includes(":45")
      ) {
        console.log(`\nCLICKING BUTTON: ${text}`);

        await button.click({
          timeout: 3000
        });

        await page.waitForTimeout(6000);

        console.log("\nURL AFTER CLICK:");
        console.log(page.url());
      }
    } catch (e) {}
  }

  console.log("\nFINAL URL:");
  console.log(page.url());

  await page.waitForTimeout(15000);

  await browser.close();
})();