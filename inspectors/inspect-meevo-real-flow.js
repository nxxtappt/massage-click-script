// inspectors/inspect-meevo-real-flow.js
//
// Goal:
// Follow the real Meevo booking flow exactly:
// 1. Guest Info: Next
// 2. Category: Swedish Massage
// 3. Service: 1 Hour Swedish Massage
// 4. Next to Therapist screen
// 5. Select Any Therapist
// 6. Next to Date & Time
// 7. Capture openings / availability
//
// Usage:
// node inspectors/inspect-meevo-real-flow.js "MEEVO_URL"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

const CATEGORY_SEARCH = "Swedish Massage";
const SERVICE_SEARCH = "1 Hour Swedish Massage";
const THERAPIST_SEARCH = "Any Therapist";

if (!TARGET_URL) {
  console.error(`
Usage:
node inspectors/inspect-meevo-real-flow.js "MEEVO_URL"
`);
  process.exit(1);
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAvailabilityEndpoint(url) {
  return /meevo\.com\/.*(availability|slot|time|calendar|schedule|openings|reserve|booking|appointment|scan|day|week|employee|service)/i.test(url);
}

async function getBody(page) {
  return clean(await page.locator("body").innerText().catch(() => ""));
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
      timeout: 8000
    });

    await page.waitForTimeout(3000);
    return true;
  } catch (error) {
    console.log(`❌ Could not click "${text}": ${error.message}`);
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
      timeout: 8000
    });

    await page.waitForTimeout(4000);
    return true;
  } catch (error) {
    console.log(`❌ Could not click last "${text}": ${error.message}`);
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
      timeout: 8000
    });

    await page.waitForTimeout(3000);
    return true;
  } catch (error) {
    console.log(`❌ Could not click button "${text}": ${error.message}`);
    return false;
  }
}

async function clickNext(page, label) {
  console.log(`\n--- ${label} ---`);

  const clicked = await clickButton(page, "Next");

  await page.waitForTimeout(4000);

  return clicked;
}

async function clickAnyTherapistOnTherapistScreen(page) {
  console.log("\n--- Selecting Any Therapist ---");

  await page.waitForTimeout(3000);

  const body = await getBody(page);

  console.log("Any Therapist visible:", body.includes("Any Therapist"));
  console.log("Select Therapist visible:", body.includes("Select Therapist"));

  // First try normal text click.
  const normalClick = await clickText(page, THERAPIST_SEARCH, true);

  await page.waitForTimeout(4000);

  if (normalClick) {
    return true;
  }

  // Fallback: click exact DIV containing only Any Therapist.
  try {
    const exactDiv = page.locator("div").filter({
      hasText: /^Any Therapist$/
    });

    const count = await exactDiv.count();

    console.log("Exact Any Therapist div count:", count);

    if (count > 0) {
      await exactDiv.first().click({
        force: true,
        timeout: 8000
      });

      await page.waitForTimeout(4000);

      return true;
    }
  } catch (error) {
    console.log(`Fallback Any Therapist click failed: ${error.message}`);
  }

  return false;
}

async function handleAddOns(page) {
  console.log("\n--- Add-ons Check ---");

  const body = await getBody(page);

  if (
    body.includes("No, thanks") ||
    body.includes("Save") ||
    body.includes("Aromatherapy") ||
    body.includes("Add-on")
  ) {
    console.log("✅ Add-on screen detected");

    const skipped = await clickButton(page, "No, thanks");

    if (!skipped) {
      await clickButton(page, "Save");
    }

    await page.waitForTimeout(4000);
    return true;
  }

  console.log("No add-on screen detected");
  return false;
}

