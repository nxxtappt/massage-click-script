const { chromium } = require("playwright");

const START_URL =
  "https://www.massageenvy.com/scheduling/css?clinicId=0144&services=[{%22primaryServiceId%22:%22MSRELX60%22}]";

const AVAILABILITY_URL =
  "https://www.massageenvy.com/scheduling/check-multiple-availability";

const POST_BODY =
  "start_date=6%2F1%2F2026&end_date=6%2F30%2F2026&serviceId=cd9a39ff-8957-4fac-b50a-b3ca0129c3e4&todayDate=2026-06-04&mainServiceId=0850ecc2-916f-4845-9e3e-b3ca01293cbf";

async function run() {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  console.log("Opening scheduling session...");
  await page.goto(START_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  console.log("Posting availability request inside browser context...");

  const result = await page.evaluate(
    async ({ AVAILABILITY_URL, POST_BODY }) => {
      const response = await fetch(AVAILABILITY_URL, {
        method: "POST",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Apikey": "63D20FB6-DBC2-47EE-AB58-58E8EB29089A",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: POST_BODY,
        credentials: "same-origin"
      });

      const text = await response.text();

      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        text
      };
    },
    { AVAILABILITY_URL, POST_BODY }
  );

  console.log(JSON.stringify(result, null, 2));

  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});