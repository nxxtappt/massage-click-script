// inspectors/inspect-meevo-api.js

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/inspect-meevo-api.js "MEEVO_BOOKING_URL"
`);
  process.exit(1);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1000
    }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (
      /api|availability|service|provider|employee|appointment|time|slot|book/i.test(
        url
      )
    ) {
      console.log("\n==================================================");
      console.log("API RESPONSE");
      console.log("==================================================");

      console.log("STATUS:", response.status());
      console.log("URL:", url);

      try {
        const contentType =
          response.headers()["content-type"] || "";

        console.log("CONTENT TYPE:", contentType);

        if (contentType.includes("application/json")) {
          const json = await response.json();

          console.log(
            JSON.stringify(json, null, 2).slice(0, 12000)
          );
        } else {
          const text = await response.text();

          console.log(text.slice(0, 4000));
        }
      } catch (error) {
        console.log("Could not parse response:", error.message);
      }
    }
  });

  console.log("\nOpening:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(8000);

  console.log("\n==================================================");
  console.log("PAGE TITLE");
  console.log("==================================================");

  console.log(await page.title());

  console.log("\n==================================================");
  console.log("BODY TEXT SAMPLE");
  console.log("==================================================");

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  console.log(bodyText.slice(0, 8000));

  console.log("\n==================================================");
  console.log("BUTTONS");
  console.log("==================================================");

  const buttons = page.locator("button");

  const buttonCount = await buttons.count();

  for (let i = 0; i < Math.min(buttonCount, 50); i++) {
    const button = buttons.nth(i);

    const text = cleanText(
      await button.innerText().catch(() => "")
    );

    const className = await button
      .getAttribute("class")
      .catch(() => null);

    console.log({
      index: i,
      text,
      className
    });
  }

  console.log("\n==================================================");
  console.log("TRYING AUTO CLICKS");
  console.log("==================================================");

  const clickTargets = [
    "Massage",
    "massage",
    "Services",
    "Continue",
    "Next",
    "Book",
    "Book Now"
  ];

  for (const target of clickTargets) {
    try {
      const locator = page.getByText(target, {
        exact: false
      });

      const count = await locator.count();

      if (count > 0) {
        console.log(`Clicking: ${target}`);

        await locator.first().click({
          timeout: 3000
        });

        await page.waitForTimeout(4000);
      }
    } catch (error) {
      console.log(`Could not click ${target}`);
    }
  }

  console.log("\n==================================================");
  console.log("FINAL BODY SAMPLE");
  console.log("==================================================");

  const finalText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  console.log(finalText.slice(0, 12000));

  await browser.close();

  console.log("\n==================================================");
  console.log("DONE");
  console.log("==================================================");
})();