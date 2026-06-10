// inspect-mindbody-client.js
// Purpose:
// Test a Mindbody-hosted/client booking page to see if it can be scraped
// more uniformly than each business's embedded website widget.
//
// Usage:
// node inspectors/inspect-mindbody-client.js "PASTE_MINDbody_CLIENT_OR_BOOKING_URL_HERE" "Massage"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];
const SEARCH_TEXT = process.argv[3] || "Massage";

if (!TARGET_URL) {
  console.error(`
Missing URL.

Usage:
node inspectors/inspect-mindbody-client.js "PASTE_URL_HERE" "Massage"
`);
  process.exit(1);
}

const WAIT_MS = 2500;

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeText(locator, fallback = "") {
  try {
    return cleanText(await locator.innerText({ timeout: 1000 }));
  } catch (err) {
    return fallback;
  }
}

async function printSection(title) {
  console.log("\n==================================================");
  console.log(title);
  console.log("==================================================");
}

async function inspectFrame(frame, frameIndex) {
  await printSection(`FRAME ${frameIndex}: ${frame.url()}`);

  const bodyText = cleanText(await frame.locator("body").innerText().catch(() => ""));

  console.log("\n----- BODY TEXT SAMPLE -----");
  console.log(bodyText.slice(0, 4000) || "[No readable body text]");

  console.log("\n----- BUTTONS -----");
  const buttons = frame.locator("button");
  const buttonCount = await buttons.count().catch(() => 0);

  for (let i = 0; i < Math.min(buttonCount, 100); i++) {
    const btn = buttons.nth(i);
    const text = await safeText(btn);
    const disabled = await btn.isDisabled().catch(() => false);
    const ariaLabel = await btn.getAttribute("aria-label").catch(() => null);
    const serviceId = await btn.getAttribute("data-service-id").catch(() => null);
    const testId = await btn.getAttribute("data-testid").catch(() => null);

    const parentText = await btn
      .evaluate((el) => el.parentElement?.innerText || "")
      .catch(() => "");

    const grandParentText = await btn
      .evaluate((el) => el.parentElement?.parentElement?.innerText || "")
      .catch(() => "");

    const greatGrandParentText = await btn
      .evaluate((el) => el.parentElement?.parentElement?.parentElement?.innerText || "")
      .catch(() => "");

    if (text || ariaLabel || serviceId || testId || parentText || grandParentText) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            ariaLabel,
            serviceId,
            testId,
            disabled,
            parentText: cleanText(parentText),
            grandParentText: cleanText(grandParentText),
            greatGrandParentText: cleanText(greatGrandParentText)
          },
          null,
          2
        )
      );
    }
  }

  console.log("\n----- LINKS -----");
  const links = frame.locator("a");
  const linkCount = await links.count().catch(() => 0);

  for (let i = 0; i < Math.min(linkCount, 100); i++) {
    const link = links.nth(i);
    const text = await safeText(link);
    const href = await link.getAttribute("href").catch(() => null);
    const ariaLabel = await link.getAttribute("aria-label").catch(() => null);

    if (text || href || ariaLabel) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            href,
            ariaLabel
          },
          null,
          2
        )
      );
    }
  }

  console.log("\n----- INPUTS / SELECTS -----");

  const inputs = frame.locator("input, select, textarea");
  const inputCount = await inputs.count().catch(() => 0);

  for (let i = 0; i < Math.min(inputCount, 100); i++) {
    const input = inputs.nth(i);
    const tagName = await input.evaluate((el) => el.tagName).catch(() => null);
    const type = await input.getAttribute("type").catch(() => null);
    const name = await input.getAttribute("name").catch(() => null);
    const placeholder = await input.getAttribute("placeholder").catch(() => null);
    const value = await input.inputValue().catch(() => null);
    const ariaLabel = await input.getAttribute("aria-label").catch(() => null);

    console.log(
      JSON.stringify(
        {
          index: i,
          tagName,
          type,
          name,
          placeholder,
          value,
          ariaLabel
        },
        null,
        2
      )
    );
  }

  console.log("\n----- POSSIBLE SERVICE MATCHES -----");

  const possibleMatches = await frame
    .locator(`text=${SEARCH_TEXT}`)
    .count()
    .catch(() => 0);

  console.log(`Found ${possibleMatches} text matches for: ${SEARCH_TEXT}`);

  for (let i = 0; i < Math.min(possibleMatches, 30); i++) {
    const match = frame.locator(`text=${SEARCH_TEXT}`).nth(i);
    const text = await safeText(match);
    console.log(
      JSON.stringify(
        {
          index: i,
          text
        },
        null,
        2
      )
    );
  }
}

