// scrapers/axl3.js

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function formatDateKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(value) {
  if (!isDateKey(value)) {
    return null;
  }

  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
}

function getTodayDateKey() {
  const now = new Date();
  return formatDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
}

function addDaysToDateKey(dateKey, daysToAdd) {
  const date = parseDateKey(dateKey) || parseDateKey(getTodayDateKey());
  date.setDate(date.getDate() + Number(daysToAdd || 0));
  return formatDateKey(date);
}

function getScrapeWindowPayload(business = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(1, Number(business.daysForward || 1));

  const scrapeStartDate = isDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : today;

  const scrapeEndDate = isDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : addDaysToDateKey(scrapeStartDate, daysForward - 1);

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours: business.lookaheadHours ? Number(business.lookaheadHours) : daysForward * 24,
    daysForward,
    scrapeWindowMode: business.scrapeWindowMode || "days_forward"
  };
}

function dateIsInsideWindow(dateKey, scrapeWindow) {
  if (!isDateKey(dateKey)) {
    return false;
  }

  if (isDateKey(scrapeWindow.scrapeStartDate) && dateKey < scrapeWindow.scrapeStartDate) {
    return false;
  }

  if (isDateKey(scrapeWindow.scrapeEndDate) && dateKey > scrapeWindow.scrapeEndDate) {
    return false;
  }

  return true;
}

function getMonthNumberFromName(value) {
  const months = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12
  };

  return months[String(value || "").toLowerCase()] || null;
}

function parseVisibleMonthYear(text = "") {
  const match = String(text || "").match(
    /\b(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sep|Sept|October|Oct|November|Nov|December|Dec)\s+(\d{4})\b/i
  );

  if (!match) {
    return null;
  }

  return {
    month: getMonthNumberFromName(match[1]),
    year: Number(match[2])
  };
}

async function getVisibleCalendarMonthYear(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return parseVisibleMonthYear(bodyText);
}

async function clickNextMonth(page) {
  const clicked = await page.evaluate(() => {
    const normalize = (value) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const candidates = Array.from(
      document.querySelectorAll("button, a, [role='button'], .next, .datepicker-next, .datepicker-controls .next")
    );

    const match = candidates.find((el) => {
      const text = normalize(el.textContent);
      const className = normalize(el.className);
      const aria = normalize(el.getAttribute("aria-label"));

      return (
        text === "next" ||
        text === ">" ||
        text === "›" ||
        aria.includes("next") ||
        className.includes("next")
      );
    });

    if (!match) return false;

    match.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    match.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    match.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    return true;
  });

  if (clicked) {
    await page.waitForTimeout(1500);
  }

  return clicked;
}

function getDateKeyFromVisibleDay(dayText, monthYear) {
  if (!monthYear || !monthYear.year || !monthYear.month) {
    return "";
  }

  const day = Number(String(dayText || "").trim());

  if (!day || Number.isNaN(day)) {
    return "";
  }

  return `${monthYear.year}-${pad2(monthYear.month)}-${pad2(day)}`;
}

async function selectFirstAvailableDateInsideWindow(page, scrapeWindow) {
  const maxMonthClicks = 18;

  for (let monthAttempt = 0; monthAttempt <= maxMonthClicks; monthAttempt += 1) {
    const monthYear = await getVisibleCalendarMonthYear(page);

    const selected = await page.evaluate(
      ({ scrapeStartDate, scrapeEndDate, monthYear }) => {
        function pad2(value) {
          return String(value).padStart(2, "0");
        }

        function dateKeyFromCell(cell) {
          const text = String(cell.textContent || "").trim();
          const day = Number(text);

          if (!monthYear || !monthYear.year || !monthYear.month || !day) {
            return "";
          }

          return `${monthYear.year}-${pad2(monthYear.month)}-${pad2(day)}`;
        }

        const cells = Array.from(document.querySelectorAll(".datepicker-cell.day"));

        const availableCells = cells.filter((cell) => {
          const className = String(cell.className || "");

          return (
            !className.includes("disabled") &&
            !className.includes("prev") &&
            !className.includes("next")
          );
        });

        const matchingCell = availableCells.find((cell) => {
          const dateKey = dateKeyFromCell(cell);

          if (!dateKey) return false;
          if (scrapeStartDate && dateKey < scrapeStartDate) return false;
          if (scrapeEndDate && dateKey > scrapeEndDate) return false;

          return true;
        });

        if (!matchingCell) {
          return null;
        }

        const dateKey = dateKeyFromCell(matchingCell);
        const text = String(matchingCell.textContent || "").trim();

        matchingCell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        matchingCell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        matchingCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        return {
          text,
          dateKey
        };
      },
      {
        scrapeStartDate: scrapeWindow.scrapeStartDate,
        scrapeEndDate: scrapeWindow.scrapeEndDate,
        monthYear
      }
    );

    if (selected && selected.dateKey) {
      return selected;
    }

    const visibleDateKey =
      monthYear && monthYear.year && monthYear.month
        ? `${monthYear.year}-${pad2(monthYear.month)}-01`
        : "";

    if (
      visibleDateKey &&
      isDateKey(scrapeWindow.scrapeEndDate) &&
      visibleDateKey > scrapeWindow.scrapeEndDate
    ) {
      return null;
    }

    const clickedNext = await clickNextMonth(page);

    if (!clickedNext) {
      return null;
    }
  }

  return null;
}

async function scrapeAxl3Business(browser, business) {
  const startTime = Date.now();
  const scrapeWindow = getScrapeWindowPayload(business);

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1000 }
  });

  try {
    console.log(`\n[AXL3] Opening ${business.businessName}`);
    console.log("[AXL3] Scrape window:", scrapeWindow);

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

    console.log("[AXL3] Selecting first available date inside scrape window...");

    const selectedDate = await selectFirstAvailableDateInsideWindow(page, scrapeWindow);

    if (!selectedDate || !selectedDate.dateKey) {
      throw new Error(
        `No selectable AXL3 date found inside scrape window ${scrapeWindow.scrapeStartDate} to ${scrapeWindow.scrapeEndDate}.`
      );
    }

    console.log("[AXL3] Selected date:", selectedDate.dateKey);

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
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      provider: null,
      date: selectedDate.dateKey,
      selectedDateText: selectedDate.text,
      times: uniqueTimes,
      status: uniqueTimes.length > 0 ? "success" : "no_times_found",
      scrapeDurationMs: Date.now() - startTime,
      lastChecked: new Date().toISOString(),
      rawWidgetText: cleanBody.slice(0, 5000),
      ...scrapeWindow,
      debug: {
        selectedDate,
        scrapeWindow
      }
    };
  } catch (error) {
    console.error("[AXL3 ERROR]", error.message);

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "axl3",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      provider: null,
      date: null,
      times: [],
      status: "error",
      error: error.message,
      scrapeDurationMs: Date.now() - startTime,
      lastChecked: new Date().toISOString(),
      ...scrapeWindow
    };
  } finally {
    await page.close();
  }
}

module.exports = {
  scrapeAxl3Business
};