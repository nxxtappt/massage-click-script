// inspectors/inspect-meevo-calendar.js
//
// Goal:
// Force Meevo Date/Calendar interaction
// and expose the real appointment slot endpoint.
//
// Usage:
// node inspectors/inspect-meevo-calendar.js "MEEVO_URL"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

const CATEGORY_SEARCH = "Swedish Massage";
const SERVICE_SEARCH = "1 Hour Swedish Massage";

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/inspect-meevo-calendar.js "MEEVO_URL"
`);
  process.exit(1);
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function endpointLooksUseful(url) {
  return /meevo\.com\/.*(availability|slot|time|calendar|schedule|openings|reserve|booking|appointment|week|day)/i.test(
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
  } catch (err) {
    console.log(`❌ Could not click ${text}: ${err.message}`);
    return false;
  }
}

async function clickButton(page, text) {
  try {
    const locator = page.locator("button").filter({
      hasText: new RegExp(`^\\s*${text}\\s*$`, "i")
    });

    if (!(await locator.count())) {
      console.log(`❌ Missing button: ${text}`);
      return false;
    }

    console.log(`✅ Clicking button: ${text}`);

    await locator.first().click({
      force: true,
      timeout: 7000
    });

    await page.waitForTimeout(3000);

    return true;
  } catch (err) {
    console.log(`❌ Could not click button ${text}: ${err.message}`);
    return false;
  }
}

async function clickLastText(page, text) {
  try {
    const locator = page.getByText(text, {
      exact: false
    });

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
  } catch (err) {
    console.log(`❌ Could not click last ${text}: ${err.message}`);
    return false;
  }
}

async function body(page) {
  return clean(
    await page.locator("body").innerText().catch(() => "")
  );
}

async function forceCalendarInteraction(page) {
  console.log("\n=== FORCING CALENDAR INTERACTION ===");

  // Scroll heavily first.
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(4000);

  // Try date/time headers.
  const labels = [
    "Date & Time",
    "Today",
    "Tomorrow",
    "Next Available",
    "Morning",
    "Afternoon",
    "Evening",
    "May"
  ];

  for (const label of labels) {
    await clickText(page, label, false);
    await page.waitForTimeout(2000);
  }

  // Click all visible calendar-ish elements.
  const selectors = [
    ".mat-calendar-body-cell",
    ".calendar-day",
    ".day",
    ".date",
    "mat-card",
    ".time-slot",
    ".appointment-slot"
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();

      console.log(`Selector ${selector} count:`, count);

      for (let i = 0; i < Math.min(count, 10); i++) {
        const item = locator.nth(i);

        const visible = await item.isVisible().catch(() => false);

        if (!visible) continue;

        const text = clean(
          await item.innerText().catch(() => "")
        );

        console.log(`Trying selector ${selector}:`, text);

        await item.click({
          force: true,
          timeout: 5000
        });

        await page.waitForTimeout(3000);
      }
    } catch {}
  }

  // Generic coordinate clicks near calendar region.
  const points = [
    [700, 500],
    [800, 500],
    [900, 500],
    [700, 600],
    [800, 600]
  ];

  for (const [x, y] of points) {
    console.log(`Coordinate click at ${x}, ${y}`);

    await page.mouse.click(x, y);

    await page.waitForTimeout(3000);
  }
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

    if (!endpointLooksUseful(url)) {
      return;
    }

    const method = response.request().method();
    const status = response.status();
    const postData = response.request().postData();

    let preview = null;

    try {
      const contentType = response.headers()["content-type"] || "";

      if (contentType.includes("application/json")) {
        const json = await response.json();

        preview = JSON.stringify(json, null, 2).slice(0, 6000);

        console.log("\n🔥 CALENDAR / AVAILABILITY RESPONSE");
        console.log("URL:", url);
        console.log("STATUS:", status);

        if (postData) {
          console.log("POST:");
          console.log(postData);
        }

        console.log("JSON:");
        console.log(preview);

        availabilityHits.push({
          url,
          method,
          status,
          postData,
          preview
        });
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

  // Accept cookies if present.
  await clickText(page, "Accept All", true);

  // Step 1.
  await clickText(page, "Next", true);

  // Category.
  await clickText(page, CATEGORY_SEARCH, false);

  // Service.
  await clickLastText(page, SERVICE_SEARCH);

  // Add-ons.
  const pageText = await body(page);

  if (
    pageText.includes("No, thanks") ||
    pageText.includes("Save")
  ) {
    const skipped = await clickButton(page, "No, thanks");

    if (!skipped) {
      await clickButton(page, "Save");
    }
  }

  await page.waitForTimeout(4000);

  // Proceed directly to Date & Time.
  await clickText(page, "Next", true);

  await page.waitForTimeout(10000);

  console.log("\n=== DATE/TIME STEP REACHED ===");

  const bodyText = await body(page);

  console.log(
    "Contains Date & Time:",
    bodyText.includes("Date & Time")
  );

  // IMPORTANT:
  // Now we aggressively force calendar interactions.
  await forceCalendarInteraction(page);

  await page.waitForTimeout(10000);

  const finalBody = await body(page);

  const visibleTimes =
    finalBody.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

  console.log("\nVISIBLE TIMES:");
  console.log([
    ...new Set(
      visibleTimes.map((t) => clean(t).toUpperCase())
    )
  ]);

  console.log("\nTOTAL AVAILABILITY HITS:");
  console.log(availabilityHits.length);

  await browser.close();

  console.log("\nDONE");
})();