// scrapers/schedulista.js

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(value) {
  if (!isDateKey(value)) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function getTodayDateKey() {
  const now = new Date();
  return formatDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function buildDateList(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  if (!start || !end) return [];

  const dates = [];
  let cursor = start;

  while (formatDateKey(cursor) <= formatDateKey(end)) {
    dates.push(formatDateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function getScrapeWindow(business = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(1, Number(business.daysForward || 1));

  const scrapeStartDate = isDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : today;

  const defaultEndDate = formatDateKey(
    addDays(parseDateKey(scrapeStartDate), daysForward - 1)
  );

  const scrapeEndDate = isDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : defaultEndDate;

  const dateList = buildDateList(scrapeStartDate, scrapeEndDate);

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours: business.lookaheadHours || dateList.length * 24 || daysForward * 24,
    daysForward: dateList.length || daysForward,
    scrapeWindowMode: business.scrapeWindowMode || "days_forward",
    dateList
  };
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

  if (cleanBase.includes("schedulista.com/schedule/")) {
    return `${cleanBase}/choose_time?service_id=${serviceId}`;
  }

  return `${cleanBase}/choose_time?service_id=${serviceId}`;
}

function buildChooseTimeUrlFromServiceHref(serviceHref, serviceId) {
  const href = String(serviceHref || "");
  return href.replace(/choose_provider.*$/i, `choose_time?service_id=${serviceId}`);
}

function addDateToChooseTimeUrl(chooseTimeUrl, dateKey) {
  const url = new URL(chooseTimeUrl);

  url.searchParams.set("date", dateKey);

  return url.toString();
}

function buildOpenings({
  business,
  serviceId,
  dateKey,
  times,
  scrapeWindow
}) {
  return times.map((time) => ({
    businessName: business.businessName,
    bookingUrl: business.bookingUrl,
    platform: "schedulista",
    service: business.serviceName || null,
    serviceName: business.serviceName || null,
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    platformServiceId:
      business.platformServiceId ||
      business.serviceId ||
      serviceId ||
      null,
    serviceId,
    provider: "No preference -- see all available times",
    date: dateKey,
    appointmentDate: dateKey,
    time,
    appointmentTime: time,
    startTime: `${dateKey} ${time}`,
    scrapeStartDate: scrapeWindow.scrapeStartDate,
    scrapeEndDate: scrapeWindow.scrapeEndDate,
    lookaheadHours: scrapeWindow.lookaheadHours,
    daysForward: scrapeWindow.daysForward,
    scrapeWindowMode: scrapeWindow.scrapeWindowMode
  }));
}

async function scrapeSchedulistaBusiness(browser, business) {
  const startedAt = Date.now();
  const scrapeWindow = getScrapeWindow(business);

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

    if (!scrapeWindow.dateList.length) {
      throw new Error(
        `Invalid Schedulista scrape window: ${scrapeWindow.scrapeStartDate} to ${scrapeWindow.scrapeEndDate}`
      );
    }

    console.log(`\n[Schedulista] Scraping: ${business.businessName}`);
    console.log(`[Schedulista] Opening: ${bookingUrl}`);
    console.log("[Schedulista] Scrape window:", {
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode
    });

    await page.goto(bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(2500);

    let serviceId = business.serviceId || business.platformServiceId || null;
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
        serviceName: business.serviceName || null,
        serviceType: business.serviceType || "",
        durationMinutes: business.durationMinutes || null,
        provider: "No preference -- see all available times",
        date: null,
        times: [],
        openings: [],
        appointments: [],
        status: "service_not_found",
        scrapeDurationMs: Date.now() - startedAt,
        lastChecked: new Date().toISOString(),
        rawWidgetText: bodyText.slice(0, 5000),
        error: `Could not find service: ${business.serviceName}`,
        scrapeStartDate: scrapeWindow.scrapeStartDate,
        scrapeEndDate: scrapeWindow.scrapeEndDate,
        lookaheadHours: scrapeWindow.lookaheadHours,
        daysForward: scrapeWindow.daysForward,
        scrapeWindowMode: scrapeWindow.scrapeWindowMode
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
    console.log(`[Schedulista] Base choose time URL: ${chooseTimeUrl}`);

    const allOpenings = [];
    const triedDates = [];
    let rawWidgetText = "";
    let nextAvailableDate = null;
    let resultStatus = "no_times_found";

    for (const dateKey of scrapeWindow.dateList) {
      triedDates.push(dateKey);

      const datedChooseTimeUrl = addDateToChooseTimeUrl(chooseTimeUrl, dateKey);

      console.log(`[Schedulista] Checking ${dateKey}`);
      console.log(`[Schedulista] URL: ${datedChooseTimeUrl}`);

      await page.goto(datedChooseTimeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(3000);

      const bodyText = cleanText(await page.locator("body").innerText().catch(() => ""));
      rawWidgetText = bodyText;

      const times = extractTimesFromText(bodyText);
      const nextDate = extractNextAvailableDate(bodyText);

      if (nextDate) {
        nextAvailableDate = nextDate;
      }

      if (times.length > 0) {
        resultStatus = "success";

        allOpenings.push(
          ...buildOpenings({
            business,
            serviceId,
            dateKey,
            times,
            scrapeWindow
          })
        );
      } else if (/no available appointment times today/i.test(bodyText)) {
        resultStatus = resultStatus === "success" ? resultStatus : "no_times_found";
      } else if (nextDate) {
        resultStatus = resultStatus === "success" ? resultStatus : "next_available_found";
      }
    }

    const allTimes = allOpenings
      .map((opening) => opening.time)
      .filter(Boolean);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "schedulista",
      service: business.serviceName || null,
      serviceName: business.serviceName || null,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        serviceId ||
        null,
      serviceId,
      provider: "No preference -- see all available times",
      date: allOpenings[0]?.date || nextAvailableDate || null,
      times: allTimes,
      openings: allOpenings,
      appointments: allOpenings,
      status: allOpenings.length > 0 ? "success" : resultStatus,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: rawWidgetText.slice(0, 5000),
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode,
      debug: {
        triedDates,
        nextAvailableDate
      }
    };
  } catch (error) {
    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "schedulista",
      service: business.serviceName || null,
      serviceName: business.serviceName || null,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      provider: "No preference -- see all available times",
      date: null,
      times: [],
      openings: [],
      appointments: [],
      status: "error",
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: null,
      error: error.message,
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode
    };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = {
  scrapeSchedulistaBusiness
};