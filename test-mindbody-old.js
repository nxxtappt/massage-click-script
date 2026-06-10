const { chromium } = require("playwright");

const URL = "https://myoaustin.com/book-a-massage/";

async function testOldMindbody() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log("\n[OLD MINDBODY] Opening page...");
  await page.goto(URL, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });

  await page.waitForTimeout(8000);

  console.log("\n===== MAIN PAGE TEXT =====");
  console.log((await page.locator("body").innerText()).slice(0, 4000));

  console.log("\n===== FRAMES FOUND =====");
  for (const frame of page.frames()) {
    console.log(frame.url());
  }

  const frame =
    page.frames().find((f) => f.url().includes("mindbodyonline")) || page;

  console.log("\n[OLD MINDBODY] Using frame/page:");
  console.log(frame.url());

  console.log("\n===== WIDGET TEXT BEFORE CLICKS =====");
  console.log((await frame.locator("body").innerText()).slice(0, 5000));

  console.log("\n===== SELECT OPTIONS =====");

  const selects = await frame.locator("select").evaluateAll((els) =>
    els.map((select, index) => ({
      index,
      name: select.getAttribute("name"),
      id: select.getAttribute("id"),
      options: Array.from(select.options).map((option) => ({
        text: option.textContent.trim(),
        value: option.value
      }))
    }))
  );

  console.log(JSON.stringify(selects, null, 2));

  const buttons = await frame.locator("button, input[type='submit'], input[type='button']").evaluateAll((els) =>
    els.map((el, index) => ({
      index,
      tag: el.tagName,
      type: el.getAttribute("type"),
      text: el.innerText || el.value || "",
      id: el.getAttribute("id"),
      name: el.getAttribute("name")
    }))
  );

  console.log("\n===== BUTTONS / INPUT BUTTONS =====");
  console.log(JSON.stringify(buttons, null, 2));

  console.log("\n[OLD MINDBODY] Inspector complete.");
  await browser.close();
}

testOldMindbody().catch((err) => {
  console.error("\n[OLD MINDBODY ERROR]");
  console.error(err);
});