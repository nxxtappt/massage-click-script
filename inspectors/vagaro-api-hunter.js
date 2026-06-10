const { chromium } = require("playwright");

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

  const interestingPatterns = [
    "vagaro",
    "service",
    "appointment",
    "calendar",
    "schedule",
    "availability",
    "book",
    "listing",
    "search",
    "api",
    "ajax",
    "Get",
    "Search"
  ];

  function isInteresting(url) {
    const lower = url.toLowerCase();

    if (
      lower.includes("google") ||
      lower.includes("facebook") ||
      lower.includes("analytics") ||
      lower.includes("doubleclick") ||
      lower.includes("linkedin") ||
      lower.includes("pinterest") ||
      lower.includes("ads")
    ) {
      return false;
    }

    return interestingPatterns.some(pattern =>
      lower.includes(pattern.toLowerCase())
    );
  }

  page.on("request", request => {
    const url = request.url();

    if (!isInteresting(url)) return;

    console.log("\n================ REQUEST ================");
    console.log(request.method(), url);

    const body = request.postData();

    if (body) {
      console.log("\nPOST DATA:");
      console.log(body.slice(0, 8000));
    }
  });

  page.on("response", async response => {
    const url = response.url();

    if (!isInteresting(url)) return;

    console.log("\n================ RESPONSE ================");
    console.log(response.status(), url);

    try {
      const text = await response.text();

      const lower = text.toLowerCase();

      if (
        lower.includes("serviceid") ||
        lower.includes("availability") ||
        lower.includes("appointment") ||
        lower.includes("calendar") ||
        lower.includes("timeslot") ||
        lower.includes("employee") ||
        lower.includes("staff") ||
        lower.includes("massage")
      ) {
        console.log("\nBODY SAMPLE:");
        console.log(text.slice(0, 12000));
      }
    } catch (e) {}
  });

  console.log("\nOPENING VAGARO...");

  await page.goto(
    "https://www.vagaro.com/listings/massage/austin--tx?service=Swedish%20Massage%20-%2060%20minute",
    {
      waitUntil: "networkidle",
      timeout: 60000
    }
  );

  await page.waitForTimeout(15000);

  console.log("\nSCROLLING...");

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1200);
  }

  console.log("\nCLICKING BOOK BUTTONS...");

  const buttons = page.locator("button");

  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    try {
      const button = buttons.nth(i);

      const text = await button.innerText();

      if (
        text.includes("Book") ||
        text.includes("Continue") ||
        text.includes("Massage")
      ) {
        console.log(`\nCLICKING: ${text}`);

        await button.click({
          timeout: 3000
        });

        await page.waitForTimeout(6000);
      }
    } catch (e) {}
  }

  console.log("\nFINAL URL:");
  console.log(page.url());

  await page.screenshot({
    path: "vagaro-final-state.png",
    fullPage: true
  });

  await page.waitForTimeout(20000);

  await browser.close();
})();