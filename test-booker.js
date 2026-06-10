const { chromium } = require("playwright");

async function testBooker() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  const bookingUrl =
    "https://go.booker.com/location/AceofCups/service/4375234/%20%20%20Swedish%20Relaxation%20%20Massage%20(60%20Min)/availability/2026-05-15/all-providers";

  console.log("\n[BOOKER] Opening booking page...");

  await page.goto(bookingUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(6000);

  const bodyText = await page.locator("body").innerText();

  console.log("\n===== PAGE TEXT =====");
  console.log(bodyText.slice(0, 4000));

  const buttons = await page.locator("button").evaluateAll((els) =>
    els.map((el) => ({
      text: el.innerText.trim(),
      disabled: el.disabled
    }))
  );

  console.log("\n===== BUTTONS =====");
  console.log(JSON.stringify(buttons, null, 2));

  const possibleTimes = buttons
    .map((b) => b.text)
    .filter((text) =>
      /^([1-9]|1[0-2]):[0-5][0-9]\s?(am|pm)$/i.test(text)
    );

  console.log("\n===== TIMES FOUND =====");
  console.log(possibleTimes);

  console.log("\n===== NORMALIZED RESULT =====");

  console.log(
    JSON.stringify(
      {
        businessName: "Ace of Cups Massage and Wellness",
        bookingUrl,
        platform: "booker",
        service: "Swedish Relaxation Massage (60 Min)",
        provider: null,
        date: "2026-05-15",
        times: possibleTimes,
        status:
          possibleTimes.length > 0
            ? "success"
            : "no_times_found",
        scrapeDurationMs: null,
        lastChecked: new Date().toISOString()
      },
      null,
      2
    )
  );

  await browser.close();
}

testBooker().catch((err) => {
  console.error("\n[BOOKER TEST ERROR]");
  console.error(err);
});