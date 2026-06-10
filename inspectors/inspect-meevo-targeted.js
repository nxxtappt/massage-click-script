// inspectors/inspect-meevo-targeted.js
//
// Goal:
// Minimal Meevo inspector to reach Date & Time and expose the availability endpoint.
//
// Usage:
// node inspectors/inspect-meevo-targeted.js "MEEVO_URL"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

const CATEGORY_SEARCH = "Swedish Massage";
const SERVICE_SEARCH = "1 Hour Swedish Massage";

// IMPORTANT:
// Since "Any Therapist" is not triggering Meevo's internal selection state,
// we are now testing with a real therapist card first.
const TARGET_THERAPIST_NAMES = [
  "Jack",
  "Jai",
  "Kennedy"
];

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/inspect-meevo-targeted.js "MEEVO_URL"
`);
  process.exit(1);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function endpointLooksUseful(url) {
  return /meevo\.com\/.*(api|availability|appointment|slot|time|calendar|schedule|openings|reserve|booking|employee|service)/i.test(
    url
  );
}

async function getBodyText(page) {
  return cleanText(await page.locator("body").innerText().catch(() => ""));
}

async function clickText(page, text, exact = false, label = "") {
  try {
    const locator = page.getByText(text, { exact });
    const count = await locator.count();

    if (!count) {
      console.log(`❌ Not found: ${text}`);
      return false;
    }

    console.log(`✅ Clicking ${label || text}`);

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

async function clickLastText(page, text, label = "") {
  try {
    const locator = page.getByText(text, { exact: false });
    const count = await locator.count();

    if (!count) {
      console.log(`❌ Not found: ${text}`);
      return false;
    }

    console.log(`✅ Clicking last match ${label || text}`);

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

    const count = await button.count();

    if (!count) {
      console.log(`❌ Button not found: ${text}`);
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

async function isNextDisabled(page) {
  try {
    const next = page.locator("button").filter({
      hasText: /^Next$/
    });

    if (!(await next.count())) {
      return true;
    }

    const nativeDisabled = await next.first().isDisabled().catch(() => false);
    const className = await next.first().getAttribute("class").catch(() => "");

    return nativeDisabled || String(className || "").includes("disabled-btn");
  } catch {
    return true;
  }
}

async function handleCookies(page) {
  await clickText(page, "Accept All", true, "cookie Accept All").catch(() => {});
}

async function handleAddOns(page) {
  const body = await getBodyText(page);

  if (
    body.includes("No, thanks") ||
    body.includes("Aromatherapy") ||
    body.includes("Save")
  ) {
    console.log("✅ Add-on step detected");

    const skipped = await clickButton(page, "No, thanks");

    if (!skipped) {
      await clickButton(page, "Save");
    }

    await page.waitForTimeout(4000);
  } else {
    console.log("No add-on step detected");
  }
}

async function clickRealTherapistCard(page) {
  console.log("\n--- Therapist Card Selection ---");

  for (const name of TARGET_THERAPIST_NAMES) {
    try {
      const card = page.locator("ob-employee-item").filter({
        hasText: new RegExp(name, "i")
      });

      const count = await card.count();

      console.log(`Therapist card count for ${name}:`, count);

      if (!count) {
        continue;
      }

      const target = card.first();

      const text = cleanText(await target.innerText().catch(() => ""));
      console.log(`Trying therapist card: ${text.slice(0, 200)}`);

      await target.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(500);

      await target.hover({ force: true }).catch(() => {});
      await page.waitForTimeout(500);

      await target.click({
        force: true,
        timeout: 7000
      });

      await page.waitForTimeout(6000);

      const nextDisabled = await isNextDisabled(page);
      console.log(`Next disabled after clicking ${name}:`, nextDisabled);

      if (!nextDisabled) {
        console.log(`✅ SUCCESS: Therapist selected: ${name}`);
        return true;
      }

      // Coordinate fallback inside the card
      const box = await target.boundingBox().catch(() => null);

      if (box) {
        console.log(`Trying coordinate click inside ${name} card...`);

        await page.mouse.click(
          box.x + box.width / 2,
          box.y + box.height / 2
        );

        await page.waitForTimeout(6000);

        const nextDisabledAfterCoord = await isNextDisabled(page);
        console.log(
          `Next disabled after coordinate click ${name}:`,
          nextDisabledAfterCoord
        );

        if (!nextDisabledAfterCoord) {
          console.log(`✅ SUCCESS by coordinate click: ${name}`);
          return true;
        }
      }
    } catch (error) {
      console.log(`❌ Therapist attempt failed for ${name}: ${error.message}`);
    }
  }

  console.log("❌ No real therapist card successfully selected");
  return false;
}

async function printSmallState(page, label) {
  const body = await getBodyText(page);
  const nextDisabled = await isNextDisabled(page);

  console.log(`\n--- ${label} ---`);
  console.log("Next disabled:", nextDisabled);

  const relevantSnippets = [
    "Service not selected",
    "1 Hour Swedish Massage",
    "Select Therapist",
    "Any Therapist",
    "Jack",
    "Jai",
    "Kennedy",
    "Date & Time"
  ];

  for (const snippet of relevantSnippets) {
    console.log(`${snippet}:`, body.includes(snippet));
  }

  const times =
    body.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

  console.log("Visible time matches:", [
    ...new Set(times.map((t) => cleanText(t).toUpperCase()))
  ]);
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 1200
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  const apiHits = [];

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
        preview = JSON.stringify(json).slice(0, 2500);
      }
    } catch {}

    const hit = {
      status,
      method,
      url,
      postData,
      preview
    };

    apiHits.push(hit);

    const isLikelyAvailability =
      /availability|slot|time|calendar|schedule|opening|reserve/i.test(url);

    if (isLikelyAvailability) {
      console.log("\n🔥 POSSIBLE AVAILABILITY ENDPOINT");
      console.log("STATUS:", status);
      console.log("METHOD:", method);
      console.log("URL:", url);
      if (postData) console.log("POST:", postData);
      if (preview) console.log("JSON:", preview);
    }
  });

  console.log("Opening Meevo URL:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(6000);

  await handleCookies(page);

  await printSmallState(page, "Initial");

  await clickText(page, "Next", true, "first Next");

  await printSmallState(page, "After first Next");

  await clickText(page, CATEGORY_SEARCH, false, "category");

  await printSmallState(page, "After category");

  await clickLastText(page, SERVICE_SEARCH, "specific service");

  await printSmallState(page, "After service click before add-ons");

  await handleAddOns(page);

  await printSmallState(page, "After add-ons");

  const therapistSelected = await clickRealTherapistCard(page);

  await printSmallState(page, "After therapist card attempt");

  if (!therapistSelected) {
    console.log("\nSTOPPING: Therapist card did not enable Next.");
    console.log("Next move will be direct API replay instead of UI clicking.");
  } else {
    await clickText(page, "Next", true, "Next to Date & Time");

    await page.waitForTimeout(12000);

    await printSmallState(page, "After Next to Date & Time");

    console.log("Scrolling to encourage lazy-loaded availability...");
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(8000);

    await printSmallState(page, "After scroll");
  }

  console.log("\n--- Useful API Hits Summary ---");

  console.log(
    JSON.stringify(
      apiHits.map((hit) => ({
        status: hit.status,
        method: hit.method,
        url: hit.url,
        postData: hit.postData ? hit.postData.slice(0, 1500) : null,
        preview: hit.preview ? hit.preview.slice(0, 1500) : null
      })),
      null,
      2
    )
  );

  await browser.close();

  console.log("\nDONE");
})();