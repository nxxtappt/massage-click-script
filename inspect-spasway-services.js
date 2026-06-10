const { chromium } = require("playwright");

async function clickText(page, text) {
  console.log(`[INSPECT] Clicking: ${text}`);

  const locator = page.getByText(text, { exact: false }).first();
  const count = await page.getByText(text, { exact: false }).count().catch(() => 0);

  console.log(`[INSPECT] Matches for "${text}": ${count}`);

  if (!count) return false;

  await locator.click().catch(async () => {
    await locator.evaluate((el) => el.click());
  });

  await page.waitForTimeout(10000);
  return true;
}

async function main() {
  const url =
    "https://spasway.zenoti.com/webstoreNew/services/c38f70e5-dace-4a1d-ae17-78b23cd1c39b";

  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1200 }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (url.includes("/api/Catalog/Services/?")) {
      console.log("\n===== SERVICE API RESPONSE =====");
      console.log(url);

      try {
        const json = await response.json();
        console.log(JSON.stringify(json, null, 2).slice(0, 30000));
      } catch (error) {
        console.log("Could not parse service response JSON.");
      }
    }
  });

  console.log("[INSPECT] Opening Spa Sway");
  await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(10000);

  await clickText(page, "MASSAGES");

  const links = await page.locator("a").evaluateAll((links) =>
    links
      .map((link) => ({
        text: link.innerText.trim(),
        href: link.href
      }))
      .filter((link) => link.text || link.href)
  );

  console.log("\n===== LINKS AFTER MASSAGES CLICK =====");
  console.log(JSON.stringify(links, null, 2));

  await page.screenshot({
    path: "spasway-after-massages.png",
    fullPage: true
  });

  console.log("\nScreenshot saved: spasway-after-massages.png");

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});