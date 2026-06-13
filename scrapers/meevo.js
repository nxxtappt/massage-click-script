// scrapers/meevo.js

const { chromium } = require("playwright");

function clean(value) {
  return String(value || "")
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

function getScrapeWindow(options = {}) {
  const today = getTodayDateKey();
  const daysForward = Math.max(1, Number(options.daysForward || 7));

  const scrapeStartDate = isDateKey(options.scrapeStartDate)
    ? options.scrapeStartDate
    : today;

  const defaultEndDate = formatDateKey(
    addDays(parseDateKey(scrapeStartDate), daysForward - 1)
  );

  const scrapeEndDate = isDateKey(options.scrapeEndDate)
    ? options.scrapeEndDate
    : defaultEndDate;

  return {
    scrapeStartDate,
    scrapeEndDate,
    lookaheadHours: options.lookaheadHours || daysForward * 24,
    daysForward,
    scrapeWindowMode: options.scrapeWindowMode || "days_forward"
  };
}

async function scrapeMeevoAvailability(options = {}) {
  const {
    bookingUrl,
    categoryName = "Swedish Massage",
    serviceName = "1 Hour Swedish Massage"
  } = options;

  const scrapeWindow = getScrapeWindow(options);

  if (!bookingUrl) {
    throw new Error("bookingUrl required");
  }

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1400,
      height: 1200
    },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    console.log("Initializing Meevo session...");
    console.log("[MEEVO] Scrape window:", scrapeWindow);

    await page.goto(bookingUrl, {
      waitUntil: "networkidle",
      timeout: 90000
    });

    await page.waitForTimeout(5000);

    async function api(path, body) {
      return await page.evaluate(
        async ({ path, body }) => {
          const response = await fetch(path, {
            method: "POST",
            credentials: "include",
            headers: {
              "content-type": "application/json"
            },
            body: JSON.stringify(body)
          });

          return await response.json();
        },
        { path, body }
      );
    }

    console.log("Loading service categories...");

    const categories = await api(
      "/onlinebooking/api/ob/servicecategory/list",
      {
        pageNumber: 0,
        itemsPerPage: 999,
        sortBy: "",
        sortDirection: 0,
        criteria: {
          objectState: 2026,
          includeActive: true,
          view: 1
        }
      }
    );

    const category = categories.find((item) =>
      clean(item.displayName)
        .toLowerCase()
        .includes(categoryName.toLowerCase())
    );

    if (!category) {
      throw new Error(`Category not found: ${categoryName}`);
    }

    console.log("Category found:");
    console.log(category.displayName);

    console.log("Loading services...");

    const services = await api(
      "/onlinebooking/api/ob/service/list",
      {
        pageNumber: 0,
        itemsPerPage: 999,
        sortBy: "",
        sortDirection: 0,
        criteria: {
          canBookOnline: true,
          isBookable: true,
          serviceCategoryId: category.id
        }
      }
    );

    const service = services.find((item) =>
      clean(item.displayName)
        .toLowerCase()
        .includes(serviceName.toLowerCase())
    );

    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    console.log("Service found:");
    console.log(service.displayName);

    console.log("Loading add-ons...");

    const addOns = await api(
      `/onlinebooking/api/ob/service/${service.id}/AddOns`,
      {
        id: service.id,
        clientId: null
      }
    );

    console.log(
      "Add-ons loaded:",
      addOns.addOnServices?.length || 0
    );

    console.log("Loading therapists...");

    const therapists = await api(
      "/onlinebooking/api/ob/employee/list",
      {
        pageNumber: 0,
        itemsPerPage: 999,
        sortBy: "",
        sortDirection: 0,
        criteria: {
          objectState: 2026,
          serviceId: service.id,
          serviceAddOns: null
        }
      }
    );

    console.log(
      "Therapists found:",
      therapists.length
    );

    console.log("Scanning openings...");

    const startDateObject = parseDateKey(scrapeWindow.scrapeStartDate);
    const endDateObject = parseDateKey(scrapeWindow.scrapeEndDate);

    const openings = await api(
      "/onlinebooking/api/ob/scanforopenings",
      {
        scanServices: [
          {
            clientId: crypto.randomUUID(),
            serviceId: service.id,
            employeeId: null,
            genderPreferenceEnum: 105,
            clientFirstName: "Guest",
            clientPhoneNumber: "5555555555",
            clientCountryCode: "1",
            isGuest: true,
            customServiceStepTimings: null
          }
        ],

        payingClientId: null,
        isRescan: false,
        scanOrigin: 1,
        maxOpeningsPerDay: 20,
        appointmentBufferMinutes: 15,
        maxStartTimeWait: 0,
        maxWaitTimeBetweenServices: 0,
        requireSameStartTime: true,
        requireSameResource: false,
        scanDateType: 2090,
        scanTimeType: 2095,

        startDate: startDateObject.toISOString(),
        endDate: endDateObject.toISOString(),

        isCouplesScan: false,
        isRestrictedToBookableOnline: true
      }
    );

    const normalized = [];

    for (const group of openings || []) {
      for (const opening of group.serviceOpenings || []) {
        normalized.push({
          date: opening.date,
          startTime: opening.startTime,
          endTime: opening.endTime,

          serviceName: opening.serviceName,
          therapistName:
            opening.employeeDisplayName ||
            opening.employeeName,

          therapistId: opening.employeeId,

          price:
            opening.employeePrice ||
            opening.serviceBasePrice,

          openingId: opening.openingId,

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

      category: {
        id: category.id,
        name: category.displayName
      },

      service: {
        id: service.id,
        name: service.displayName
      },

      therapists: therapists.map((t) => ({
        id: t.id,
        name: t.nickName,
        price: t.price
      })),

      openings: normalized,

      scrapeStartDate: scrapeWindow.scrapeStartDate,
      scrapeEndDate: scrapeWindow.scrapeEndDate,
      lookaheadHours: scrapeWindow.lookaheadHours,
      daysForward: scrapeWindow.daysForward,
      scrapeWindowMode: scrapeWindow.scrapeWindowMode
    };
  } catch (error) {
    await browser.close().catch(() => null);
    throw error;
  }
}

module.exports = {
  scrapeMeevoAvailability
};