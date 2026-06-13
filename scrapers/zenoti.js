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

function formatZenotiDate(date) {
  return formatDateKey(date) + " 00:00:00";
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

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function buildDateList(startDateKey, endDateKey) {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);

  if (!start || !end) {
    return [];
  }

  const dates = [];
  let cursor = start;

  while (formatDateKey(cursor) <= formatDateKey(end)) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function getScrapeWindow(options = {}, business = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(
    1,
    Number(
      options.daysForward ||
        business.daysForward ||
        options.daysAhead ||
        7
    )
  );

  const scrapeStartDate = isDateKey(options.scrapeStartDate)
    ? options.scrapeStartDate
    : isDateKey(business.scrapeStartDate)
      ? business.scrapeStartDate
      : today;

  const defaultEndDate = formatDateKey(
    addDays(parseDateKey(scrapeStartDate), daysForward - 1)
  );

  const scrapeEndDate = isDateKey(options.scrapeEndDate)
    ? options.scrapeEndDate
    : isDateKey(business.scrapeEndDate)
      ? business.scrapeEndDate
      : defaultEndDate;

  const dateList = buildDateList(scrapeStartDate, scrapeEndDate);

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours:
      options.lookaheadHours ||
      business.lookaheadHours ||
      dateList.length * 24 ||
      daysForward * 24,
    daysForward: dateList.length || daysForward,
    scrapeWindowMode:
      options.scrapeWindowMode ||
      business.scrapeWindowMode ||
      "days_forward",
    dateList
  };
}

async function safeClick(page, text, timeout = 15000) {
  console.log(`[ZENOTI] Trying click: ${text}`);

  await page.waitForTimeout(2000);

  const locator = page.getByText(text, {
    exact: false
  }).first();

  const count = await page
    .getByText(text, {
      exact: false
    })
    .count()
    .catch(() => 0);

  console.log(`[ZENOTI] Matches for "${text}": ${count}`);

  if (!count) {
    return false;
  }

  try {
    await locator.scrollIntoViewIfNeeded();

    await locator.click({
      timeout
    });

    await page.waitForTimeout(5000);

    return true;
  } catch (error) {
    try {
      await locator.evaluate((el) => el.click());

      await page.waitForTimeout(5000);

      return true;
    } catch (innerError) {
      console.log(`[ZENOTI] Failed clicking "${text}"`);
      return false;
    }
  }
}

