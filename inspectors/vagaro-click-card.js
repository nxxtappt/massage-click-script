const { chromium } = require("playwright");

const TARGET_URL =
  "https://www.vagaro.com/listings/massage/austin--tx?service=Swedish%20Massage%20-%2060%20minute";

function interesting(url) {
  const u = url.toLowerCase();

  return (
    u.includes("vagaro.com") &&
    (
      u.includes("asmx") ||
      u.includes("availability") ||
      u.includes("appointment") ||
      u.includes("book") ||
      u.includes("calendar") ||
      u.includes("schedule") ||
      u.includes("service") ||
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
      width: 1600,
      height: 1400
    }
  });

  page.on("request", (request) => {
    const url = request.url();

    if (!interesting(url)) return;

    console.log("\n================ REQUEST ================");
    console.log(request.method(), url);

    const body = request.postData();

    if (body) {
      console.log("\nPOST BODY:");
      console.log(body.slice(0, 12000));
    }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (!interesting(url)) return;

    console.log("\n================ RESPONSE ================");
    console.log(response.status(), url);

    try {
      const text = await response.text();

      if (
        text.toLowerCase().includes("massage") ||
        text.toLowerCase().includes("appointment") ||
        text.toLowerCase().includes("availability") ||
        text.toLowerCase().includes("service") ||
        text.toLowerCase().includes("calendar")
      ) {
        console.log("\nBODY SAMPLE:");
        console.log(text.slice(0, 12000));
      }
    } catch (e) {}
  });

  console.log("\nOPENING MARKETPLACE...");

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  await page.waitForTimeout(12000);

  // scroll down so cards fully render
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(1500);
  }

  console.log("\nLOOKING FOR BUSINESS CARD LINKS...");

  const links = page.locator('a[href*="vagaro.com/"]');

  const count = await links.count();

  console.log(`FOUND ${count} LINKS`);

  for (let i = 0; i < count; i++) {
    try {
      const link = links.nth(i);

      const href = await link.getAttribute("href");
      const text = await link.innerText();

      if (
        href &&
        !href.includes("/listings/") &&
        !href.includes("/photos/") &&
        !href.includes("/deals/") &&
        !href.includes("/professionals/") &&
        text &&
        text.trim().length > 0
      ) {
        console.log("\nCLICKING BUSINESS:");
        console.log(text);
        console.log(href);

        await link.click({
          timeout: 5000
        });

        await page.waitForTimeout(12000);

        console.log("\nURL AFTER CLICK:");
        console.log(page.url());

        // click book buttons if they appear
        const buttons = page.locator("button");

        const buttonCount = await buttons.count();

        for (let j = 0; j < buttonCount; j++) {
          try {
            const button = buttons.nth(j);

            const buttonText =
              await button.innerText();

            if (
              buttonText.includes("Book") ||
              buttonText.includes("Continue") ||
              buttonText.includes("Massage")
            ) {
              console.log(
                `\nCLICKING BUTTON: ${buttonText}`
              );

              await button.click({
                timeout: 3000
              });

              await page.waitForTimeout(8000);
            }
          } catch (e) {}
        }

        break;
      }
    } catch (e) {}
  }

  console.log("\nFINAL URL:");
  console.log(page.url());

  await page.waitForTimeout(20000);

  await browser.close();
})();