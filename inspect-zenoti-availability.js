const { chromium } = require("playwright");

const URL = process.argv[2];

async function clickText(page, text) {
  console.log(`[ZENOTI] Clicking text: ${text}`);

  const locator = page.getByText(text, { exact: false }).first();
  const count = await page.getByText(text, { exact: false }).count();

  console.log(`[ZENOTI] Found ${count} match(es) for "${text}"`);

  if (!count) {
    throw new Error(`Could not find text: ${text}`);
  }

  await locator.click({ timeout: 15000 }).catch(async () => {
    await locator.evaluate((el) => el.click());
  });

  await page.waitForTimeout(6000);
}

async function main() {
  if (!URL) {
    throw new Error("Missing URL. Run: node inspect-zenoti-availability.js \"URL_HERE\"");
  }

  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1200 }
  });

  page.on("response", async (response) => {
    const requestUrl = response.url();
    const lower = requestUrl.toLowerCase();

    const interesting =
      lower.includes("appointment") ||
      lower.includes("availability") ||
      lower.includes("slot") ||
      lower.includes("book") ||
      lower.includes("calendar") ||
      lower.includes("service") ||
      lower.includes("employee") ||
      lower.includes("therapist");

    if (!interesting) return;

    console.log("\n[NETWORK]", response.status(), requestUrl);

    try {
      const contentType = response.headers()["content-type"] || "";

      if (contentType.includes("application/json")) {
        const json = await response.json();
        console.log("[JSON RESPONSE]");
        console.log(JSON.stringify(json, null, 2).slice(0, 12000));
      }
    } catch (error) {
      // ignore bad json reads
    }
  });

  console.log("[ZENOTI] Opening:", URL);

  await page.goto(URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(8000);

  await clickText(page, "PERSONALIZED MASSAGE");

  await page.screenshot({
    path: "zenoti-before-service-click.png",
    fullPage: true
  });

  await clickText(page, "60 Minute Massage");

  await page.waitForTimeout(12000);

  await page.screenshot({
    path: "zenoti-after-60-minute-click.png",
    fullPage: true
  });

  const bodyText = await page.locator("body").innerText().catch(() => "");

  console.log("\n===== FINAL BODY TEXT =====\n");
  console.log(bodyText.slice(0, 12000));

  console.log("\n[ZENOTI] Done.");
  console.log("[ZENOTI] Screenshots saved:");
  console.log("- zenoti-before-service-click.png");
  console.log("- zenoti-after-60-minute-click.png");

  await browser.close();
}

main().catch((error) => {
  console.error("\n[ZENOTI AVAILABILITY INSPECT ERROR]");
  console.error(error);
  process.exit(1);
});