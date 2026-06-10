const { chromium } = require("playwright");

async function run() {
  const bookingUrl = process.argv[2];
  const categoryText = process.argv[3];

  if (!bookingUrl || !categoryText) {
    console.log("Please provide a booking URL and category.");
    console.log("Example:");
    console.log('node inspect.js https://www.generatorathletelab.com/book-treatment-session "Massage"');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log(`Opening: ${bookingUrl}`);

    await page.goto(bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(10000);

    const frame = page.frames().find(frame =>
      frame.url().includes("go.mindbodyonline.com/book/widgets/appointments")
    );

    if (!frame) {
      console.log("Mindbody iframe not found.");
      return;
    }

    console.log("\nMindbody iframe found:");
    console.log(frame.url());

    console.log(`\nClicking category: ${categoryText}`);
    await frame.getByText(categoryText, { exact: true }).click();
    await page.waitForTimeout(5000);

    const bodyText = await frame.locator("body").innerText();

    console.log("\n===== FULL WIDGET TEXT AFTER CATEGORY CLICK =====");
    console.log(bodyText);

    const buttons = await frame.locator("button").evaluateAll(buttons =>
      buttons.map((button, index) => ({
        index,
        buttonText: button.innerText.trim(),
        serviceId: button.getAttribute("data-service-id"),
        ariaLabel: button.getAttribute("aria-label"),
        parentText: button.parentElement?.innerText?.trim() || "",
        grandParentText: button.parentElement?.parentElement?.innerText?.trim() || "",
        greatGrandParentText:
          button.parentElement?.parentElement?.parentElement?.innerText?.trim() || ""
      }))
    );

    console.log("\n===== BUTTONS AFTER CATEGORY CLICK =====");
    console.log(JSON.stringify(buttons, null, 2));
  } catch (error) {
    console.error("Inspect failed:", error.message);
  } finally {
    await browser.close();
  }
}

run();