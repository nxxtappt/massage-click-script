const { chromium } = require("playwright");

async function run() {
  const bookingUrl = "https://austincommunitywellness.com/appointments/";
const categoryText = "Massage";
const serviceButtonId = "asrv_11kLPDeSQeo9Uvwivt";

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
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

    console.log("Clicking category...");
    await frame.getByText(categoryText, { exact: true }).click();
    await page.waitForTimeout(3000);

    console.log("Clicking service...");
    const serviceButton = frame.locator(
      `button[data-service-id="${serviceButtonId}"]`
    );

    await serviceButton.evaluate(button => button.click());
    await page.waitForTimeout(8000);

    const text = await frame.locator("body").innerText();

    console.log("\n===== TEXT AFTER SERVICE CLICK =====");
    console.log(text);

    const buttons = await frame.locator("button").evaluateAll(buttons =>
      buttons.map((button, index) => ({
        index,
        text: button.innerText.trim(),
        serviceId: button.getAttribute("data-service-id"),
        ariaLabel: button.getAttribute("aria-label"),
        type: button.getAttribute("type"),
        disabled: button.disabled,
        parentText: button.parentElement?.innerText?.trim() || "",
        grandParentText: button.parentElement?.parentElement?.innerText?.trim() || ""
      }))
    );

    console.log("\n===== BUTTONS AFTER SERVICE CLICK =====");
    console.log(JSON.stringify(buttons, null, 2));
  } catch (error) {
    console.error("Inspect failed:", error.message);
  } finally {
    await browser.close();
  }
}

run();