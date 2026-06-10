const { chromium } = require("playwright");

const TARGET_URL =
  "https://www.vagaro.com/deepwavemassage";

function interesting(url) {
  const u = url.toLowerCase();

  return (
    u.includes("vagaro.com") &&
    (
      u.includes("asmx") ||
      u.includes("book") ||
      u.includes("appointment") ||
      u.includes("availability") ||
      u.includes("calendar") ||
      u.includes("schedule") ||
      u.includes("service") ||
      u.includes("employee") ||
      u.includes("staff") ||
      u.includes("provider") ||
      u.includes("timeslot") ||
      u.includes("slot")
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
      height: 1200
    }
  });

  page.on("request", (request) => {
    const url = request.url();

    if (!interesting(url)) {
      return;
    }

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

    if (!interesting(url)) {
      return;
    }

    console.log("\n================ RESPONSE ================");
    console.log(response.status(), url);

    try {
      const text = await response.text();

      if (
        text.toLowerCase().includes("massage") ||
        text.toLowerCase().includes("appointment") ||
        text.toLowerCase().includes("availability") ||
        text.toLowerCase().includes("calendar") ||
        text.toLowerCase().includes("service")
      ) {
        console.log("\nBODY SAMPLE:");
        console.log(text.slice(0, 12000));
      }
    } catch (e) {}
  });

  console.log("\nOPENING BUSINESS PAGE...");

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  console.log("\nPAGE URL:");
  console.log(page.url());

  await page.waitForTimeout(8000);

  // dump buttons
  const buttons = await page
    .locator("button")
    .allTextContents();

  console.log("\n=========== BUTTONS ===========");
  console.log(buttons.slice(0, 200));

  // click likely booking buttons
  const clickableTexts = [
    "Book",
    "Book Now",
    "Appointments",
    "Schedule",
    "Massage",
    "Continue"
  ];

  for (const text of clickableTexts) {
    try {
      const locator =
        page.getByText(text, { exact: false }).first();

      if (await locator.isVisible({ timeout: 3000 })) {
        console.log(`\nCLICKING: ${text}`);

        await locator.click({
          timeout: 5000
        });

        await page.waitForTimeout(8000);

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