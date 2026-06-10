const { chromium } = require("playwright");

const BOOKER_URL =
  "https://go.booker.com/location/AceofCups/service/4375234/%20%20%20Swedish%20Relaxation%20%20Massage%20(60%20Min)/availability/2026-05-15/all-providers";

async function inspectBooker() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const networkCalls = [];

  page.on("request", (request) => {
    const url = request.url();

    if (
      url.includes("booker") ||
      url.includes("availability") ||
      url.includes("service") ||
      url.includes("staff") ||
      url.includes("appointment") ||
      url.includes("api")
    ) {
      networkCalls.push({
        method: request.method(),
        url
      });
    }
  });

  console.log("\n[BOOKER] Opening URL...");

  await page.goto(BOOKER_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {
    console.log("[BOOKER] Load state timeout ignored.");
  });

  await page.waitForTimeout(8000);

  console.log("\n===== CURRENT URL =====");
  console.log(page.url());

  console.log("\n===== PAGE TITLE =====");
  console.log(await page.title());

  const bodyText = await page.locator("body").innerText().catch(() => "");

  console.log("\n===== BODY TEXT =====");
  console.log(bodyText.slice(0, 7000));

  const buttons = await page.locator("button").evaluateAll((els) =>
    els.map((el, index) => ({
      index,
      text: el.innerText,
      ariaLabel: el.getAttribute("aria-label"),
      disabled: el.disabled
    }))
  );

  console.log("\n===== BUTTONS =====");
  console.log(JSON.stringify(buttons, null, 2));

  const links = await page.locator("a").evaluateAll((els) =>
    els.map((el, index) => ({
      index,
      text: el.innerText,
      href: el.href
    }))
  );

  console.log("\n===== LINKS =====");
  console.log(JSON.stringify(links, null, 2));

  const timeRegex =
    /\b(1[0-2]|0?[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g;

  const timesFromText = bodyText.match(timeRegex) || [];

  console.log("\n===== TIMES FOUND FROM BODY TEXT =====");
  console.log([...new Set(timesFromText)]);

  console.log("\n===== NETWORK CALLS =====");
  console.log(JSON.stringify(networkCalls, null, 2));

  console.log("\n[BOOKER] Inspector complete.");

  await browser.close();
}

inspectBooker().catch((err) => {
  console.error("\n[BOOKER ERROR]");
  console.error(err);
});