// inspectors/inspect-axl3-calendar.js

const { chromium } = require("playwright");

const TARGET_URL =
  process.argv[2] ||
  "https://booking.austindeep.com/tx/lake-austin-blvd/appointments/139";

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 1000
    }
  });

  const page = await context.newPage();

  const apiHits = [];

  page.on("response", async (response) => {
    const url = response.url();

    if (
      /appointment|availability|service|slot|provider|staff|employee|calendar|time|book|schedule|date/i.test(
        url
      )
    ) {
      console.log("\n============= API HIT =============");
      console.log(response.status(), response.request().method(), url);

      try {
        const contentType = response.headers()["content-type"] || "";

        if (contentType.includes("json")) {
          const json = await response.json();

          console.log(
            JSON.stringify(json, null, 2).slice(0, 12000)
          );
        }
      } catch {}

      apiHits.push({
        status: response.status(),
        method: response.request().method(),
        url
      });
    }
  });

  console.log("Opening:", TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(5000);

  console.log("\nCLICKING FIRST AVAILABLE DATE");

  // try clicking any active day number
  const dayButtons = page.locator(
    ".ui-datepicker-calendar td a"
  );

  const dayCount = await dayButtons.count();

  console.log("DAY COUNT:", dayCount);

  if (dayCount > 0) {
    await dayButtons.first().click();
  } else {
    console.log("No calendar day buttons found.");
  }

  await page.waitForTimeout(3000);

  console.log("\nCLICKING CONTINUE");

  const continueButton = page.locator("text=Continue");

  if ((await continueButton.count()) > 0) {
    await continueButton.first().click();
  } else {
    console.log("Continue button not found.");
  }

  await page.waitForTimeout(8000);

  console.log("\nCURRENT URL:");
  console.log(page.url());

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  console.log("\n================ BODY TEXT ================\n");

  console.log(bodyText.slice(0, 30000));

  console.log("\n================ TIME MATCHES ================\n");

  const times =
    bodyText.match(
      /\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g
    ) || [];

  console.log([...new Set(times)]);

  console.log("\n================ BUTTONS ================\n");

  const buttons = page.locator("button, a");

  const buttonCount = await buttons.count();

  for (let i = 0; i < Math.min(buttonCount, 250); i++) {
    const button = buttons.nth(i);

    let text = "";
    let href = null;

    try {
      text = cleanText(await button.innerText());
    } catch {}

    try {
      href = await button.getAttribute("href");
    } catch {}

    if (text || href) {
      console.log({
        index: i,
        text,
        href
      });
    }
  }

  console.log("\n================ API SUMMARY ================\n");

  console.log(JSON.stringify(apiHits, null, 2));

  await browser.close();

  console.log("\nDONE");
})();