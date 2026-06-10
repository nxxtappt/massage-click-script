// inspect-schedulista-times.js
//
// Usage:
// node inspect-schedulista-times.js "https://www.schedulista.com/schedule/mantismassage/choose_time?service_id=1073958786"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.error(`
Usage:
node inspect-schedulista-times.js "FULL_CHOOSE_TIME_URL"
`);
  process.exit(1);
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeText(locator) {
  try {
    return cleanText(await locator.innerText({ timeout: 1000 }));
  } catch {
    return "";
  }
}

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1000
    }
  });

  console.log("\nOpening:");
  console.log(TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(4000);

  console.log("\n==================================================");
  console.log("TITLE");
  console.log("==================================================");
  console.log(await page.title().catch(() => "[No title]"));

  console.log("\n==================================================");
  console.log("CURRENT URL");
  console.log("==================================================");
  console.log(page.url());

  const bodyText = cleanText(
    await page.locator("body").innerText().catch(() => "")
  );

  console.log("\n==================================================");
  console.log("BODY TEXT SAMPLE");
  console.log("==================================================");
  console.log(bodyText.slice(0, 8000));

  console.log("\n==================================================");
  console.log("LINKS");
  console.log("==================================================");

  const links = page.locator("a");
  const linkCount = await links.count().catch(() => 0);

  console.log("Link count:", linkCount);

  for (let i = 0; i < Math.min(linkCount, 200); i++) {
    const link = links.nth(i);

    const text = await safeText(link);
    const href = await link.getAttribute("href").catch(() => null);
    const className = await link.getAttribute("class").catch(() => null);

    if (text || href) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            href,
            className
          },
          null,
          2
        )
      );
    }
  }

  console.log("\n==================================================");
  console.log("BUTTONS");
  console.log("==================================================");

  const buttons = page.locator("button");
  const buttonCount = await buttons.count().catch(() => 0);

  console.log("Button count:", buttonCount);

  for (let i = 0; i < Math.min(buttonCount, 150); i++) {
    const button = buttons.nth(i);

    const text = await safeText(button);
    const className = await button.getAttribute("class").catch(() => null);
    const ariaLabel = await button.getAttribute("aria-label").catch(() => null);

    if (text || className || ariaLabel) {
      console.log(
        JSON.stringify(
          {
            index: i,
            text,
            className,
            ariaLabel
          },
          null,
          2
        )
      );
    }
  }

  console.log("\n==================================================");
  console.log("POSSIBLE TIME TEXT MATCHES");
  console.log("==================================================");

  const timeRegex = /\b([1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)\b/gi;
  const matches = bodyText.match(timeRegex) || [];

  console.log([...new Set(matches)]);

  console.log("\n==================================================");
  console.log("DONE");
  console.log("==================================================");

  await browser.close();
})();