const { chromium } = require("playwright");

async function safeText(page) {
  return await page.locator("body").innerText().catch(() => "");
}

async function printLinks(page, label) {
  const links = await page.locator("a").evaluateAll((links) =>
    links
      .map((link) => ({
        text: link.innerText.trim(),
        href: link.href
      }))
      .filter((link) => link.text || link.href)
  ).catch(() => []);

  console.log(`\n===== LINKS: ${label} =====\n`);
  console.log(JSON.stringify(links, null, 2));
}

async function printButtons(page, label) {
  const buttons = await page.locator("button").evaluateAll((buttons) =>
    buttons
      .map((button) => button.innerText.trim())
      .filter(Boolean)
  ).catch(() => []);

  console.log(`\n===== BUTTONS: ${label} =====\n`);
  console.log(buttons);
}

async function clickText(page, text) {
  console.log(`\n[ZENOTI] Trying to click: ${text}`);

  const locator = page.getByText(text, { exact: false }).first();

  const count = await page.getByText(text, { exact: false }).count();

  console.log(`[ZENOTI] Matches found for "${text}":`, count);

  if (!count) return false;

  await locator.click({ timeout: 15000 }).catch(async () => {
    await locator.evaluate((el) => el.click());
  });

  await page.waitForTimeout(5000);
  return true;
}

async function inspectZenoti(url) {
  if (!url) {
    throw new Error("Missing Zenoti URL. Run: node inspect-zenoti.js \"URL_HERE\"");
  }

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1200 }
  });

  page.on("response", async (response) => {
    const requestUrl = response.url();

    if (
      requestUrl.toLowerCase().includes("service") ||
      requestUrl.toLowerCase().includes("appointment") ||
      requestUrl.toLowerCase().includes("availability") ||
      requestUrl.toLowerCase().includes("slot") ||
      requestUrl.toLowerCase().includes("catalog") ||
      requestUrl.toLowerCase().includes("webstore")
    ) {
      console.log("[NETWORK]", response.status(), requestUrl);
    }
  });

  console.log("[ZENOTI] Opening:", url);

  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(8000);

  console.log("\n===== PAGE TEXT: INITIAL =====\n");
  console.log((await safeText(page)).slice(0, 12000));

  await printButtons(page, "INITIAL");
  await printLinks(page, "INITIAL");

  await page.screenshot({
    path: "zenoti-initial.png",
    fullPage: true
  });

  const categoryClicks = [
    "PERSONALIZED MASSAGE",
    "SPECIALTY MASSAGE",
    "FIRST-TIME GUESTS",
    "THERAPEUTIC FACIAL"
  ];

  for (const category of categoryClicks) {
    const clicked = await clickText(page, category);

    if (clicked) {
      console.log(`\n===== PAGE TEXT AFTER CLICKING ${category} =====\n`);
      console.log((await safeText(page)).slice(0, 16000));

      await printButtons(page, `AFTER ${category}`);
      await printLinks(page, `AFTER ${category}`);

      await page.screenshot({
        path: `zenoti-after-${category.toLowerCase().replaceAll(" ", "-")}.png`,
        fullPage: true
      });
    }
  }

  await browser.close();

  console.log("\n[ZENOTI] Done.");
  console.log("[ZENOTI] Screenshots saved:");
  console.log("- zenoti-initial.png");
  console.log("- zenoti-after-personalized-massage.png");
  console.log("- zenoti-after-specialty-massage.png");
  console.log("- zenoti-after-first-time-guests.png");
  console.log("- zenoti-after-therapeutic-facial.png");
}

inspectZenoti(process.argv[2]).catch((error) => {
  console.error("\n[ZENOTI INSPECT ERROR]");
  console.error(error);
  process.exit(1);
});