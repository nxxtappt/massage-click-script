// inspectors/inspect-meevo.js
//
// Purpose:
// Inspect a public Meevo online booking page to learn its booking flow.
// We are looking for:
// - service buttons/links
// - categories
// - provider / "any provider" options
// - date controls
// - available time slots
// - iframes
// - hidden API/network hints in hrefs/data attributes
//
// Usage:
// node inspectors/inspect-meevo.js "PASTE_MEEVO_BOOKING_URL_HERE" "massage"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];
const SEARCH_TEXT = process.argv[3] || "massage";

if (!TARGET_URL) {
  console.error(`
Missing URL.

Usage:
node inspectors/inspect-meevo.js "PASTE_MEEVO_BOOKING_URL_HERE" "massage"
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
  } catch {
    return fallback;
  }
}

async function printSection(title) {
  console.log("\n==================================================");
  console.log(title);
  console.log("==================================================");
}

async function printLinks(scope, label) {
  await printSection(`${label} LINKS`);

  const links = scope.locator("a");
  const count = await links.count().catch(() => 0);

  console.log(`Link count: ${count}`);

  for (let i = 0; i < Math.min(count, 250); i++) {
    const link = links.nth(i);

    const text = await safeText(link);
    const href = await link.getAttribute("href").catch(() => null);
    const id = await link.getAttribute("id").catch(() => null);
    const className = await link.getAttribute("class").catch(() => null);
    const ariaLabel = await link.getAttribute("aria-label").catch(() => null);
    const role = await link.getAttribute("role").catch(() => null);

    if (text || href || id || ariaLabel || role) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            href,
            id,
            className,
            ariaLabel,
            role
          },
          null,
          2
        )
      );
    }
  }
}

async function printButtons(scope, label) {
  await printSection(`${label} BUTTONS`);

  const buttons = scope.locator("button");
  const count = await buttons.count().catch(() => 0);

  console.log(`Button count: ${count}`);

  for (let i = 0; i < Math.min(count, 250); i++) {
    const button = buttons.nth(i);

    const text = await safeText(button);
    const disabled = await button.isDisabled().catch(() => false);
    const type = await button.getAttribute("type").catch(() => null);
    const id = await button.getAttribute("id").catch(() => null);
    const name = await button.getAttribute("name").catch(() => null);
    const className = await button.getAttribute("class").catch(() => null);
    const ariaLabel = await button.getAttribute("aria-label").catch(() => null);
    const role = await button.getAttribute("role").catch(() => null);

    const dataAttrs = await button
      .evaluate((el) => {
        const out = {};
        for (const attr of el.attributes) {
          if (attr.name.startsWith("data-")) {
            out[attr.name] = attr.value;
          }
        }
        return out;
      })
      .catch(() => ({}));

    if (text || id || name || ariaLabel || role || Object.keys(dataAttrs).length) {
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
            role,
            dataAttrs
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

  for (let i = 0; i < Math.min(count, 200); i++) {
    const input = inputs.nth(i);

    const tagName = await input.evaluate((el) => el.tagName).catch(() => null);
    const type = await input.getAttribute("type").catch(() => null);
    const id = await input.getAttribute("id").catch(() => null);
    const name = await input.getAttribute("name").catch(() => null);
    const placeholder = await input.getAttribute("placeholder").catch(() => null);
    const value = await input.inputValue().catch(() => null);
    const ariaLabel = await input.getAttribute("aria-label").catch(() => null);
    const className = await input.getAttribute("class").catch(() => null);

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
          className,
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

  for (let i = 0; i < Math.min(count, 100); i++) {
    const match = matches.nth(i);

    const text = await safeText(match);
    const tagName = await match.evaluate((el) => el.tagName).catch(() => null);
    const href = await match.getAttribute("href").catch(() => null);
    const id = await match.getAttribute("id").catch(() => null);
    const className = await match.getAttribute("class").catch(() => null);

    console.log(
      JSON.stringify(
        {
          index: i,
          tagName,
          text,
          href,
          id,
          className
        },
        null,
        2
      )
    );
  }
}

async function printPossibleTimes(scope, label) {
  await printSection(`${label} POSSIBLE TIME TEXT MATCHES`);

  const text = cleanText(await scope.locator("body").innerText().catch(() => ""));
  const matches =
    text.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

  console.log([...new Set(matches.map((t) => cleanText(t).toUpperCase()))]);
}

async function printClickableElements(scope, label) {
  await printSection(`${label} CLICKABLE ELEMENTS SAMPLE`);

  const elements = scope.locator(
    'a, button, [role="button"], [tabindex], [onclick], div[class*="button"], span[class*="button"]'
  );

  const count = await elements.count().catch(() => 0);

  console.log(`Clickable-ish count: ${count}`);

  for (let i = 0; i < Math.min(count, 250); i++) {
    const el = elements.nth(i);

    const text = await safeText(el);
    const tagName = await el.evaluate((node) => node.tagName).catch(() => null);
    const href = await el.getAttribute("href").catch(() => null);
    const id = await el.getAttribute("id").catch(() => null);
    const className = await el.getAttribute("class").catch(() => null);
    const role = await el.getAttribute("role").catch(() => null);
    const ariaLabel = await el.getAttribute("aria-label").catch(() => null);

    if (text || href || id || role || ariaLabel) {
      console.log(
        JSON.stringify(
          {
            index: i,
            tagName,
            text,
            href,
            id,
            className,
            role,
            ariaLabel
          },
          null,
          2
        )
      );
    }
  }
}

async function inspectScope(scope, label, searchText) {
  const bodyText = cleanText(await scope.locator("body").innerText().catch(() => ""));

  await printSection(`${label} BODY TEXT SAMPLE`);
  console.log(bodyText.slice(0, 8000) || "[No readable body text]");

  await printLinks(scope, label);
  await printButtons(scope, label);
  await printInputs(scope, label);
  await printClickableElements(scope, label);
  await printPossibleMatches(scope, label, searchText);
  await printPossibleTimes(scope, label);
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

  const networkHits = [];

  page.on("response", async (response) => {
    const url = response.url();

    if (
      /api|availability|appointment|booking|service|employee|provider|time|slot/i.test(
        url
      )
    ) {
      networkHits.push({
        status: response.status(),
        url
      });
    }
  });

  console.log("\nOpening:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  await page.waitForTimeout(7000);

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

      const frameText = cleanText(
        await frame.locator("body").innerText().catch(() => "")
      );

      console.log("\n----- FRAME BODY TEXT SAMPLE -----");
      console.log(frameText.slice(0, 8000) || "[No readable body text]");

      await printLinks(frame, `FRAME ${i}`);
      await printButtons(frame, `FRAME ${i}`);
      await printInputs(frame, `FRAME ${i}`);
      await printClickableElements(frame, `FRAME ${i}`);
      await printPossibleMatches(frame, `FRAME ${i}`, SEARCH_TEXT);
      await printPossibleTimes(frame, `FRAME ${i}`);
    } catch (error) {
      console.log(`Could not inspect frame ${i}:`, error.message);
    }
  }

  await printSection("NETWORK HITS");
  console.log(JSON.stringify(networkHits.slice(0, 100), null, 2));

  await browser.close();

  await printSection("DONE");
  console.log(`
Send me:
1. PAGE INFO
2. BODY TEXT SAMPLE
3. LINKS
4. BUTTONS
5. CLICKABLE ELEMENTS SAMPLE
6. POSSIBLE MATCHES
7. POSSIBLE TIME TEXT MATCHES
8. FRAMES FOUND
9. NETWORK HITS
`);
})();