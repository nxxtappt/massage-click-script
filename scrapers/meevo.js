// scrapers/meevo.js
//
// Production Meevo availability scraper.
//
// Flow:
// 1. Initialize booking session
// 2. Get service categories
// 3. Get services
// 4. Get add-ons (optional)
// 5. Get therapists
// 6. Scan openings
//
// Usage:
// const { scrapeMeevoAvailability } = require("./scrapers/meevo");

const { chromium } = require("playwright");

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeMeevoAvailability(options = {}) {
  const {
    bookingUrl,
    categoryName = "Swedish Massage",
    serviceName = "1 Hour Swedish Massage",
    daysForward = 7
  } = options;

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

  console.log("Initializing Meevo session...");

  await page.goto(bookingUrl, {
    waitUntil: "networkidle",
    timeout: 90000
  });

  await page.waitForTimeout(5000);

  // Build helper for authenticated API requests inside session.
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

  //
  // STEP 1: SERVICE CATEGORIES
  //

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

  //
  // STEP 2: SERVICES
  //

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

  //
  // STEP 3: ADD-ONS
  //

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

  //
  // STEP 4: THERAPISTS
  //

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

  //
  // STEP 5: OPENINGS
  //

  console.log("Scanning openings...");

  const now = new Date();

  const end = new Date();
  end.setDate(end.getDate() + daysForward);

  const openings = await api(
    "/onlinebooking/api/ob/scanforopenings",
    {
      scanServices: [
        {
          clientId: crypto.randomUUID(),

          serviceId: service.id,

          // THIS IS THE KEY:
          // null = Any Therapist
          employeeId: null,

          // 105 = Any Gender
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

      // 2090 = date range scan
      scanDateType: 2090,

      // 2095 = anytime
      scanTimeType: 2095,

      startDate: now.toISOString(),
      endDate: end.toISOString(),

      isCouplesScan: false,
      isRestrictedToBookableOnline: true
    }
  );

  //
  // NORMALIZE RESULTS
  //

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

        openingId: opening.openingId
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

    openings: normalized
  };
}

module.exports = {
  scrapeMeevoAvailability
};