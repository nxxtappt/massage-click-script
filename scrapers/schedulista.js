// scrapers/schedulista.js
//
// Reusable Schedulista scraper.
// Strategy:
// 1. Open the Schedulista business page.
// 2. Find the service link by serviceName.
// 3. Extract service_id.
// 4. Go directly to choose_time?service_id=SERVICE_ID.
// 5. Use "No preference -- see all available times" by skipping provider_id.
// 6. Extract available times or next available date message.

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractServiceIdFromUrl(url) {
  const match = String(url || "").match(/[?&]service_id=([^&]+)/);
  return match ? match[1] : null;
}

function extractTimesFromText(text) {
  const raw = String(text || "");

  const matches =
    raw.match(/([1-9]|1[0-2]):[0-5][0-9]\s?(am|pm)/gi) || [];

  return [...new Set(matches.map((t) => cleanText(t).toUpperCase()))];
}

function extractNextAvailableDate(text) {
  const body = cleanText(text);

  const match = body.match(/next available time is on ([^.]+)\./i);

  if (!match) {
    return null;
  }

  return cleanText(match[1]);
}

function buildChooseTimeUrl(baseScheduleUrl, serviceId) {
  const cleanBase = String(baseScheduleUrl || "").replace(/\/+$/, "");

  // Handles:
  // https://mantismassage.schedulista.com/
  // and:
  // https://www.schedulista.com/schedule/mantismassage
  if (cleanBase.includes("schedulista.com/schedule/")) {
    return `${cleanBase}/choose_time?service_id=${serviceId}`;
  }

  // Schedulista subdomain business pages usually redirect service links to:
  // https://www.schedulista.com/schedule/BUSINESSCODE/...
  // So if the original bookingUrl is a subdomain, this fallback is not always enough.
  // We prefer deriving the final choose_time URL from the actual service link when possible.
  return `${cleanBase}/choose_time?service_id=${serviceId}`;
}

function buildChooseTimeUrlFromServiceHref(serviceHref, serviceId) {
  const href = String(serviceHref || "");

  // Example:
  // https://www.schedulista.com/schedule/mantismassage/choose_provider?service_id=1073958786
  return href.replace(/choose_provider.*$/i, `choose_time?service_id=${serviceId}`);
}

async function scrapeSchedulistaBusiness(browser, business) {
  const startedAt = Date.now();

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1000
    }
  });

  try {
    const bookingUrl = business.bookingUrl;
    const serviceName = business.serviceName;

    if (!bookingUrl) {
      throw new Error("Missing bookingUrl for Schedulista business.");
    }

    if (!serviceName && !business.serviceId) {
      throw new Error("Missing serviceName or serviceId for Schedulista business.");
    }

    console.log(`\n[Schedulista] Scraping: ${business.businessName}`);
    console.log(`[Schedulista] Opening: ${bookingUrl}`);

    await page.goto(bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(2500);

    let serviceId = business.serviceId || null;
    let serviceHref = null;

    if (!serviceId) {
      const links = page.locator("a");
      const linkCount = await links.count();

      for (let i = 0; i < linkCount; i++) {
        const link = links.nth(i);

        const text = cleanText(await link.innerText().catch(() => ""));
        const href = await link.getAttribute("href").catch(() => null);

        if (!text || !href) {
          continue;
        }

        const exactMatch =
          text.toLowerCase() === String(serviceName).toLowerCase();

        const looseMatch =
          business.allowLooseServiceMatch === true &&
          text.toLowerCase().includes(String(serviceName).toLowerCase());

        if (exactMatch || looseMatch) {
          serviceHref = href;
          serviceId = extractServiceIdFromUrl(href);
          break;
        }
      }
    }

    if (!serviceId) {
      const bodyText = cleanText(await page.locator("body").innerText().catch(() => ""));

      return {
        businessName: business.businessName,
        bookingUrl: business.bookingUrl,
        platform: "schedulista",
        service: business.serviceName || null,
        provider: "No preference -- see all available times",
        date: null,
        times: [],
        status: "service_not_found",
        scrapeDurationMs: Date.now() - startedAt,
        lastChecked: new Date().toISOString(),
        rawWidgetText: bodyText.slice(0, 5000),
        error: `Could not find service: ${business.serviceName}`
      };
    }

    let chooseTimeUrl;

    if (serviceHref) {
      chooseTimeUrl = buildChooseTimeUrlFromServiceHref(serviceHref, serviceId);
    } else if (business.chooseTimeUrl) {
      chooseTimeUrl = business.chooseTimeUrl;
    } else {
      chooseTimeUrl = buildChooseTimeUrl(bookingUrl, serviceId);
    }

    console.log(`[Schedulista] Service ID: ${serviceId}`);
    console.log(`[Schedulista] Choose time URL: ${chooseTimeUrl}`);

    await page.goto(chooseTimeUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const bodyText = cleanText(await page.locator("body").innerText().catch(() => ""));

    const times = extractTimesFromText(bodyText);
    const nextAvailableDate = extractNextAvailableDate(bodyText);

    let status = "unknown";

    if (times.length > 0) {
      status = "success";
    } else if (/no available appointment times today/i.test(bodyText)) {
      status = "no_times_today";
    } else if (nextAvailableDate) {
      status = "next_available_found";
    } else {
      status = "no_times_found";
    }

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "schedulista",
      service: business.serviceName || null,
      serviceId,
      provider: "No preference -- see all available times",
      date: nextAvailableDate || null,
      times,
      status,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: bodyText.slice(0, 5000)
    };
  } catch (error) {
    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "schedulista",
      service: business.serviceName || null,
      provider: "No preference -- see all available times",
      date: null,
      times: [],
      status: "error",
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: null,
      error: error.message
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  scrapeSchedulistaBusiness
};