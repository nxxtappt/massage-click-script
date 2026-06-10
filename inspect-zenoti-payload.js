const { chromium } = require("playwright");

const URL = process.argv[2];

async function clickText(page, text) {
  console.log(`[ZENOTI] Clicking: ${text}`);

  const locator = page.getByText(text, { exact: false }).first();

  await locator.click().catch(async () => {
    await locator.evaluate((el) => el.click());
  });

  await page.waitForTimeout(5000);
}

async function main() {
  if (!URL) {
    throw new Error("Missing URL");
  }

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1200 }
  });

  page.on("request", async (request) => {
    const url = request.url();

    if (
      url.includes("/Appointments/Availabletimes")
    ) {
      console.log("\n==============================");
      console.log("AVAILABLETIMES REQUEST FOUND");
      console.log("==============================\n");

      console.log("URL:");
      console.log(url);

      console.log("\nMETHOD:");
      console.log(request.method());

      console.log("\nHEADERS:");
      console.log(JSON.stringify(request.headers(), null, 2));

      console.log("\nPOST DATA:");
      console.log(request.postData());

      console.log("\n==============================\n");
    }
  });

  console.log("[ZENOTI] Opening:", URL);

  await page.goto(URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(8000);

  await clickText(page, "PERSONALIZED MASSAGE");

  await clickText(page, "60 Minute Massage");

  await page.waitForTimeout(15000);

  await browser.close();

  console.log("[ZENOTI] Done.");
}

main().catch((error) => {
  console.error("\n[ZENOTI PAYLOAD ERROR]");
  console.error(error);
  process.exit(1);
});