// inspect-schedulista-provider.js
//
// Usage:
// node inspect-schedulista-provider.js "FULL_CHOOSE_PROVIDER_URL"

const { chromium } = require("playwright");

const TARGET_URL = process.argv[2];

if (!TARGET_URL) {
  console.error(`
Usage:
node inspect-schedulista-provider.js "FULL_URL"
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
    return cleanText(await locator.innerText());
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

  await page.waitForTimeout(3000);

  console.log("\n==================================================");
  console.log("TITLE");
  console.log("==================================================");
  console.log(await page.title());

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
  console.log(bodyText.slice(0, 6000));

  const links = page.locator("a");

  const linkCount = await links.count();

  console.log("\n==================================================");
  console.log("LINKS");
  console.log("==================================================");
  console.log("Link count:", linkCount);

  for (let i = 0; i < Math.min(linkCount, 150); i++) {
    const link = links.nth(i);

    const text = await safeText(link);
    const href = await link.getAttribute("href");
    const className = await link.getAttribute("class");

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

  const buttons = page.locator("button");

  const buttonCount = await buttons.count();

  console.log("\n==================================================");
  console.log("BUTTONS");
  console.log("==================================================");
  console.log("Button count:", buttonCount);

  for (let i = 0; i < Math.min(buttonCount, 100); i++) {
    const button = buttons.nth(i);

    const text = await safeText(button);
    const className = await button.getAttribute("class");
    const ariaLabel = await button.getAttribute("aria-label");

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

  const selects = page.locator("select");

  const selectCount = await selects.count();

  console.log("\n==================================================");
  console.log("SELECTS");
  console.log("==================================================");
  console.log("Select count:", selectCount);

  for (let i = 0; i < selectCount; i++) {
    const select = selects.nth(i);

    const name = await select.getAttribute("name");
    const id = await select.getAttribute("id");

    const options = await select
      .locator("option")
      .evaluateAll((els) =>
        els.map((el) => ({
          text: (el.textContent || "").trim(),
          value: el.getAttribute("value")
        }))
      );

    console.log(
      JSON.stringify(
        {
          index: i,
          name,
          id,
          options
        },
        null,
        2
      )
    );
  }

  console.log("\n==================================================");
  console.log("DONE");
  console.log("==================================================");

  await browser.close();
})();