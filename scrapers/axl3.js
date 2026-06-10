// scrapers/axl3.js

async function scrapeAxl3Business(browser, business) {
  const startTime = Date.now();

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 }
  });

  try {
    console.log(`\n[AXL3] Opening ${business.businessName}`);

    await page.goto(business.bookingUrl, {
      waitUntil: "networkidle",
      timeout: 90000
    });

    await page.waitForTimeout(3000);

    console.log("[AXL3] Looking for service:", business.serviceName);

    const clickedService = await page.evaluate((targetServiceName) => {
      const normalize = (text) =>
        String(text || "")
          .replace(/\s+/g, "")
          .replace("™", "")
          .toUpperCase();

      const target = normalize(targetServiceName);

      const links = Array.from(document.querySelectorAll("a.nextpage, a"));

      const match = links.find((link) => {
        const text = normalize(link.textContent);
        return text.includes(target) || text.includes("THEDEEP60MIN");
      });

      if (!match) return false;

      match.click();
      return true;
    }, business.serviceName);

    if (!clickedService) {
      throw new Error(`Could not find AXL3 service link for ${business.serviceName}`);
    }

    await page.waitForTimeout(6000);

    console.log("[AXL3] Selecting first available date...");

    const selectedDateText = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll(".datepicker-cell.day"));

      const availableCells = cells.filter((cell) => {
        const className = String(cell.className || "");
        return (
          !className.includes("disabled") &&
          !className.includes("prev") &&
          !className.includes("next")
        );
      });

      if (!availableCells.length) return null;

      const cell = availableCells[0];
      const text = cell.textContent.trim();

      cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      cell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      return text;
    });

    if (!selectedDateText) {
      throw new Error("No selectable AXL3 date found.");
    }

    console.log("[AXL3] Selected date:", selectedDateText);

    await page.waitForTimeout(4000);

    const bodyText = await page.locator("body").innerText().catch(() => "");

    const cleanBody = String(bodyText).replace(/\s+/g, " ").trim();

    const timeMatches =
      cleanBody.match(/\b(1[0-2]|[1-9]):[0-5][0-9]\s?(AM|PM|am|pm)\b/g) || [];

    const uniqueTimes = [...new Set(timeMatches)];

    console.log("[AXL3] Times found:", uniqueTimes);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "axl3",
      service: business.serviceName,
      provider: null,
      date: selectedDateText,
      times: uniqueTimes,
      status: uniqueTimes.length > 0 ? "success" : "no_times_found",
      scrapeDurationMs: Date.now() - startTime,
      lastChecked: new Date().toISOString(),
      rawWidgetText: cleanBody.slice(0, 5000)
    };
  } catch (error) {
    console.error("[AXL3 ERROR]", error.message);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "axl3",
      service: business.serviceName,
      provider: null,
      date: null,
      times: [],
      status: "error",
      error: error.message,
      scrapeDurationMs: Date.now() - startTime,
      lastChecked: new Date().toISOString()
    };
  } finally {
    await page.close();
  }
}

module.exports = {
  scrapeAxl3Business
};