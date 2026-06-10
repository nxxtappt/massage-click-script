// inspectors/inspect-meevo-availability.js
//
// Goal:
// Reach Meevo Date & Time step and capture the real availability endpoint.
//
// Usage:
// node inspectors/inspect-meevo-availability.js "MEEVO_URL"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

const CATEGORY_SEARCH = "Swedish Massage";
const SERVICE_SEARCH = "1 Hour Swedish Massage";

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/inspect-meevo-availability.js "MEEVO_URL"
`);
  process.exit(1);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulEndpoint(url) {
  return /meevo\.com\/.*(api|availability|appointment|slot|time|calendar|schedule|openings|reserve|booking|employee|service|day|week)/i.test(
    url
  );
}

async function clickText(page, text, exact = false) {
  try {
    const locator = page.getByText(text, { exact });

    if (!(await locator.count())) {
      console.log(`❌ Missing text: ${text}`);
      return false;
    }

    console.log(`✅ Clicking: ${text}`);

    await locator.first().click({
      force: true,
      timeout: 7000
    });

    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.log(`❌ Could not click ${text}: ${error.message}`);
    return false;
  }
}

async function clickLastText(page, text) {
  try {
    const locator = page.getByText(text, { exact: false });

    if (!(await locator.count())) {
      console.log(`❌ Missing text: ${text}`);
      return false;
    }

    console.log(`✅ Clicking last match: ${text}`);

    await locator.last().click({
      force: true,
      timeout: 7000
    });

    await page.waitForTimeout(4000);

    return true;
  } catch (error) {
    console.log(`❌ Could not click last match ${text}: ${error.message}`);
    return false;
  }
}

async function clickButton(page, text) {
  try {
    const button = page.locator("button").filter({
      hasText: new RegExp(`^\\s*${text}\\s*$`, "i")
    });

    if (!(await button.count())) {
      console.log(`❌ Missing button: ${text}`);
      return false;
    }

    console.log(`✅ Clicking button: ${text}`);

    await button.first().click({
      force: true,
      timeout: 7000
    });

    await page.waitForTimeout(3000);

    return true;
  } catch (error) {
    console.log(`❌ Could not click button ${text}: ${error.message}`);
    return false;
  }
}

async function getBody(page) {
  return cleanText(
    await page.locator("body").innerText().catch(() => "")
  );
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 1200
    }
  });

  const page = await context.newPage();

  const availabilityHits = [];

  page.on("response", async (response) => {
    const url = response.url();

    if (!isUsefulEndpoint(url)) {
      return;
    }

    const method = response.request().method();
    const status = response.status();
    const postData = response.request().postData();

    let jsonPreview = null;

    try {
      const contentType = response.headers()["content-type"] || "";

      if (contentType.includes("application/json")) {
        const json = await response.json();

        jsonPreview = JSON.stringify(json, null, 2).slice(0, 5000);

        const looksLikeAvailability =
          JSON.stringify(json).match(
            /(appointment|slot|availability|time|calendar|opening)/i
          );

        if (looksLikeAvailability) {
          console.log("\n🔥 AVAILABILITY-LIKE RESPONSE FOUND");
          console.log("URL:", url);
          console.log("STATUS:", status);

          if (postData) {
            console.log("POST:");
            console.log(postData);
          }

          console.log("JSON:");
          console.log(jsonPreview);

          availabilityHits.push({
            url,
            method,
            status,
            postData,
            jsonPreview
          });
        }
      }
    } catch {}
  });

  console.log("Opening:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(5000);

  // Cookies
  await clickText(page, "Accept All", true);

  // First Next
  await clickText(page, "Next", true);

  // Category
  await clickText(page, CATEGORY_SEARCH, false);

  // Service
  await clickLastText(page, SERVICE_SEARCH);

  // Add-ons
  const body = await getBody(page);

  if (
    body.includes("No, thanks") ||
    body.includes("Save") ||
    body.includes("Aromatherapy")
  ) {
    console.log("✅ Add-on screen detected");

    const skipped = await clickButton(page, "No, thanks");

    if (!skipped) {
      await clickButton(page, "Save");
    }
  }

  await page.waitForTimeout(5000);

  console.log("\n=== BEFORE NEXT TO DATE/TIME ===");

  const beforeBody = await getBody(page);

  console.log(
    "Next disabled:",
    beforeBody.includes("disabled-btn")
  );

  // IMPORTANT:
  // We now move directly to Date & Time.
  await clickText(page, "Next", true);

  await page.waitForTimeout(12000);

  console.log("\n=== AFTER NEXT TO DATE/TIME ===");

  const afterBody = await getBody(page);

  console.log(
    "Contains Date & Time:",
    afterBody.includes("Date & Time")
  );

  // Force lazy-load.
  console.log("Scrolling to activate calendar...");

  await page.mouse.wheel(0, 2000);

  await page.waitForTimeout(8000);

  // Click Date & Time header if present.
  await clickText(page, "Date & Time", false);

  await page.waitForTimeout(8000);

  // Final scan.
  const finalBody = await getBody(page);

  const times =
    finalBody.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

  console.log("\nVISIBLE TIMES:");
  console.log([
    ...new Set(times.map((t) => cleanText(t).toUpperCase()))
  ]);

  console.log("\nAVAILABILITY HIT COUNT:");
  console.log(availabilityHits.length);

  if (!availabilityHits.length) {
    console.log("\n⚠️ No availability endpoint found yet.");
    console.log("Next step would be intercepting fetch/XHR manually.");
  }

  await browser.close();

  console.log("\nDONE");
})();