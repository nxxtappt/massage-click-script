// scrapers/booker.js

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDateYYYYMMDD(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getTodayLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
}

function extractDateFromBookerUrl(url) {
  const match = String(url || "").match(/\/availability\/(\d{4}-\d{2}-\d{2})\//);
  return match ? match[1] : null;
}

function isPastDate(dateText) {
  if (!dateText) return false;
  const today = formatDateYYYYMMDD(getTodayLocalDate());
  return dateText < today;
}

function buildBookerUrl(url, date) {
  const raw = String(url || "");

  if (raw.includes("{date}")) {
    return raw.replaceAll("{date}", date);
  }

  if (/\/availability\/\d{4}-\d{2}-\d{2}\//.test(raw)) {
    return raw.replace(/\/availability\/\d{4}-\d{2}-\d{2}\//, `/availability/${date}/`);
  }

  return raw;
}

function extractTimesFromButtonText(buttons = []) {
  return [
    ...new Set(
      buttons
        .map((button) => cleanText(button.text))
        .filter((text) =>
          /^([1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$/i.test(text)
        )
        .map((text) => text.toUpperCase().replace(/\s+/g, " "))
    )
  ];
}

async function getBodyText(page) {
  return await page.locator("body").innerText().catch(() => "");
}

async function extractBookerTimesFromPage(page) {
  const buttons = await page.locator("button").evaluateAll((els) =>
    els.map((el) => ({
      text: (el.innerText || "").trim(),
      disabled: el.disabled
    }))
  ).catch(() => []);

  const enabledButtons = buttons.filter((button) => !button.disabled);
  return extractTimesFromButtonText(enabledButtons);
}

async function clickMatchingBookerService(page, business) {
  const serviceName = cleanText(business.serviceName);
  const serviceId = String(
    business.platformServiceId ||
    business.serviceId ||
    business.serviceButtonId ||
    ""
  ).trim();

  if (!serviceName && !serviceId) {
    return false;
  }

  const clicked = await page.evaluate(
    ({ serviceName, serviceId }) => {
      function clean(value) {
        return String(value || "")
          .replace(/\s+/g, " ")
          .trim();
      }

      const serviceCards = Array.from(document.querySelectorAll("body *"))
        .filter((el) => {
          const text = clean(el.innerText || "");
          if (!text) return false;

          const hasBookButton = Array.from(el.querySelectorAll("button, a"))
            .some((button) => clean(button.innerText || "").toLowerCase() === "book");

          return hasBookButton && text.includes(serviceName);
        });

      let targetCard = serviceCards[0] || null;

      if (!targetCard && serviceId) {
        const idLink = document.querySelector(
          `a[href*="${serviceId}"], button[data-service-id="${serviceId}"], [href*="/service/${serviceId}/"]`
        );

        if (idLink) {
          targetCard = idLink.closest("article, section, div") || idLink;
        }
      }

      if (!targetCard) {
        return false;
      }

      const bookButton = Array.from(targetCard.querySelectorAll("button, a"))
        .find((button) => clean(button.innerText || "").toLowerCase() === "book");

      if (!bookButton) {
        return false;
      }

      bookButton.click();
      return true;
    },
    { serviceName, serviceId }
  ).catch(() => false);

  if (clicked) {
    await page.waitForTimeout(5000);
  }

  return clicked;
}

async function ensureAvailabilityPage(page, business, date) {
  const currentUrl = page.url();

  if (currentUrl.includes("/availability/")) {
    return true;
  }

  const bodyText = cleanText(await getBodyText(page));

  if (!bodyText.includes("SERVICES") && !bodyText.includes("Book")) {
    return false;
  }

  console.log("[BOOKER] Not on availability page. Trying service-menu click flow.");

  const clicked = await clickMatchingBookerService(page, business);

  if (!clicked) {
    console.log("[BOOKER] Could not click matching service from service menu.");
    return false;
  }

  console.log("[BOOKER] Clicked matching service.");
  console.log("[BOOKER] URL after service click:", page.url());

  if (page.url().includes("/availability/")) {
    return true;
  }

  const serviceId =
    business.platformServiceId ||
    business.serviceId ||
    business.serviceButtonId ||
    "";

  if (serviceId) {
    const fallbackUrl =
      `https://go.booker.com/location/AceofCups/service/${serviceId}/${encodeURIComponent(
        business.serviceName || "service"
      )}/availability/${date}/all-providers`;

    console.log("[BOOKER] Trying fallback availability URL:", fallbackUrl);

    await page.goto(fallbackUrl, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });

    await page.waitForTimeout(5000);

    return page.url().includes("/availability/");
  }

  return false;
}

async function scrapeBookerBusiness(browser, business) {
  const startedAt = Date.now();

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1000
    }
  });

  let rawWidgetText = "";

  try {
    if (!business.bookingUrl) {
      throw new Error("Missing bookingUrl for Booker business.");
    }

    const daysForward = Number(business.daysForward || 7);
    const originalDate = extractDateFromBookerUrl(business.bookingUrl);
    const startDate = isPastDate(originalDate)
      ? formatDateYYYYMMDD(getTodayLocalDate())
      : originalDate || formatDateYYYYMMDD(getTodayLocalDate());

    console.log(`\n[BOOKER] Opening ${business.businessName}`);
    console.log(`[BOOKER] Service: ${business.serviceName}`);
    console.log(`[BOOKER] Search start date: ${startDate}`);
    console.log(`[BOOKER] Days forward: ${daysForward}`);

    const triedDates = [];
    let finalDate = startDate;
    let finalUrl = business.bookingUrl;
    let finalTimes = [];

    for (let offset = 0; offset <= daysForward; offset++) {
      const date = formatDateYYYYMMDD(
        addDays(new Date(`${startDate}T12:00:00`), offset)
      );

      const url = buildBookerUrl(business.bookingUrl, date);

      triedDates.push(date);
      finalDate = date;
      finalUrl = url;

      console.log(`[BOOKER] Checking ${date}`);
      console.log("[BOOKER] URL:", url);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90000
      });

      await page.waitForTimeout(5000);

      console.log("[BOOKER] Current URL:", page.url());

      await ensureAvailabilityPage(page, business, date);

      rawWidgetText = await getBodyText(page);

      const times = await extractBookerTimesFromPage(page);

      if (times.length > 0) {
        finalTimes = times;
        finalUrl = page.url();
        console.log(`[BOOKER] Times found on ${date}: ${times.length}`);
        break;
      }

      const suggestedMatch = cleanText(rawWidgetText).match(
        /Suggested dates?:\s*([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2})/i
      );

      if (suggestedMatch) {
        console.log(`[BOOKER] Widget suggested: ${suggestedMatch[1]}`);
      }
    }

    console.log(`[BOOKER] Times found: ${finalTimes.length}`);

    return {
      businessName: business.businessName,
      bookingUrl: finalUrl || business.bookingUrl,
      platform: "booker",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      provider: business.providerText || "All providers",
      date: finalDate,
      times: finalTimes,
      status: finalTimes.length > 0 ? "success" : "no_times_found",
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: cleanText(rawWidgetText).slice(0, 5000),
      debug: {
        originalDate,
        startDate,
        daysForward,
        triedDates
      }
    };
  } catch (error) {
    console.error(`[BOOKER ERROR] ${business.businessName}: ${error.message}`);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "booker",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      provider: business.providerText || "All providers",
      date: null,
      times: [],
      status: "error",
      error: error.message,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: rawWidgetText ? cleanText(rawWidgetText).slice(0, 5000) : null
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  scrapeBookerBusiness
};