// inspectors/inspect-axl3-calendar-dom.js

const { chromium } = require("playwright");

const TARGET_URL =
  "https://booking.austindeep.com/tx/lake-austin-blvd/appointments/139";

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

  console.log("Opening:", TARGET_URL);

  await page.goto(TARGET_URL, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(5000);

  console.log("\n================ CALENDAR HTML ================\n");

  // dump possible calendar containers
  const possibleCalendars = await page.locator(`
    .ui-datepicker,
    .calendar,
    .datepicker,
    table,
    td,
    .day,
    [class*="date"],
    [class*="calendar"]
  `).evaluateAll((els) =>
    els.map((el) => ({
      tag: el.tagName,
      className: el.className,
      text: (el.innerText || "").trim(),
      html: el.outerHTML.slice(0, 1000)
    }))
  );

  console.log(JSON.stringify(possibleCalendars, null, 2));

  console.log("\n================ CLICKABLE ELEMENTS ================\n");

  const clickables = await page.locator(`
    button,
    a,
    td,
    div,
    span
  `).evaluateAll((els) =>
    els
      .map((el) => ({
        tag: el.tagName,
        className: el.className,
        text: (el.innerText || "").trim()
      }))
      .filter((x) => {
        return (
          x.text &&
          (
            /^[0-9]{1,2}$/.test(x.text) ||
            x.text.includes("May") ||
            x.text.includes("Today")
          )
        );
      })
  );

  console.log(JSON.stringify(clickables, null, 2));

  await browser.close();

  console.log("\nDONE");
})();
