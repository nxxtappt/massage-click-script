const { chromium } = require("playwright");

async function scrapeMindbodyOldBusiness(browser, business) {
  const startedAt = Date.now();

  const page = await browser.newPage();

  try {
    console.log(`\n[MINDBODY-OLD] Opening ${business.businessName}`);

    await page.goto(business.bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(7000);

    console.log(
      `[MINDBODY-OLD] Selecting service ID ${business.serviceId}`
    );

    await page.selectOption(
      "#session_type",
      String(business.serviceId)
    );

    await page.waitForTimeout(1000);

    console.log("[MINDBODY-OLD] Selecting therapist");

    await page.selectOption(
      "#options_staff_ids_",
      business.staffValue || ""
    );

    await page.waitForTimeout(1000);

    console.log("[MINDBODY-OLD] Clicking Search");

    await page.click("#hc-find-appt");

    await page.waitForTimeout(8000);

    console.log("[MINDBODY-OLD] Clicking first available date");

    const availableDate = page.locator(
      '.healcode a[href="#"]'
    ).first();

    await availableDate.click();

    await page.waitForTimeout(10000);

    const text = await page.locator("body").innerText();

    const links = await page.locator("a").evaluateAll((els) =>
      els.map((el) => ({
        text: (el.innerText || "").trim(),
        href: el.href || null
      }))
    );

    const therapistBlocks = [];

    let currentTherapist = null;

    for (const item of links) {
      const text = item.text;

      if (!text) continue;

      const isTime =
        /^([1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$/i.test(text);

      if (!isTime) {
        currentTherapist = text;
        continue;
      }

      if (currentTherapist) {
        let therapist = therapistBlocks.find(
          (t) => t.name === currentTherapist
        );

        if (!therapist) {
          therapist = {
            name: currentTherapist,
            times: []
          };

          therapistBlocks.push(therapist);
        }

        therapist.times.push(text);
      }
    }

    const uniqueTimes = [
      ...new Set(
        therapistBlocks.flatMap((t) => t.times)
      )
    ];

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "mindbody-old",
      service: business.serviceName,
      provider:
        business.staffValue === ""
          ? "All therapists"
          : business.staffValue,
      date: null,
      times: uniqueTimes,
      therapistAvailability: therapistBlocks,
      status:
        uniqueTimes.length > 0
          ? "success"
          : "no_times_found",
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: text
    };
  } catch (error) {
    console.error(
      `[MINDBODY-OLD ERROR] ${business.businessName}`
    );

    console.error(error);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "mindbody-old",
      service: business.serviceName,
      provider: business.staffValue || "All therapists",
      date: null,
      times: [],
      therapistAvailability: [],
      status: "error",
      error: error.message,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: null
    };
  } finally {
    await page.close();
  }
}

module.exports = {
  scrapeMindbodyOldBusiness
};