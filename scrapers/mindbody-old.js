const { chromium } = require("playwright");

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

function getScrapeWindow(business = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(1, Number(business.daysForward || 7));

  const scrapeStartDate = isDateKey(business.scrapeStartDate)
    ? business.scrapeStartDate
    : today;

  const defaultEndDate = formatDateKey(
    addDays(parseDateKey(scrapeStartDate), daysForward - 1)
  );

  const scrapeEndDate = isDateKey(business.scrapeEndDate)
    ? business.scrapeEndDate
    : defaultEndDate;

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours: business.lookaheadHours || daysForward * 24,
    daysForward,
    scrapeWindowMode: business.scrapeWindowMode || "days_forward"
  };
}

function dateInsideWindow(dateKey, scrapeWindow) {
  if (!isDateKey(dateKey)) return false;

  if (isDateKey(scrapeWindow.scrapeStartDate) && dateKey < scrapeWindow.scrapeStartDate) {
    return false;
  }

  if (isDateKey(scrapeWindow.scrapeEndDate) && dateKey > scrapeWindow.scrapeEndDate) {
    return false;
  }

  return true;
}

function parseDateFromText(value = "") {
  const text = String(value || "");

  const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const parsed = new Date(`${text} 12:00:00`);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateKey(parsed);
  }

  return "";
}

async function selectAvailableDateInsideWindow(page, scrapeWindow) {
  const selected = await page.evaluate(
    ({ scrapeStartDate, scrapeEndDate }) => {
      function clean(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
      }

      function dateFromText(value) {
        const text = String(value || "");

        const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
        if (isoMatch) return isoMatch[1];

        return "";
      }

      const links = Array.from(document.querySelectorAll('.healcode a[href="#"], a[href="#"]'));

      const candidates = links.map((link) => {
        const text = clean(link.innerText || link.textContent || "");
        const aria = clean(link.getAttribute("aria-label") || "");
        const title = clean(link.getAttribute("title") || "");
        const dataDate = clean(
          link.getAttribute("data-date") ||
            link.getAttribute("data-day") ||
            link.getAttribute("data-value") ||
            ""
        );

        const combined = [dataDate, aria, title, text].filter(Boolean).join(" ");
        const dateKey = dateFromText(combined);

        return {
          text,
          aria,
          title,
          dataDate,
          dateKey,
          hasDate: Boolean(dateKey),
          link
        };
      });

      const datedMatch = candidates.find((candidate) => {
        if (!candidate.dateKey) return false;
        if (scrapeStartDate && candidate.dateKey < scrapeStartDate) return false;
        if (scrapeEndDate && candidate.dateKey > scrapeEndDate) return false;
        return true;
      });

      const fallbackMatch = datedMatch || candidates[0];

      if (!fallbackMatch) {
        return null;
      }

      fallbackMatch.link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      fallbackMatch.link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      fallbackMatch.link.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      return {
        text: fallbackMatch.text,
        aria: fallbackMatch.aria,
        title: fallbackMatch.title,
        dataDate: fallbackMatch.dataDate,
        dateKey: fallbackMatch.dateKey,
        dateWasExplicit: fallbackMatch.hasDate
      };
    },
    {
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate
    }
  );

  if (!selected) {
    return null;
  }

  if (selected.dateKey && dateInsideWindow(selected.dateKey, scrapeWindow)) {
    return selected;
  }

  return {
    ...selected,
    dateKey: scrapeWindow.scrapeStartDate,
    dateWasExplicit: false,
    dateFallbackUsed: true
  };
}

function buildOpeningsFromTherapists({
  therapistBlocks = [],
  business = {},
  selectedDateKey = "",
  scrapeWindow = {}
}) {
  const openings = [];

  for (const therapist of therapistBlocks) {
    for (const time of therapist.times || []) {
      openings.push({
        businessName: business.businessName,
        platform: "mindbody-old",
        serviceName: business.serviceName,
        service: business.serviceName,
        serviceType: business.serviceType || "",
        durationMinutes: business.durationMinutes || null,
        platformServiceId:
          business.platformServiceId ||
          business.serviceButtonId ||
          business.serviceId ||
          null,
        therapistName: therapist.name || "",
        providerName: therapist.name || "",
        date: selectedDateKey,
        appointmentDate: selectedDateKey,
        time,
        appointmentTime: time,
        startTime: selectedDateKey ? `${selectedDateKey} ${time}` : time,
        bookingUrl: business.bookingUrl,
        ...scrapeWindow
      });
    }
  }

  return openings;
}

async function scrapeMindbodyOldBusiness(browser, business) {
  const startedAt = Date.now();
  const scrapeWindow = getScrapeWindow(business);

  const page = await browser.newPage();

  try {
    console.log(`\n[MINDBODY-OLD] Opening ${business.businessName}`);
    console.log("[MINDBODY-OLD] Scrape window:", scrapeWindow);

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

    console.log("[MINDBODY-OLD] Clicking first available date inside scrape window");

    const selectedDate = await selectAvailableDateInsideWindow(page, scrapeWindow);

    if (!selectedDate) {
      throw new Error(
        `No available Mindbody-old date found inside scrape window ${scrapeWindow.scrapeStartDate} to ${scrapeWindow.scrapeEndDate}.`
      );
    }

    const selectedDateKey =
      selectedDate.dateKey ||
      parseDateFromText(selectedDate.text) ||
      scrapeWindow.scrapeStartDate;

    console.log("[MINDBODY-OLD] Selected date:", selectedDateKey);

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

    const openings = buildOpeningsFromTherapists({
      therapistBlocks,
      business,
      selectedDateKey,
      scrapeWindow
    });

    return {
      businessName: business.businessName,
      bookingUrl: business.bookingUrl,
      platform: "mindbody-old",
      service: business.serviceName,
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceButtonId ||
        business.serviceId ||
        null,
      provider:
        business.staffValue === ""
          ? "All therapists"
          : business.staffValue,
      date: selectedDateKey,
      times: uniqueTimes,
      openings,
      appointments: openings,
      therapistAvailability: therapistBlocks,
      status:
        uniqueTimes.length > 0
          ? "success"
          : "no_times_found",
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: text,
      ...scrapeWindow,
      debug: {
        selectedDate,
        selectedDateKey
      }
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
      serviceName: business.serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceButtonId ||
        business.serviceId ||
        null,
      provider: business.staffValue || "All therapists",
      date: null,
      times: [],
      openings: [],
      appointments: [],
      therapistAvailability: [],
      status: "error",
      error: error.message,
      scrapeDurationMs: Date.now() - startedAt,
      lastChecked: new Date().toISOString(),
      rawWidgetText: null,
      ...scrapeWindow
    };
  } finally {
    await page.close();
  }
}

module.exports = {
  scrapeMindbodyOldBusiness
};