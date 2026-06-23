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
  return match ? cleanText(match[1]) : null;
}

function parseNextAvailableDateKey(nextAvailableText, referenceDateKey = getTodayDateKey()) {
  const text = cleanText(nextAvailableText);
  if (!text) return null;

  const reference = parseDateKey(referenceDateKey) || parseDateKey(getTodayDateKey());
  if (!reference) return null;

  const lower = text.toLowerCase();

  if (lower.includes("tomorrow")) {
    return formatDateKey(addDays(reference, 1));
  }

  const weekdayMap = {
    sunday: 0,
    sun: 0,
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    tues: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    thurs: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6
  };

  const weekdayNames = Object.keys(weekdayMap).join("|");
  const weekdayMatch = lower.match(new RegExp(`\\b(${weekdayNames})\\b`));

  if (weekdayMatch) {
    const targetDay = weekdayMap[weekdayMatch[1]];
    const currentDay = reference.getDay();
    let diff = targetDay - currentDay;

    if (diff <= 0) diff += 7;

    return formatDateKey(addDays(reference, diff));
  }

  const monthMap = {
    january: 0,
    jan: 0,
    february: 1,
    feb: 1,
    march: 2,
    mar: 2,
    april: 3,
    apr: 3,
    may: 4,
    june: 5,
    jun: 5,
    july: 6,
    jul: 6,
    august: 7,
    aug: 7,
    september: 8,
    sep: 8,
    sept: 8,
    october: 9,
    oct: 9,
    november: 10,
    nov: 10,
    december: 11,
    dec: 11
  };

  const monthNames = Object.keys(monthMap).join("|");
  const monthDayMatch = lower.match(
    new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(st|nd|rd|th)?\\b`)
  );

  if (monthDayMatch) {
    const monthIndex = monthMap[monthDayMatch[1]];
    const day = Number(monthDayMatch[2]);
    let year = reference.getFullYear();

    const candidate = new Date(year, monthIndex, day, 12, 0, 0);

    if (candidate < reference) {
      year += 1;
    }

    return formatDateKey(new Date(year, monthIndex, day, 12, 0, 0));
  }

  return null;
}

function safeAbsoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return String(value || "");
  }
}

function normalizeSchedulistaScheduleUrl(urlValue) {
  const raw = String(urlValue || "").trim();

  if (!raw.includes("schedulista.com/schedule/")) {
    return "";
  }

  const noHash = raw.split("#")[0];
  const noQuery = noHash.split("?")[0];

  return noQuery.replace(/\/(choose_time|choose_provider|choose_service).*$/i, "").replace(/\/+$/, "");
}

function buildChooseTimeUrl(baseScheduleUrl, serviceId) {
  const cleanBase = normalizeSchedulistaScheduleUrl(baseScheduleUrl) ||
    String(baseScheduleUrl || "").replace(/\/+$/, "");

  return `${cleanBase}/choose_time?service_id=${serviceId}`;
}

function buildChooseTimeUrlFromServiceHref(serviceHref, serviceId) {
  const href = String(serviceHref || "");

  if (/choose_time/i.test(href)) {
    return href;
  }

  return href.replace(/choose_provider.*$/i, `choose_time?service_id=${serviceId}`);
}

function addDateToChooseTimeUrl(chooseTimeUrl, dateKey) {
  const url = new URL(chooseTimeUrl);
  url.searchParams.set("date", dateKey);
  return url.toString();
}

function getDateKeyFromUrl(urlValue) {
  try {
    const url = new URL(urlValue);
    const date = url.searchParams.get("date");
    return isDateKey(date) ? date : null;
  } catch {
    return null;
  }
}

function isDateInsideWindow(dateKey, scrapeWindow) {
  if (!isDateKey(dateKey)) return false;
  return dateKey >= scrapeWindow.scrapeStartDate && dateKey <= scrapeWindow.scrapeEndDate;
}

async function resolveSchedulistaScheduleBase(page, bookingUrl, business = {}) {
  if (business.schedulistaScheduleUrl) {
    return normalizeSchedulistaScheduleUrl(business.schedulistaScheduleUrl);
  }

  if (business.scheduleUrl) {
    const normalized = normalizeSchedulistaScheduleUrl(business.scheduleUrl);
    if (normalized) return normalized;
  }

  if (String(bookingUrl || "").includes("schedulista.com/schedule/")) {
    return normalizeSchedulistaScheduleUrl(bookingUrl);
  }

  const discovered = await page.evaluate(() => {
    const urls = [];

    document.querySelectorAll("iframe[src], a[href], script[src]").forEach((node) => {
      const value = node.getAttribute("src") || node.getAttribute("href") || "";
      if (value && value.includes("schedulista.com/schedule/")) {
        urls.push(value);
      }
    });

    const html = document.documentElement.innerHTML || "";
    const matches = html.match(/https?:\/\/[^"'<> ]*schedulista\.com\/schedule\/[^"'<> ]+/gi) || [];
    urls.push(...matches);

    return urls;
  }).catch(() => []);

  for (const url of discovered) {
    const absolute = safeAbsoluteUrl(url, page.url());
    const normalized = normalizeSchedulistaScheduleUrl(absolute);

    if (normalized) {
      return normalized;
    }
  }

  return "";
}

async function findServiceLinkAndId(page, serviceName, business = {}) {
  const targetServiceName = String(serviceName || "").toLowerCase();

  const links = page.locator("a");
  const linkCount = await links.count();

  for (let i = 0; i < linkCount; i++) {
    const link = links.nth(i);

    const text = cleanText(await link.innerText().catch(() => ""));
    const href = await link.getAttribute("href").catch(() => null);

    if (!text || !href) {
      continue;
    }

    const exactMatch = text.toLowerCase() === targetServiceName;

    const looseMatch =
      business.allowLooseServiceMatch === true &&
      text.toLowerCase().includes(targetServiceName);

    if (exactMatch || looseMatch) {
      const absoluteHref = safeAbsoluteUrl(href, page.url());

      return {
        serviceHref: absoluteHref,
        serviceId: extractServiceIdFromUrl(absoluteHref)
      };
    }
  }

  return {
    serviceHref: null,
    serviceId: null
  };
}

async function clickSchedulistaDate(page, dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return false;

  const targetDay = String(parsed.getDate());

  const dateHref = page.locator(`a[href*="${dateKey}"], button[href*="${dateKey}"]`).first();

  if ((await dateHref.count().catch(() => 0)) > 0) {
    if (await dateHref.isVisible().catch(() => false)) {
      await dateHref.click({ timeout: 5000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      return true;
    }
  }

  const candidateSelectors = [
    "a",
    "button",
    "[role='button']",
    "td",
    "div"
  ];

  for (const selector of candidateSelectors) {
    const candidates = page.locator(selector).filter({
      hasText: new RegExp(`^\\s*${targetDay}\\s*$`)
    });

    const count = await candidates.count().catch(() => 0);

    for (let i = 0; i < Math.min(count, 20); i++) {
      const item = candidates.nth(i);

      const visible = await item.isVisible().catch(() => false);
      if (!visible) continue;

      const className = await item.getAttribute("class").catch(() => "") || "";
      const ariaDisabled = await item.getAttribute("aria-disabled").catch(() => "") || "";
      const disabled = await item.getAttribute("disabled").catch(() => "") || "";

      if (/disabled|unavailable|inactive/i.test(className)) continue;
      if (ariaDisabled === "true" || disabled) continue;

      await item.click({ timeout: 5000 }).catch(() => null);
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);

      return true;
    }
  }

  return false;
}

async function clickNextAvailablePrompt(page) {
  const clickable = page
    .locator("a, button")
    .filter({
      hasText: /next available|available time is on|go to next|next available time/i
    })
    .first();

  if ((await clickable.count().catch(() => 0)) > 0) {
    if (await clickable.isVisible().catch(() => false)) {
      await clickable.click({ timeout: 5000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);
      return true;
    }
  }

  const nextHref = await page
    .locator("a")
    .evaluateAll((links) => {
      const found = links.find((link) => {
        const text = String(link.innerText || link.textContent || "").toLowerCase();
        return (
          text.includes("next available") ||
          text.includes("available time is on") ||
          text.includes("go to next")
        );
      });

      return found ? found.href : "";
    })
    .catch(() => "");

  if (nextHref) {
    await page.goto(nextHref, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(2500);
    return true;
  }

  return false;
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

    await page.waitForTimeout(3000);

    const scheduleBaseUrl = await resolveSchedulistaScheduleBase(page, bookingUrl, business);

    let serviceId = business.serviceId || business.platformServiceId || null;
    let serviceHref = null;

    const serviceLookup = await findServiceLinkAndId(page, serviceName, business);

    if (serviceLookup.serviceHref) {
      serviceHref = serviceLookup.serviceHref;
    }

    if (!serviceId && serviceLookup.serviceId) {
      serviceId = serviceLookup.serviceId;
    }

    if (!serviceId && business.chooseTimeUrl) {
      serviceId = extractServiceIdFromUrl(business.chooseTimeUrl);
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
        scrapeWindowMode: scrapeWindow.scrapeWindowMode,
        debug: {
          scheduleBaseUrl,
          serviceHref
        }
      };
    }

    let chooseTimeUrl;

    if (business.chooseTimeUrl) {
      chooseTimeUrl = business.chooseTimeUrl;
    } else if (serviceHref && serviceHref.includes("schedulista.com/schedule/")) {
      chooseTimeUrl = buildChooseTimeUrlFromServiceHref(serviceHref, serviceId);
    } else if (scheduleBaseUrl) {
      chooseTimeUrl = buildChooseTimeUrl(scheduleBaseUrl, serviceId);
    } else if (String(bookingUrl || "").includes("schedulista.com/schedule/")) {
      chooseTimeUrl = buildChooseTimeUrl(bookingUrl, serviceId);
    } else {
      throw new Error(
        `Could not resolve real Schedulista schedule URL for ${business.businessName}. Add chooseTimeUrl or schedulistaScheduleUrl to businesses.json.`
      );
    }

    console.log(`[Schedulista] Schedule base URL: ${scheduleBaseUrl || "not found"}`);
    console.log(`[Schedulista] Service ID: ${serviceId}`);
    console.log(`[Schedulista] Base choose time URL: ${chooseTimeUrl}`);

    const allOpenings = [];
    const triedDates = [];
    const followedNextAvailableDates = [];
    let rawWidgetText = "";
    let nextAvailableDate = null;
    let resultStatus = "no_times_found";

    const dateQueue = [...scrapeWindow.dateList];
    const seenDates = new Set();

    while (dateQueue.length > 0) {
      const dateKey = dateQueue.shift();

      if (!isDateInsideWindow(dateKey, scrapeWindow) || seenDates.has(dateKey)) {
        continue;
      }

      seenDates.add(dateKey);
      triedDates.push(dateKey);

      console.log(`[Schedulista] Checking ${dateKey}`);

      await page.goto(chooseTimeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(2500);

      const clickedDate = await clickSchedulistaDate(page, dateKey);

      if (!clickedDate) {
        console.log(`[Schedulista] Could not click calendar date ${dateKey}; trying URL param fallback.`);

        const datedChooseTimeUrl = addDateToChooseTimeUrl(chooseTimeUrl, dateKey);

        await page.goto(datedChooseTimeUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        });

        await page.waitForTimeout(2500);
      }

      let effectiveDateKey = getDateKeyFromUrl(page.url()) || dateKey;

      let bodyText = cleanText(await page.locator("body").innerText().catch(() => ""));
      rawWidgetText = bodyText;

      let times = extractTimesFromText(bodyText);
      let nextDateText = extractNextAvailableDate(bodyText);

      if (nextDateText) {
        nextAvailableDate = nextDateText;
      }

      if (!times.length && nextDateText) {
        const nextDateKey = parseNextAvailableDateKey(nextDateText, dateKey);

        if (nextDateKey && isDateInsideWindow(nextDateKey, scrapeWindow)) {
          followedNextAvailableDates.push(nextDateKey);

          const clickedNext = await clickNextAvailablePrompt(page);

          if (clickedNext) {
            await page.waitForTimeout(2500);

            const clickedUrlDateKey = getDateKeyFromUrl(page.url());

            effectiveDateKey =
              clickedUrlDateKey && isDateInsideWindow(clickedUrlDateKey, scrapeWindow)
                ? clickedUrlDateKey
                : nextDateKey;

            bodyText = cleanText(await page.locator("body").innerText().catch(() => ""));
            rawWidgetText = bodyText;
            times = extractTimesFromText(bodyText);

            if (times.length > 0) {
              resultStatus = "success";

              allOpenings.push(
                ...buildOpenings({
                  business,
                  serviceId,
                  dateKey: effectiveDateKey,
                  times,
                  scrapeWindow
                })
              );

              seenDates.add(effectiveDateKey);
              continue;
            }
          }

          if (!seenDates.has(nextDateKey)) {
            dateQueue.unshift(nextDateKey);
          }
        }
      }

      if (times.length > 0) {
        resultStatus = "success";

        allOpenings.push(
          ...buildOpenings({
            business,
            serviceId,
            dateKey: effectiveDateKey,
            times,
            scrapeWindow
          })
        );
      } else if (/no available appointment times today/i.test(bodyText)) {
        resultStatus = resultStatus === "success" ? resultStatus : "no_times_found";
      } else if (nextDateText) {
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
        nextAvailableDate,
        followedNextAvailableDates,
        scheduleBaseUrl,
        chooseTimeUrl
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