async function scrapeZenoti(business, options = {}) {
  const {
    serviceName = ""
  } = options;

  const scrapeWindow = getScrapeWindow(options, business);

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage({
    viewport: {
      width: 1400,
      height: 1200
    }
  });

  let authToken = null;
  let basePayload = null;
  let availableTimesUrl = null;

  try {
    page.on("request", (request) => {
      const url = request.url();

      if (url.includes("/Appointments/Availabletimes")) {
        availableTimesUrl = url;

        const headers = request.headers();

        if (headers.authorization) {
          authToken = headers.authorization;
        }

        try {
          const payload = request.postDataJSON();

          if (payload?.SlotBookings) {
            basePayload = payload;
          }
        } catch (error) {
          // ignore
        }
      }
    });

    console.log(`\n[ZENOTI] Opening ${business.businessName}`);
    console.log("[ZENOTI] Scrape window:", {
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode
    });

    if (!scrapeWindow.dateList.length) {
      throw new Error(
        `Invalid Zenoti scrape window: ${scrapeWindow.scrapeStartDate} to ${scrapeWindow.scrapeEndDate}`
      );
    }

    await page.goto(business.bookingUrl, {
      waitUntil: "networkidle",
      timeout: 90000
    });

    await page.waitForTimeout(10000);

    /*
      CATEGORY
    */

    if (business.categoryText) {
      const categoryClicked = await safeClick(
        page,
        business.categoryText
      );

      console.log(
        `[ZENOTI] Category clicked: ${categoryClicked}`
      );

      await page.waitForTimeout(8000);
    }

    /*
      PARENT SERVICE
    */

    if (business.parentServiceText) {
      const parentClicked = await safeClick(
        page,
        business.parentServiceText,
        20000
      );

      if (!parentClicked) {
        throw new Error(
          `Could not click parent service: ${business.parentServiceText}`
        );
      }

      console.log(
        `[ZENOTI] Parent service clicked`
      );

      await page.waitForTimeout(8000);
    }

    /*
      VARIANT / SERVICE
    */

    const serviceClicked = await safeClick(
      page,
      serviceName,
      20000
    );

    if (!serviceClicked) {
      throw new Error(
        `Could not click service: ${serviceName}`
      );
    }

    /*
      PROVIDER
    */

    if (business.providerText) {
      console.log(
        `[ZENOTI] Attempting provider selection: ${business.providerText}`
      );

      await page.waitForTimeout(5000);

      const providerClicked = await safeClick(
        page,
        business.providerText,
        15000
      );

      console.log(
        `[ZENOTI] Provider clicked: ${providerClicked}`
      );

      await page.waitForTimeout(12000);
    } else {
      await page.waitForTimeout(12000);
    }

    if (!authToken) {
      throw new Error(
        "Could not capture Zenoti auth token"
      );
    }

    if (!basePayload) {
      throw new Error(
        "Could not capture Zenoti availability payload"
      );
    }

    if (!availableTimesUrl) {
      throw new Error(
        "Could not capture Zenoti availability URL"
      );
    }

    console.log("[ZENOTI] Auth token captured");
    console.log("[ZENOTI] Base payload captured");

    const results = [];

    for (const date of scrapeWindow.dateList) {
      const payload = JSON.parse(
        JSON.stringify(basePayload)
      );

      const dateKey = formatDateKey(date);

      payload.CenterDate = formatZenotiDate(date);
      payload.CheckFutureDayAvailability = true;

      console.log(
        `[ZENOTI] Checking ${payload.CenterDate}`
      );

      const response = await page.evaluate(
        async ({
          availableTimesUrl,
          payload,
          authToken
        }) => {
          const res = await fetch(
            availableTimesUrl,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: authToken,
                application_name: "Webstore V2",
                application_version: "1.0.0",
                "x-languagecode": "en-US"
              },
              body: JSON.stringify(payload)
            }
          );

          return await res.json();
        },
        {
          availableTimesUrl,
          payload,
          authToken
        }
      );

      const slots = response.OpenSlots || [];

      console.log(
        `[ZENOTI] Slots found on ${dateKey}: ${slots.length}`
      );

      for (const slot of slots) {
        results.push({
          businessName: business.businessName,
          platform: "zenoti",
          service: serviceName,
          serviceName,
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId:
            business.platformServiceId ||
            business.serviceId ||
            business.serviceButtonId ||
            null,
          date: slot.Time || dateKey,
          time: slot.Time,
          startTime: slot.Time,
          bookingUrl: business.bookingUrl,
          scrapeStartDate: scrapeWindow.scrapeStartDate,
          scrapeEndDate: scrapeWindow.scrapeEndDate,
          lookaheadHours: scrapeWindow.lookaheadHours,
          daysForward: scrapeWindow.daysForward,
          scrapeWindowMode: scrapeWindow.scrapeWindowMode
        });
      }
    }

    await browser.close();

    return {
      success: true,
      businessName: business.businessName,
      platform: "zenoti",
      service: serviceName,
      serviceName,
      serviceType: business.serviceType || "",
      durationMinutes: business.durationMinutes || null,
      platformServiceId:
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        null,
      totalAppointments: results.length,
      appointments: results,
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode
    };
  } catch (error) {
    await browser.close();

    return {
      success: false,
      businessName: business.businessName,
      platform: "zenoti",
      error: error.message,
      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode
    };
  }
}

module.exports = {
  scrapeZenoti
};