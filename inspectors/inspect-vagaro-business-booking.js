// inspectors/inspect-vagaro-business-booking.js

const { chromium } = require("playwright");

const TEST_URL =
  process.argv[2] || "https://www.vagaro.com/austinlivingmassage";

function looksUsefulRequest(url) {
  const lower = url.toLowerCase();

  return (
    lower.includes("vagaro") &&
    (
      lower.includes("service") ||
      lower.includes("calendar") ||
      lower.includes("appointment") ||
      lower.includes("booking") ||
      lower.includes("employee") ||
      lower.includes("availability") ||
      lower.includes("pageMethodsProxyJson".toLowerCase()) ||
      lower.includes("asmx") ||
      lower.includes("api")
    )
  );
}

async function safeText(page) {
  try {
    return await page.locator("body").innerText({ timeout: 5000 });
  } catch {
    return "";
  }
}

async function clickLikelyBookingButtons(page) {
  const candidates = [
    "Book Now",
    "Book",
    "Services",
    "Massage",
    "Swedish",
    "60",
    "Next",
    "Continue"
  ];

  for (const text of candidates) {
    try {
      const locator = page.getByText(text, { exact: false }).first();
      if (await locator.count()) {
        console.log(`\nCLICKING POSSIBLE BUTTON/TEXT: ${text}`);
        await locator.click({ timeout: 4000 });
        await page.waitForTimeout(2500);
      }
    } catch (err) {
      console.log(`Could not click "${text}": ${err.message}`);
    }
  }
}

async function main() {
  console.log(`Inspecting Vagaro business page: ${TEST_URL}`);

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 1200 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  const usefulRequests = [];
  const usefulResponses = [];

  page.on("request", (request) => {
    const url = request.url();
    if (looksUsefulRequest(url)) {
      usefulRequests.push({
        method: request.method(),
        url,
        postData: request.postData()
      });
    }
  });

  page.on("response", async (response) => {
    const url = response.url();

    if (!looksUsefulRequest(url)) return;

    let bodyPreview = "";

    try {
      const contentType = response.headers()["content-type"] || "";
      if (
        contentType.includes("json") ||
        contentType.includes("text") ||
        url.includes("asmx")
      ) {
        const text = await response.text();
        bodyPreview = text.slice(0, 3000);
      }
    } catch {
      bodyPreview = "[Could not read response body]";
    }

    usefulResponses.push({
      status: response.status(),
      url,
      bodyPreview
    });
  });

  await page.goto(TEST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  console.log("\n===== INITIAL PAGE TEXT SAMPLE =====");
  console.log((await safeText(page)).slice(0, 5000));

  console.log("\n===== LINKS =====");
  const links = await page.$$eval("a", (items) =>
    items.slice(0, 100).map((a) => ({
      text: (a.innerText || "").trim(),
      href: a.href
    }))
  );
  console.log(JSON.stringify(links, null, 2));

  console.log("\n===== BUTTONS =====");
  const buttons = await page.$$eval("button", (items) =>
    items.slice(0, 100).map((b) => ({
      text: (b.innerText || "").trim(),
      ariaLabel: b.getAttribute("aria-label"),
      type: b.getAttribute("type"),
      disabled: b.disabled
    }))
  );
  console.log(JSON.stringify(buttons, null, 2));

  await clickLikelyBookingButtons(page);

  console.log("\n===== PAGE TEXT AFTER CLICKS =====");
  console.log((await safeText(page)).slice(0, 8000));

  console.log("\n===== USEFUL REQUESTS =====");
  console.log(JSON.stringify(usefulRequests, null, 2));

  console.log("\n===== USEFUL RESPONSES =====");
  console.log(JSON.stringify(usefulResponses, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error("Inspector failed:", err);
  process.exit(1);
});