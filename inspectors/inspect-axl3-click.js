// inspectors/inspect-axl3-click.js

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.log(`
Usage:

node inspectors/inspect-axl3-click.js "BOOKING_URL"
`);
  process.exit(1);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function dumpButtons(page) {
  console.log("\n================ BUTTONS ================");

  const buttons = page.locator("button, a");

  const count = await buttons.count();

  for (let i = 0; i < Math.min(count, 200); i++) {
    const item = buttons.nth(i);

    let text = "";
    let href = null;

    try {
      text = cleanText(await item.innerText());
    } catch {}

    try {
      href = await item.getAttribute("href");
    } catch {}

    if (text || href) {
      console.log({
        index: i,
        text,
        href
      });
    }
  }
}

async function dumpBody(page) {
  console.log("\n================ BODY TEXT ================\n");

  const text = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  console.log(text.slice(0, 25000));

  return text;
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
      /appointment|availability|service|slot|provider|staff|employee|calendar|time|book|schedule|api/i.test(
        url
      )
    ) {
      console.log("\n============= API HIT =============");
      console.log(response.status(), response.request().method(), url);

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

  await page.waitForTimeout(3000);

  console.log("\nLooking for THE DEEP™60MIN...");

  const sixtyButton = page.locator("text=THE DEEP™60MIN");

  await sixtyButton.first().click();

  console.log("\nClicked THE DEEP™60MIN");

  await page.waitForTimeout(7000);

  console.log("\nCURRENT URL:");
  console.log(page.url());

  await dumpBody(page);

  await dumpButtons(page);

  console.log("\n================ TIME MATCHES ================\n");

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  const times =
    bodyText.match(
      /\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g
    ) || [];

  console.log([...new Set(times)]);

  console.log("\n================ API SUMMARY ================\n");

  console.log(JSON.stringify(apiHits, null, 2));

  console.log("\nDONE");

})();