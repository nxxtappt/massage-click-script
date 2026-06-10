const { chromium } = require("playwright");

const URL = "https://myoaustin.com/book-a-massage/";

async function testOldMindbodySearch() {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  console.log("\n[OLD MINDBODY] Opening page...");

  await page.goto(URL, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  await page.waitForTimeout(7000);

  console.log("\nSelecting Swedish 60...");
  await page.selectOption("#session_type", "323");

  await page.waitForTimeout(1000);

  console.log("\nSelecting All therapists...");
  await page.selectOption("#options_staff_ids_", "");

  await page.waitForTimeout(1000);

  console.log("\nClicking Search...");
  await page.click("#hc-find-appt");

  await page.waitForTimeout(8000);

  console.log("\nClicking first available date...");

  const availableDate = page.locator(
    '.healcode a[href="#"]'
  ).first();

  await availableDate.click();

  await page.waitForTimeout(10000);

  const text = await page.locator("body").innerText();

  console.log("\n===== PAGE TEXT AFTER DATE CLICK =====");
  console.log(text.slice(0, 12000));

  const buttons = await page.locator("a, button").evaluateAll((els) =>
    els.map((el) => ({
      text: (el.innerText || "").trim(),
      href: el.href || null
    }))
  );

  console.log("\n===== BUTTONS/LINKS =====");
  console.log(JSON.stringify(buttons, null, 2));

  const timeRegex =
    /\b(1[0-2]|0?[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g;

  const times = text.match(timeRegex) || [];

  console.log("\n===== TIMES FOUND =====");
  console.log([...new Set(times)]);

  console.log("\n===== CURRENT URL =====");
  console.log(page.url());

  await browser.close();
}

testOldMindbodySearch().catch((err) => {
  console.error("\n[OLD MINDBODY SEARCH ERROR]");
  console.error(err);
});