// inspect-schedulista.js
// Purpose:
// Inspect a Schedulista public scheduler page and print services, links,
// buttons, forms, dropdowns, and possible availability/time elements.
//
// Usage:
// node inspect-schedulista.js "https://www.schedulista.com/schedule/BUSINESSCODE" "massage"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];
const SEARCH_TEXT = process.argv[3] || "massage";

if (!TARGET_URL) {
  console.error(`
Missing URL.

Usage:
node inspect-schedulista.js "https://www.schedulista.com/schedule/BUSINESSCODE" "massage"
`);
  process.exit(1);
}

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

async function printButtons(scope, label) {
  await printSection(`${label} BUTTONS`);

  const buttons = scope.locator("button");
  const count = await buttons.count().catch(() => 0);

  console.log(`Button count: ${count}`);

  for (let i = 0; i < Math.min(count, 120); i++) {
    const btn = buttons.nth(i);

    const text = await safeText(btn);
    const disabled = await btn.isDisabled().catch(() => false);
    const type = await btn.getAttribute("type").catch(() => null);
    const id = await btn.getAttribute("id").catch(() => null);
    const name = await btn.getAttribute("name").catch(() => null);
    const className = await btn.getAttribute("class").catch(() => null);
    const ariaLabel = await btn.getAttribute("aria-label").catch(() => null);
    const dataTestId = await btn.getAttribute("data-testid").catch(() => null);

    if (text || id || name || ariaLabel || dataTestId) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            disabled,
            type,
            id,
            name,
            className,
            ariaLabel,
            dataTestId
          },
          null,
          2
        )
      );
    }
  }
}

async function printLinks(scope, label) {
  await printSection(`${label} LINKS`);

  const links = scope.locator("a");
  const count = await links.count().catch(() => 0);

  console.log(`Link count: ${count}`);

  for (let i = 0; i < Math.min(count, 200); i++) {
    const link = links.nth(i);

    const text = await safeText(link);
    const href = await link.getAttribute("href").catch(() => null);
    const id = await link.getAttribute("id").catch(() => null);
    const className = await link.getAttribute("class").catch(() => null);
    const ariaLabel = await link.getAttribute("aria-label").catch(() => null);

    if (text || href || id || ariaLabel) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            href,
            id,
            className,
            ariaLabel
          },
          null,
          2
        )
      );
    }
  }
}

async function printInputs(scope, label) {
  await printSection(`${label} INPUTS / SELECTS / TEXTAREAS`);

  const inputs = scope.locator("input, select, textarea");
  const count = await inputs.count().catch(() => 0);

  console.log(`Input/select count: ${count}`);

  for (let i = 0; i < Math.min(count, 120); i++) {
    const input = inputs.nth(i);

    const tagName = await input.evaluate((el) => el.tagName).catch(() => null);
    const type = await input.getAttribute("type").catch(() => null);
    const id = await input.getAttribute("id").catch(() => null);
    const name = await input.getAttribute("name").catch(() => null);
    const placeholder = await input.getAttribute("placeholder").catch(() => null);
    const value = await input.inputValue().catch(() => null);
    const ariaLabel = await input.getAttribute("aria-label").catch(() => null);

    let options = [];

    if (tagName === "SELECT") {
      options = await input
        .locator("option")
        .evaluateAll((els) =>
          els.map((el) => ({
            text: (el.textContent || "").trim(),
            value: el.getAttribute("value")
          }))
        )
        .catch(() => []);
    }

    console.log(
      JSON.stringify(
        {
          index: i,
          tagName,
          type,
          id,
          name,
          placeholder,
          value,
          ariaLabel,
          options
        },
        null,
        2
      )
    );
  }
}

async function printPossibleMatches(scope, label, searchText) {
  await printSection(`${label} POSSIBLE MATCHES FOR "${searchText}"`);

  const matches = scope.locator(`text=${searchText}`);
  const count = await matches.count().catch(() => 0);

  console.log(`Match count: ${count}`);

  for (let i = 0; i < Math.min(count, 50); i++) {
    const match = matches.nth(i);
    const text = await safeText(match);
    const tagName = await match.evaluate((el) => el.tagName).catch(() => null);
    const href = await match.getAttribute("href").catch(() => null);

    console.log(
      JSON.stringify(
        {
          index: i,
          tagName,
          text,
          href
        },
        null,
        2
      )
    );
  }
}

async function inspectScope(scope, label, searchText) {
  const bodyText = cleanText(await scope.locator("body").innerText().catch(() => ""));

  await printSection(`${label} BODY TEXT SAMPLE`);
  console.log(bodyText.slice(0, 6000) || "[No readable body text]");

  await printLinks(scope, label);
  await printButtons(scope, label);
  await printInputs(scope, label);
  await printPossibleMatches(scope, label, searchText);
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 1000
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  console.log("\nOpening:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(4000);

  await printSection("PAGE INFO");
  console.log("Title:", await page.title().catch(() => "[No title]"));
  console.log("Current URL:", page.url());

  await inspectScope(page, "MAIN PAGE", SEARCH_TEXT);

  const frames = page.frames();

  await printSection("FRAMES FOUND");

  frames.forEach((frame, index) => {
    console.log(`${index}: ${frame.url()}`);
  });

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];

    if (frame === page.mainFrame()) {
      continue;
    }

    try {
      await printSection(`INSPECTING FRAME ${i}`);
      console.log(frame.url());

      const frameText = cleanText(await frame.locator("body").innerText().catch(() => ""));
      console.log("\n----- FRAME BODY TEXT SAMPLE -----");
      console.log(frameText.slice(0, 6000) || "[No readable body text]");

      await printLinks(frame, `FRAME ${i}`);
      await printButtons(frame, `FRAME ${i}`);
      await printInputs(frame, `FRAME ${i}`);
      await printPossibleMatches(frame, `FRAME ${i}`, SEARCH_TEXT);
    } catch (err) {
      console.log(`Could not inspect frame ${i}:`, err.message);
    }
  }

  await browser.close();

  await printSection("DONE");
  console.log(`
Send me:
1. PAGE INFO
2. BODY TEXT SAMPLE
3. LINKS that mention services or service_id
4. INPUTS / SELECTS
5. POSSIBLE MATCHES
`);
})();