async function expandMatchingCategoryInFrame(page, frame, frameIndex, searchText) {
  try {
    const expandLinks = frame.locator("text=Expand");
    const expandCount = await expandLinks.count().catch(() => 0);

    console.log(`\nFound ${expandCount} Expand buttons/links in frame ${frameIndex}`);

    for (let i = 0; i < expandCount; i++) {
      const expandItem = expandLinks.nth(i);

      const parentText = await expandItem
        .locator("..")
        .innerText()
        .catch(() => "");

      const grandParentText = await expandItem
        .locator("../..")
        .innerText()
        .catch(() => "");

      const combinedText = cleanText(`${parentText} ${grandParentText}`);

      console.log(
        JSON.stringify(
          {
            frameIndex,
            expandIndex: i,
            parentText: cleanText(parentText),
            grandParentText: cleanText(grandParentText)
          },
          null,
          2
        )
      );

      if (combinedText.toLowerCase().includes(searchText.toLowerCase())) {
        console.log(`\nCLICKING ${searchText} EXPAND in frame ${frameIndex}...`);

        await expandItem.click({
          timeout: 5000
        });

        await page.waitForTimeout(5000);

        console.log(`${searchText} category expanded or clicked.`);
        return true;
      }
    }

    return false;
  } catch (err) {
    console.log(`Expand attempt failed in frame ${frameIndex}: ${err.message}`);
    return false;
  }
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

  page.on("response", async (response) => {
    try {
      const url = response.url();

      const isRelevant =
        url.includes("mindbody") ||
        url.includes("api") ||
        url.includes("service") ||
        url.includes("services") ||
        url.includes("appointment") ||
        url.includes("appointments") ||
        url.includes("schedule") ||
        url.includes("book") ||
        url.includes("availability");

      if (!isRelevant) {
        return;
      }

      console.log("\n================ NETWORK RESPONSE ================");
      console.log("URL:", url);
      console.log("STATUS:", response.status());

      const contentType = response.headers()["content-type"] || "";
      console.log("CONTENT-TYPE:", contentType);

      if (contentType.includes("application/json")) {
        const json = await response.json().catch(() => null);

        if (json) {
          console.log("JSON SAMPLE:");
          console.log(JSON.stringify(json, null, 2).slice(0, 10000));
        }
      }
    } catch (err) {
      // Ignore network logging errors so inspection keeps running.
    }
  });

  console.log("\nOpening:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(WAIT_MS);

  await printSection("MAIN PAGE");

  console.log("Page title:");
  console.log(await page.title().catch(() => "[No title]"));

  console.log("\nCurrent URL:");
  console.log(page.url());

  const mainText = cleanText(await page.locator("body").innerText().catch(() => ""));

  console.log("\n----- MAIN PAGE BODY TEXT SAMPLE -----");
  console.log(mainText.slice(0, 5000) || "[No readable body text]");

  console.log("\n----- MAIN PAGE BUTTONS -----");
  const pageButtons = page.locator("button");
  const pageButtonCount = await pageButtons.count().catch(() => 0);

  for (let i = 0; i < Math.min(pageButtonCount, 100); i++) {
    const btn = pageButtons.nth(i);
    const text = await safeText(btn);
    const disabled = await btn.isDisabled().catch(() => false);
    const ariaLabel = await btn.getAttribute("aria-label").catch(() => null);
    const serviceId = await btn.getAttribute("data-service-id").catch(() => null);
    const testId = await btn.getAttribute("data-testid").catch(() => null);

    if (text || ariaLabel || serviceId || testId) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            ariaLabel,
            serviceId,
            testId,
            disabled
          },
          null,
          2
        )
      );
    }
  }

  console.log("\n----- MAIN PAGE LINKS -----");
  const pageLinks = page.locator("a");
  const pageLinkCount = await pageLinks.count().catch(() => 0);

  for (let i = 0; i < Math.min(pageLinkCount, 100); i++) {
    const link = pageLinks.nth(i);
    const text = await safeText(link);
    const href = await link.getAttribute("href").catch(() => null);
    const ariaLabel = await link.getAttribute("aria-label").catch(() => null);

    if (text || href || ariaLabel) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            href,
            ariaLabel
          },
          null,
          2
        )
      );
    }
  }

  const frames = page.frames();

  await printSection("FRAMES FOUND");

  frames.forEach((frame, index) => {
    console.log(`${index}: ${frame.url()}`);
  });

  await printSection(`ATTEMPTING TO EXPAND CATEGORY: ${SEARCH_TEXT}`);

  for (let i = 0; i < frames.length; i++) {
    await expandMatchingCategoryInFrame(page, frames[i], i, SEARCH_TEXT);
  }

  await page.waitForTimeout(3000);

  const updatedFrames = page.frames();

  await printSection("FRAMES AFTER EXPAND ATTEMPT");

  updatedFrames.forEach((frame, index) => {
    console.log(`${index}: ${frame.url()}`);
  });

  for (let i = 0; i < updatedFrames.length; i++) {
    await inspectFrame(updatedFrames[i], i);
  }

  await printSection("DONE");

  console.log(`
Next:
1. Look for service names paired with data-service-id values.
2. Look for parentText/grandParentText around service buttons.
3. Look for useful NETWORK RESPONSE blocks with JSON.
4. Paste the FRAME 1 button output back into ChatGPT.
`);

  await browser.close();
})();