const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const START_URL =
  "https://www.massageenvy.com/scheduling/css?clinicId=0144&services=[{%22primaryServiceId%22:%22MSRELX60%22}]";

const OUT_FILE = path.join(__dirname, "massage-envy-real-flow.json");

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();
  const logs = [];

  page.on("response", async (response) => {
    const url = response.url();

    if (!url.includes("/scheduling/check-multiple-availability")) {
      return;
    }

    let text = "";

    try {
      text = await response.text();
    } catch {}

    const entry = {
      url,
      status: response.status(),
      headers: response.headers(),
      bodyPreview: text.slice(0, 50000),
      timestamp: new Date().toISOString()
    };

    logs.push(entry);
    fs.writeFileSync(OUT_FILE, JSON.stringify(logs, null, 2));

    console.log("\n[CAPTURED AVAILABILITY RESPONSE]");
    console.log(JSON.stringify(entry, null, 2));
  });

  page.on("request", (request) => {
    const url = request.url();

    if (!url.includes("/scheduling/check-multiple-availability")) {
      return;
    }

    const entry = {
      type: "request",
      method: request.method(),
      url,
      headers: request.headers(),
      postData: request.postData(),
      timestamp: new Date().toISOString()
    };

    logs.push(entry);
    fs.writeFileSync(OUT_FILE, JSON.stringify(logs, null, 2));

    console.log("\n[CAPTURED AVAILABILITY REQUEST]");
    console.log(JSON.stringify(entry, null, 2));
  });

  console.log("Opening:");
  console.log(START_URL);

  await page.goto(START_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(4000);

  console.log("Current URL:", page.url());

  console.log("Trying to move through preselected service flow...");

  const possibleContinueButtons = [
    /continue/i,
    /next/i,
    /book/i,
    /find appointments/i,
    /see times/i
  ];

  for (let i = 0; i < 5; i++) {
    const pageText = await page.locator("body").innerText().catch(() => "");

    console.log(`\n--- STEP ${i + 1} ---`);
    console.log(pageText.slice(0, 1000));

    if (/appointment|availability|select a date|choose a date|morning|afternoon|evening/i.test(pageText)) {
      console.log("Looks like appointment/calendar page may be visible.");
    }

    let clicked = false;

    if (/60\s*min/i.test(pageText)) {
      try {
        await page.getByText(/60\s*min/i).first().click({ timeout: 5000 });
        console.log("Clicked 60 min.");
        clicked = true;
        await page.waitForTimeout(2000);
      } catch {}
    }

    if (!clicked) {
      for (const pattern of possibleContinueButtons) {
        try {
          const button = page.getByRole("button", { name: pattern }).first();

          if ((await button.count()) > 0) {
            await button.click({ timeout: 5000 });
            console.log(`Clicked button: ${pattern}`);
            clicked = true;
            break;
          }
        } catch {}

        try {
          const link = page.getByRole("link", { name: pattern }).first();

          if ((await link.count()) > 0) {
            await link.click({ timeout: 5000 });
            console.log(`Clicked link: ${pattern}`);
            clicked = true;
            break;
          }
        } catch {}
      }
    }

    await page.waitForLoadState("domcontentloaded").catch(() => null);
    await page.waitForTimeout(4000);

    if (!clicked) {
      console.log("No obvious next click found.");
    }
  }

  console.log("\nWaiting 15 seconds for availability calls...");
  await page.waitForTimeout(15000);

  fs.writeFileSync(OUT_FILE, JSON.stringify(logs, null, 2));

  console.log("\nSaved:");
  console.log(OUT_FILE);

  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});