async function printState(page, label) {
  const body = await getBody(page);

  const times =
    body.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

  const openings =
    body.match(/\b\d+\s+Openings?\b/g) || [];

  console.log(`\n=== ${label} ===`);
  console.log("Contains Swedish Massage:", body.includes("Swedish Massage"));
  console.log("Contains 1 Hour Swedish Massage:", body.includes("1 Hour Swedish Massage"));
  console.log("Contains Any Therapist:", body.includes("Any Therapist"));
  console.log("Contains Date & Time:", body.includes("Date & Time"));
  console.log("Contains Openings:", /Openings?/i.test(body));
  console.log("Visible openings:", [...new Set(openings.map(clean))]);
  console.log("Visible times:", [...new Set(times.map((t) => clean(t).toUpperCase()))]);

  const usefulSnippetMatch = body.match(
    /(Scan Date|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Openings|1 Hour Swedish Massage|Estimated Total|Select).{0,2500}/i
  );

  if (usefulSnippetMatch) {
    console.log("\nUseful page snippet:");
    console.log(usefulSnippetMatch[0]);
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
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  const capturedHits = [];

  page.on("response", async (response) => {
    const url = response.url();

    if (!isAvailabilityEndpoint(url)) {
      return;
    }

    const method = response.request().method();
    const status = response.status();
    const postData = response.request().postData();

    let jsonText = null;

    try {
      const contentType = response.headers()["content-type"] || "";

      if (contentType.includes("application/json")) {
        const json = await response.json();
        jsonText = JSON.stringify(json, null, 2);

        const looksImportant =
          /(openings|appointment|availability|slot|start|end|employee|service|date|time)/i.test(jsonText) ||
          /(availability|slot|time|calendar|schedule|openings|reserve|appointment|scan|day|week)/i.test(url);

        if (looksImportant) {
          console.log("\n🔥 USEFUL API RESPONSE");
          console.log("STATUS:", status);
          console.log("METHOD:", method);
          console.log("URL:", url);

          if (postData) {
            console.log("POST:");
            console.log(postData);
          }

          console.log("JSON PREVIEW:");
          console.log(jsonText.slice(0, 8000));
        }
      }
    } catch {}

    capturedHits.push({
      status,
      method,
      url,
      postData,
      jsonPreview: jsonText ? jsonText.slice(0, 2000) : null
    });
  });

  console.log("Opening:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(5000);

  await clickText(page, "Accept All", true).catch(() => {});

  await printState(page, "Initial");

  // Step 1: Guest Information -> Next
  await clickNext(page, "Step 1: Guest Information Next");
  await printState(page, "After Guest Info Next");

  // Step 2a: Select category
  await clickText(page, CATEGORY_SEARCH, false);
  await printState(page, "After Category Selection");

  // Step 2b: Select service
  await clickLastText(page, SERVICE_SEARCH);
  await printState(page, "After Service Selection");

  // Add-ons if they interrupt service selection
  await handleAddOns(page);
  await printState(page, "After Add-ons");

  // IMPORTANT NEW FLOW:
  // After service/add-ons, click Next to enter therapist screen.
  await clickNext(page, "Step 2: Next to Therapist Screen");
  await printState(page, "After Next to Therapist Screen");

  // Select Any Therapist.
  await clickAnyTherapistOnTherapistScreen(page);
  await printState(page, "After Any Therapist Selection");

  // Now click Next to Date & Time.
  await clickNext(page, "Step 2: Next to Date & Time");
  await page.waitForTimeout(12000);

  await printState(page, "After Date & Time Load");

  // Scroll in case openings lazy load below fold.
  console.log("\nScrolling for openings...");
  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(8000);

  await printState(page, "After Scroll");

  console.log("\n=== CAPTURED USEFUL API HITS SUMMARY ===");

  console.log(
    JSON.stringify(
      capturedHits.map((hit) => ({
        status: hit.status,
        method: hit.method,
        url: hit.url,
        postData: hit.postData ? hit.postData.slice(0, 1500) : null,
        jsonPreview: hit.jsonPreview
      })),
      null,
      2
    )
  );

  await browser.close();

  console.log("\nDONE");
})();