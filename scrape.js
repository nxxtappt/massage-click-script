require("dotenv").config();

const { chromium } = require("playwright");
const fs = require("fs");

const {
  storagePath,
  writeJsonAtomic,
  readJson
} = require("./storagePaths");

const { parseCliFilters, buildScrapeJobs } = require("./jobBuilder");
const { upsertAppointmentResult, getCacheStats } = require("./cacheManager");
const { shouldSkipScrapeForFreshCache } = require("./staleChecker");

const {
  loadAdminSettings,
  isPlatformEnabled,
  getTtlMinutesForStatus,
  shouldSkipVagaroDiscovery
} = require("./adminSettingsManager");

const { scrapeMindbodyBusiness } = require("./scrapers/mindbody");
const { scrapeSchedulistaBusiness } = require("./scrapers/schedulista");
const { scrapeMeevoAvailability } = require("./scrapers/meevo");
const vagaroModule = require("./scrapers/vagaroMarketplace");
const { scrapeAxl3Business } = require("./scrapers/axl3");
const { scrapeBookerBusiness } = require("./scrapers/booker");
const { scrapeOakHavenBusiness } = require("./scrapers/oakhaven");
const { scrapeMindbodyOldBusiness } = require("./scrapers/mindbody-old");
const { scrapeZenoti } = require("./scrapers/zenoti");
const { scrapeMassageEnvyBusiness } = require("./scrapers/massage-envy");
const { scrapeMangomintBusiness } = require("./scrapers/mangomint");
const { scrapeHandStoneBusiness } = require("./scrapers/hand-stone");
const { syncBusinessViaApi } = require("./apiSyncRouter");
const businessManager = require("./businessManager");

const MAX_ATTEMPTS = 2;
const RESULTS_FILE = storagePath("results.json");
const {
  mergeConfirmedAndInferredAppointments
} = require("./availabilityInferenceEngine");
const ERROR_LOGS_FILE = storagePath("errorLogs.json");
const {
  createScrapeRun,
  finishScrapeRun,
  insertRawScrapeResult,
  insertConfirmedAppointmentsFromResult
} = require("./database/inventoryRepository");
const VAGARO_DISCOVERY_FILE = storagePath("vagaro-marketplace-results.json");

const scrapeVagaroMarketplace =
  vagaroModule.scrapeVagaroMarketplace ||
  vagaroModule.scrapeVagaroMarketplaceSearch ||
  vagaroModule;

function saveResults(results) {
  console.log(
    `[RESULTS] Legacy results.json write disabled. ${results.length} result(s) kept in memory only.`
  );
}

function normalizeResultKeyValue(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getResultKey(result = {}) {
  return [
    result.businessName || "",
    result.platform || "",
    result.serviceName || result.service || "",
    result.serviceType || "",
    result.durationMinutes || "",
    result.platformServiceId ||
      result.serviceId ||
      result.serviceButtonId ||
      ""
  ]
    .map(normalizeResultKeyValue)
    .join("||");
}

function upsertResult(results = [], incomingResult = {}) {
  const existing = Array.isArray(results) ? results : [];
  const incomingKey = getResultKey(incomingResult);

  if (!incomingKey.replace(/\|/g, "").trim()) {
    return [...existing, incomingResult];
  }

  const filtered = existing.filter((result) => {
    return getResultKey(result) !== incomingKey;
  });

  return [...filtered, incomingResult];
}

function appendErrorLog(entry) {
  const file = ERROR_LOGS_FILE;
  let existing = [];

  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!Array.isArray(existing)) existing = [];
    } catch {
      existing = [];
    }
  }

  existing.unshift({
    ...entry,
    loggedAt: new Date().toISOString()
  });

  writeJsonAtomic(file, existing.slice(0, 500));
}

function cacheResult(result) {
  try {
    const ttlMinutes = getTtlMinutesForStatus(result.status);

    if (!ttlMinutes || ttlMinutes <= 0) {
      console.log("[CACHE] Cache disabled or TTL is 0. Skipping cache save.");
      return;
    }

    upsertAppointmentResult(result, { ttlMinutes });
  } catch (error) {
    console.error("[CACHE] Failed to save scrape result:", error.message);
  }
}

function normalizeCachedResult(cachedResult) {
  return {
    ...cachedResult,
    fromCache: true,
    cacheStatus: "fresh",
    status: cachedResult.status || "cached"
  };
}

async function createScrapePage(browser) {
  if (browser && typeof browser.newPage === "function") {
    return {
      page: await browser.newPage(),
      context: null
    };
  }

  if (browser && typeof browser.newContext === "function") {
    const context = await browser.newContext();
    const page = await context.newPage();

    return {
      page,
      context
    };
  }

  throw new Error("Playwright browser/page object is invalid.");
}

async function closeScrapePage(page, context) {
  await page?.close?.().catch(() => null);
  await context?.close?.().catch(() => null);
}

function buildScrapeWindowPayload(job = {}) {
  return {
    scrapeStartDate: job.scrapeStartDate || "",
    scrapeEndDate: job.scrapeEndDate || "",
    lookaheadHours: job.lookaheadHours ? Number(job.lookaheadHours) : null,
    daysForward: job.daysForward ? Number(job.daysForward) : null,
    scrapeWindowMode: job.scrapeWindowMode || ""
  };
}

function withScrapeWindow(job = {}) {
  return {
    ...job,
    ...buildScrapeWindowPayload(job)
  };
}

function getLookaheadHours(job = {}) {
  if (job.lookaheadHours) return Number(job.lookaheadHours);
  if (job.daysForward) return Number(job.daysForward) * 24;
  return null;
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getDateKeyFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseAppointmentDateTime(item, parentResult = {}) {
  if (!item) return null;

  if (typeof item === "string") {
    if (item.includes("T")) return new Date(item);

    if (parentResult.date) {
      return new Date(`${parentResult.date} ${item}`);
    }

    return null;
  }

  const raw =
    item.startTime ||
    item.startDateTime ||
    item.appointmentStartTime ||
    item.from ||
    item.dateTime ||
    item.datetime ||
    item.time ||
    "";

  if (raw && String(raw).includes("T")) {
    return new Date(raw);
  }

  const date =
    item.date ||
    item.appointmentDate ||
    item.AvailableDate ||
    parentResult.date ||
    "";

  const time =
    item.time ||
    item.startTime ||
    item.appointmentTime ||
    "";

  if (date && time) {
    return new Date(`${date} ${time}`);
  }

  if (date && isDateKey(date)) {
    return new Date(`${date}T12:00:00`);
  }

  return null;
}

function getAppointmentDateKey(item, parentResult = {}) {
  if (!item) return "";

  if (typeof item === "string") {
    const isoDateMatch = item.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDateMatch) return isoDateMatch[1];

    if (isDateKey(parentResult.date)) return parentResult.date;

    const parsed = parseAppointmentDateTime(item, parentResult);
    return parsed ? getDateKeyFromDate(parsed) : "";
  }

  const directDate =
    item.localDateKey ||
    item.date ||
    item.appointmentDate ||
    item.AvailableDate ||
    "";

  if (isDateKey(directDate)) {
    return directDate;
  }

  const raw =
    item.startTime ||
    item.startDateTime ||
    item.appointmentStartTime ||
    item.from ||
    item.dateTime ||
    item.datetime ||
    "";

  const isoDateMatch = String(raw || "").match(/^(\d{4}-\d{2}-\d{2})/);

  if (isoDateMatch) {
    return isoDateMatch[1];
  }

  const parsed = parseAppointmentDateTime(item, parentResult);
  return parsed ? getDateKeyFromDate(parsed) : "";
}

function isWithinScrapeDateWindow(item, result, job = {}) {
  const startDate = job.scrapeStartDate || result.scrapeStartDate || "";
  const endDate = job.scrapeEndDate || result.scrapeEndDate || "";

  if (!isDateKey(startDate) && !isDateKey(endDate)) {
    return true;
  }

  const appointmentDateKey = getAppointmentDateKey(item, result);

  if (!appointmentDateKey) {
    return true;
  }

  if (isDateKey(startDate) && appointmentDateKey < startDate) {
    return false;
  }

  if (isDateKey(endDate) && appointmentDateKey > endDate) {
    return false;
  }

  return true;
}

function isWithinLookahead(item, result, cutoff) {
  const parsed = parseAppointmentDateTime(item, result);

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return true;
  }

  return parsed.getTime() <= cutoff.getTime();
}

function shouldApplyRollingLookahead(job = {}) {
  const mode = String(job.scrapeWindowMode || "");

  return !["specific_date", "custom_range"].includes(mode);
}

function filterResultToScrapeWindow(result = {}, job = {}) {
  if (!result || typeof result !== "object") {
    return result;
  }

  const scrapeWindow = buildScrapeWindowPayload(job);
  const lookaheadHours = getLookaheadHours(job);

  const filtered = {
    ...result,
    ...scrapeWindow
  };

  let cutoff = null;

  if (
    shouldApplyRollingLookahead(job) &&
    lookaheadHours &&
    !Number.isNaN(lookaheadHours)
  ) {
    cutoff = new Date(Date.now() + lookaheadHours * 60 * 60 * 1000);
    filtered.lookaheadHoursApplied = lookaheadHours;
    filtered.lookaheadCutoff = cutoff.toISOString();
  }

  ["appointments", "openings", "availability", "results"].forEach((key) => {
    if (Array.isArray(filtered[key])) {
      filtered[key] = filtered[key].filter((item) => {
        if (!isWithinScrapeDateWindow(item, filtered, job)) {
          return false;
        }

        if (cutoff && !isWithinLookahead(item, filtered, cutoff)) {
          return false;
        }

        return true;
      });
    }
  });

  if (Array.isArray(filtered.times)) {
    filtered.times = filtered.times.filter((time) => {
      if (!isWithinScrapeDateWindow(time, filtered, job)) {
        return false;
      }

      if (cutoff && !isWithinLookahead(time, filtered, cutoff)) {
        return false;
      }

      return true;
    });
  }

  return filtered;
}

async function scrapeMeevoBusiness(business, attemptNumber) {
  const scrapeTarget = withScrapeWindow(business);
  const startedAt = Date.now();

  console.log(
    `\n===== Scraping ${scrapeTarget.businessName} | ${scrapeTarget.serviceName} | Attempt ${attemptNumber} =====`
  );

  console.log("[SCRAPE WINDOW]", {
    scrapeStartDate: scrapeTarget.scrapeStartDate,
    scrapeEndDate: scrapeTarget.scrapeEndDate,
    lookaheadHours: scrapeTarget.lookaheadHours,
    daysForward: scrapeTarget.daysForward,
    scrapeWindowMode: scrapeTarget.scrapeWindowMode
  });

  const meevoResult = await scrapeMeevoAvailability({
    bookingUrl: scrapeTarget.bookingUrl,
    categoryName: scrapeTarget.categoryName,
    serviceName: scrapeTarget.serviceName,
    scrapeStartDate: scrapeTarget.scrapeStartDate,
    scrapeEndDate: scrapeTarget.scrapeEndDate,
    lookaheadHours: scrapeTarget.lookaheadHours,
    daysForward: scrapeTarget.daysForward || 7,
    scrapeWindowMode: scrapeTarget.scrapeWindowMode
  });

  const openings = Array.isArray(meevoResult.openings)
    ? meevoResult.openings
    : [];

  const times = openings.map((opening) => opening.startTime).filter(Boolean);

  return {
    businessName: scrapeTarget.businessName,
    bookingUrl: scrapeTarget.bookingUrl,
    platform: scrapeTarget.platform,
    service: meevoResult.service?.name || scrapeTarget.serviceName,
    serviceName: meevoResult.service?.name || scrapeTarget.serviceName,
    serviceType: scrapeTarget.serviceType || "",
    durationMinutes: scrapeTarget.durationMinutes || null,
    platformServiceId: scrapeTarget.platformServiceId || scrapeTarget.serviceId || null,
    provider: "Any Therapist",
    date: null,
    times,
    status: times.length > 0 ? "success" : "no_times_found",
    attemptNumber,
    scrapeDurationMs: Date.now() - startedAt,
    lastChecked: new Date().toISOString(),
    openings,
    category: meevoResult.category || null,
    therapists: meevoResult.therapists || [],
    distanceMiles: scrapeTarget.distanceMiles || null,
    rawWidgetText: null,
    ...buildScrapeWindowPayload(scrapeTarget)
  };
}

async function scrapeWithRetries(browser, business) {
  let lastError = null;
  const scrapeTarget = withScrapeWindow(business);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { page, context } = await createScrapePage(browser);
    const startedAt = Date.now();

    try {
      console.log("[SCRAPE WINDOW]", {
        businessName: scrapeTarget.businessName,
        serviceName: scrapeTarget.serviceName,
        scrapeStartDate: scrapeTarget.scrapeStartDate,
        scrapeEndDate: scrapeTarget.scrapeEndDate,
        lookaheadHours: scrapeTarget.lookaheadHours,
        daysForward: scrapeTarget.daysForward,
        scrapeWindowMode: scrapeTarget.scrapeWindowMode
      });

      if (scrapeTarget.integrationType === "api") {
        console.log(
          `[API SYNC] Using API integration for ${scrapeTarget.businessName} | ${scrapeTarget.serviceName}`
        );

        const appointments = await syncBusinessViaApi({
          business: scrapeTarget,
          businessName: scrapeTarget.businessName,
          platform: scrapeTarget.platform,
          serviceName: scrapeTarget.serviceName,
          serviceType: scrapeTarget.serviceType,
          durationMinutes: scrapeTarget.durationMinutes,
          bookingUrl: scrapeTarget.bookingUrl,
          ...buildScrapeWindowPayload(scrapeTarget)
        });

        await closeScrapePage(page, context);

        return {
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: scrapeTarget.platform,
          integrationType: "api",
          apiProvider: scrapeTarget.apiProvider || "",
          service: scrapeTarget.serviceName,
          serviceName: scrapeTarget.serviceName,
          serviceType: scrapeTarget.serviceType || "",
          durationMinutes: scrapeTarget.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId || scrapeTarget.serviceId || null,
          provider: "API",
          date: null,
          times: [],
          status: appointments.length > 0 ? "success" : "no_times_found",
          attemptNumber: attempt,
          scrapeDurationMs: Date.now() - startedAt,
          lastChecked: new Date().toISOString(),
          appointments,
          openings: [],
          distanceMiles: scrapeTarget.distanceMiles || null,
          rawWidgetText: null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      if (scrapeTarget.platform === "schedulista") {
        const result = await scrapeSchedulistaBusiness(browser, scrapeTarget);
        await closeScrapePage(page, context);

        return {
          ...result,
          serviceName: scrapeTarget.serviceName || result.serviceName || result.service,
          serviceType: scrapeTarget.serviceType || result.serviceType || "",
          durationMinutes:
            scrapeTarget.durationMinutes || result.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId || scrapeTarget.serviceId || null,
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      if (scrapeTarget.platform === "mindbody") {
        const result = await scrapeMindbodyBusiness(page, scrapeTarget, attempt);
        await closeScrapePage(page, context);

        return {
          ...result,
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      if (scrapeTarget.platform === "mindbody-old") {
        await closeScrapePage(page, context);
        const result = await scrapeMindbodyOldBusiness(browser, scrapeTarget);

        return {
          ...result,
          serviceName: scrapeTarget.serviceName || result.serviceName || result.service,
          serviceType: scrapeTarget.serviceType || "",
          durationMinutes: scrapeTarget.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId || scrapeTarget.serviceId || null,
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      if (scrapeTarget.platform === "oakhaven") {
        await closeScrapePage(page, context);

        const result = await scrapeOakHavenBusiness(scrapeTarget);

        return {
          ...result,
          serviceName: scrapeTarget.serviceName || result.serviceName || result.service,
          serviceType: scrapeTarget.serviceType || "",
          durationMinutes: scrapeTarget.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId || scrapeTarget.SessionTypeIds || null,
          attemptNumber: attempt,
          scrapeDurationMs: Date.now() - startedAt,
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      if (scrapeTarget.platform === "meevo") {
        await closeScrapePage(page, context);
        return await scrapeMeevoBusiness(scrapeTarget, attempt);
      }

      if (scrapeTarget.platform === "axl3") {
        await closeScrapePage(page, context);
        const result = await scrapeAxl3Business(browser, scrapeTarget);

        return {
          ...result,
          serviceName: scrapeTarget.serviceName || result.serviceName || result.service,
          serviceType: scrapeTarget.serviceType || "",
          durationMinutes: scrapeTarget.durationMinutes || null,
          platformServiceId: scrapeTarget.platformServiceId || null,
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      if (scrapeTarget.platform === "booker") {
        await closeScrapePage(page, context);
        const result = await scrapeBookerBusiness(browser, scrapeTarget);

        return {
          ...result,
          serviceName: scrapeTarget.serviceName || result.serviceName || result.service,
          serviceType: scrapeTarget.serviceType || "",
          durationMinutes: scrapeTarget.durationMinutes || null,
          platformServiceId: scrapeTarget.platformServiceId || null,
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

            if (scrapeTarget.platform === "mangomint") {
        await closeScrapePage(page, context);

        const result = await scrapeMangomintBusiness(scrapeTarget);

        return {
          ...result,
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: "mangomint",
          serviceName:
            scrapeTarget.serviceName ||
            result.serviceName ||
            result.service ||
            "",
          service:
            scrapeTarget.serviceName ||
            result.serviceName ||
            result.service ||
            "",
          serviceType:
            scrapeTarget.serviceType ||
            result.serviceType ||
            "massage",
          durationMinutes:
            scrapeTarget.durationMinutes ||
            result.durationMinutes ||
            null,
          platformServiceId:
            scrapeTarget.platformServiceId ||
            scrapeTarget.serviceId ||
            result.platformServiceId ||
            null,
          provider:
            result.provider ||
            scrapeTarget.staffCategory ||
            "Anyone",
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }


      if (scrapeTarget.platform === "hand-stone") {
      await closeScrapePage(page, context);

     const result = await scrapeHandStoneBusiness(scrapeTarget);

     return {
      ...result,
     businessName: scrapeTarget.businessName,
     bookingUrl: scrapeTarget.bookingUrl,
     platform: "hand-stone",
     serviceName: scrapeTarget.serviceName || result.serviceName,
     serviceType: scrapeTarget.serviceType || result.serviceType || "massage",
     durationMinutes:
      scrapeTarget.durationMinutes || result.durationMinutes || null,
     platformServiceId:
      scrapeTarget.platformServiceId ||
      scrapeTarget.serviceId ||
      result.platformServiceId ||
      null,
     distanceMiles: scrapeTarget.distanceMiles || null,
     attemptNumber: attempt,
     ...buildScrapeWindowPayload(scrapeTarget)
  };
}
      if (scrapeTarget.platform === "massage-envy") {
        await closeScrapePage(page, context);

        const result = await scrapeMassageEnvyBusiness(browser, scrapeTarget);

        return {
          ...result,
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: "massage-envy",
          service:
            scrapeTarget.serviceName ||
            result.serviceName ||
            result.service ||
            "60 Min Relaxation Massage",
          serviceName:
            scrapeTarget.serviceName ||
            result.serviceName ||
            result.service ||
            "60 Min Relaxation Massage",
          serviceType:
            scrapeTarget.serviceType ||
            result.serviceType ||
            "swedish",
          durationMinutes:
            scrapeTarget.durationMinutes ||
            result.durationMinutes ||
            60,
          platformServiceId:
            scrapeTarget.platformServiceId ||
            scrapeTarget.serviceId ||
            result.platformServiceId ||
            null,
          provider:
            result.provider ||
            scrapeTarget.providerText ||
            "First Available",
          attemptNumber: attempt,
          scrapeDurationMs: Date.now() - startedAt,
          lastChecked:
            result.lastChecked ||
            new Date().toISOString(),
          distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      if (scrapeTarget.platform === "zenoti") {
        await closeScrapePage(page, context);

        const result = await scrapeZenoti(scrapeTarget, {
          serviceName: scrapeTarget.serviceName,
          scrapeStartDate: scrapeTarget.scrapeStartDate,
          scrapeEndDate: scrapeTarget.scrapeEndDate,
          lookaheadHours: scrapeTarget.lookaheadHours,
          daysForward: scrapeTarget.daysForward || 21,
          daysAhead: scrapeTarget.daysForward || 21,
          scrapeWindowMode: scrapeTarget.scrapeWindowMode
        });

        const appointments = Array.isArray(result.appointments)
          ? result.appointments
          : [];

        const times = appointments
          .map((appointment) => appointment.time || appointment.date)
          .filter(Boolean);

        return {
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: "zenoti",
          service:
            scrapeTarget.serviceName || result.serviceName || result.service || "",
          serviceName:
            scrapeTarget.serviceName || result.serviceName || result.service || "",
          serviceType: scrapeTarget.serviceType || "",
          durationMinutes: scrapeTarget.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId || scrapeTarget.serviceId || null,
          provider: scrapeTarget.providerText || "Any Therapist",
          date: null,
          times,
          status: result.success
            ? times.length > 0
              ? "success"
              : "no_times_found"
            : "error",
          attemptNumber: attempt,
          error: result.success ? null : result.error || "Zenoti scrape failed",
          scrapeDurationMs: Date.now() - startedAt,
          lastChecked: new Date().toISOString(),
          distanceMiles: scrapeTarget.distanceMiles || null,
          rawWidgetText: null,
          appointments,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

      throw new Error(`Unsupported platform: ${scrapeTarget.platform}`);
    } catch (error) {
      lastError = error;

      console.error(
        `Attempt ${attempt} failed for ${scrapeTarget.businessName} | ${scrapeTarget.serviceName}:`,
        error.message
      );

      await closeScrapePage(page, context);

      if (attempt < MAX_ATTEMPTS) {
        console.log(`Retrying ${scrapeTarget.businessName} | ${scrapeTarget.serviceName}...`);
      }

      if (attempt === MAX_ATTEMPTS) {
        const errorResult = {
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: scrapeTarget.platform,
          service: scrapeTarget.serviceName,
          serviceName: scrapeTarget.serviceName,
          serviceType: scrapeTarget.serviceType || "",
          durationMinutes: scrapeTarget.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId ||
            scrapeTarget.serviceButtonId ||
            scrapeTarget.serviceId ||
            scrapeTarget.SessionTypeIds ||
            null,
          provider: scrapeTarget.skipProvider
            ? "Auto-selected"
            : scrapeTarget.providerText || "No preference",
          date: null,
          times: [],
          status: "error",
          attemptNumber: attempt,
          error: lastError.message,
          scrapeDurationMs: Date.now() - startedAt,
          lastChecked: new Date().toISOString(),
          distanceMiles: scrapeTarget.distanceMiles || null,
          rawWidgetText: null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };

        appendErrorLog(errorResult);

        return errorResult;
      }
    }
  }

  return null;
}

async function runVagaroDiscoveryOnly(filters = {}) {
  if (!isPlatformEnabled("vagaro")) {
    console.log("[VAGARO] Platform disabled in admin settings. Skipping discovery.");
    return;
  }

  if (shouldSkipVagaroDiscovery(filters)) {
    console.log("[VAGARO] Discovery skipped by admin settings.");
    return;
  }

  if (typeof scrapeVagaroMarketplace !== "function") {
    console.log("[VAGARO] No callable Vagaro marketplace scraper export found.");
    return;
  }

  try {
    console.log("\n===== Running Vagaro discovery only =====");

    const vagaroResults = await scrapeVagaroMarketplace({
      service: filters.service || "Swedish Massage - 60 Minute",
      city: filters.city || "austin",
      state: filters.state || "tx",
      limit: filters.maxResults ? Number(filters.maxResults) : 20,
      inspectBusinessPages: filters.inspectBusinessPages !== "false"
    });

    fs.writeFileSync(VAGARO_DISCOVERY_FILE, JSON.stringify(vagaroResults, null, 2));

    console.log(
      `Saved ${vagaroResults.length} Vagaro discovery result(s) to ${VAGARO_DISCOVERY_FILE}`
    );
  } catch (error) {
    console.error("Vagaro discovery failed:", error.message);
    appendErrorLog({
      platform: "vagaro",
      status: "error",
      error: error.message
    });
  }
}

function enforceOnDemandLimits(scrapeJobs, filters, adminSettings) {
  const isOnDemand = filters.onDemand === true || filters.onDemand === "true";

  if (!isOnDemand) {
    return scrapeJobs;
  }

  if (adminSettings.onDemand.enabled === false) {
    console.log("[ON-DEMAND] Disabled in admin settings.");
    return [];
  }

  if (
    adminSettings.onDemand.requireGeoFilter === true &&
    (!filters.latitude || !filters.longitude)
  ) {
    console.log("[ON-DEMAND] Geo filter required but missing.");
    return [];
  }

  const maxJobs = Number(adminSettings.onDemand.maxJobsPerSearch || 10);

  return scrapeJobs.slice(0, maxJobs);
}

async function run() {
  const adminSettings = loadAdminSettings();
  const filters = parseCliFilters(process.argv);

  const forceRefresh =
    filters.forceRefresh === true ||
    filters.forceRefresh === "true" ||
    adminSettings.scraping.skipFreshCache === false;

  const skipFreshCache =
    adminSettings.scraping.skipFreshCache !== false && !forceRefresh;

  if (adminSettings.scraping.enabled === false) {
    console.log("[ADMIN] Scraping is disabled in admin-settings.json.");
    console.log("[ADMIN] Leaving existing results.json untouched.");
    return;
  }

  const businesses = businessManager.getAllBusinessesSync();

  const supportedPlatforms = [
    "mindbody",
    "mindbody-old",
    "schedulista",
    "meevo",
    "axl3",
    "booker",
    "zenoti",
    "oakhaven",
    "massage-envy",
    "mangomint",
    "hand-stone"
  ];

  const scrapeableBusinesses = businesses.filter((business) => {
    return (
      supportedPlatforms.includes(business.platform) &&
      isPlatformEnabled(business.platform)
    );
  });

  let scrapeJobs = buildScrapeJobs(scrapeableBusinesses, filters);
  scrapeJobs = enforceOnDemandLimits(scrapeJobs, filters, adminSettings);

  console.log(`Loaded ${businesses.length} businesses from businessManager`);
  console.log(`Built ${scrapeJobs.length} service-level scrape job(s)`);

  if (Object.keys(filters).length > 0) {
    console.log("Filters applied:");
    console.log(JSON.stringify(filters, null, 2));
  }

  if (scrapeJobs.length > 0) {
    console.log("[SCRAPE WINDOW SAMPLE]");
    console.log(
      JSON.stringify(
        {
          businessName: scrapeJobs[0].businessName,
          serviceName: scrapeJobs[0].serviceName,
          scrapeStartDate: scrapeJobs[0].scrapeStartDate,
          scrapeEndDate: scrapeJobs[0].scrapeEndDate,
          lookaheadHours: scrapeJobs[0].lookaheadHours,
          daysForward: scrapeJobs[0].daysForward,
          scrapeWindowMode: scrapeJobs[0].scrapeWindowMode
        },
        null,
        2
      )
    );
  }

  if (skipFreshCache) {
    console.log("[CACHE] Fresh-cache skipping is enabled.");
  } else {
    console.log("[CACHE] Fresh-cache skipping is disabled / force refresh enabled.");
  }

  if (scrapeJobs.length === 0) {
    console.log("No scrape jobs matched the filters or enabled platforms.");
    console.log("[RESULTS] Leaving existing results.json untouched.");
    return;
  }

  const browser = await chromium.launch({
    headless: true
  });

let results = [];

  console.log(
    "[RESULTS] Legacy results.json loading disabled. Starting with empty in-memory run results."
  );

  try {
    for (const job of scrapeJobs) {
      if (skipFreshCache) {
        const staleCheck = shouldSkipScrapeForFreshCache(job, {
          forceRefresh
        });

        if (staleCheck.skip) {
          const cachedResult = normalizeCachedResult(staleCheck.cachedResult);

          console.log(
            `[CACHE] Skipping scrape for ${job.businessName} | ${job.serviceName}. Reason: ${staleCheck.reason}`
          );

          const filteredCachedResult = filterResultToScrapeWindow(cachedResult, job);

          results = upsertResult(results, filteredCachedResult);
          saveResults(results);
          continue;
        }
      }

      const scrapeRun = await createScrapeRun({
        triggerType:
          filters.onDemand === true || filters.onDemand === "true"
            ? "on_demand"
            : filters.manual === true || filters.manual === "true"
              ? "manual"
              : "scheduled",
        businessName: job.businessName,
        platform: job.platform,
        serviceName: job.serviceName || job.service || "",
        serviceType: job.serviceType || "",
        durationMinutes: job.durationMinutes || null,
        scrapeStartDate: job.scrapeStartDate || null,
        scrapeEndDate: job.scrapeEndDate || null,
        lookaheadHours: job.lookaheadHours || null,
        daysForward: job.daysForward || null,
        scrapeWindowMode: job.scrapeWindowMode || null
      });

      const rawResult = await scrapeWithRetries(browser, job);
      const result = filterResultToScrapeWindow(rawResult, job);

      const rawScrapeResult = await insertRawScrapeResult({
        scrapeRunId: scrapeRun.id,
        businessName: result.businessName || job.businessName,
        platform: result.platform || job.platform,
        serviceName: result.serviceName || job.serviceName || "",
        serviceType: result.serviceType || job.serviceType || "",
        durationMinutes: result.durationMinutes || job.durationMinutes || null,
        scrapeStartDate: result.scrapeStartDate || job.scrapeStartDate || null,
        scrapeEndDate: result.scrapeEndDate || job.scrapeEndDate || null,
        rawResult: result
      });

const confirmedAppointments = resultTimesToAppointments(result);

function toDateKey(displayDate) {
  const parsed = new Date(displayDate);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function resultTimesToAppointments(result = {}) {
  const localDateKey =
    result.localDateKey ||
    result.dateKey ||
    toDateKey(result.date) ||
    result.scrapeStartDate ||
    "";

  if (Array.isArray(result.appointments) && result.appointments.length > 0) {
    return result.appointments.map((appointment) => ({
      ...appointment,
      sourceType: appointment.sourceType || "confirmed",
      localDateKey: appointment.localDateKey || localDateKey
    }));
  }

  if (!Array.isArray(result.times)) {
    return [];
  }

  return result.times.map((time) => ({
    businessName: result.businessName,
    platform: result.platform,
    bookingUrl: result.bookingUrl,

    serviceName: result.serviceName || result.service,
    service: result.serviceName || result.service,
    serviceType: result.serviceType,
    serviceCategory: result.serviceType,

    durationMinutes: result.durationMinutes,

    therapistName: result.provider || result.providerText || "",
    provider: result.provider || result.providerText || "",

    localDateKey,

    time,
    rawTime: time,

    price: result.price || null,

    sourceType: "confirmed"
  }));
}

const mergedAppointments = mergeConfirmedAndInferredAppointments(
  confirmedAppointments,
  job,
  {
    inferenceMode: "scrape_pipeline"
  }
);

const resultWithInference = {
  ...result,
  appointments: mergedAppointments,
  inferenceSummary: {
    enabled: true,
    confirmedAppointmentCount: confirmedAppointments.length,
    totalAppointmentCount: mergedAppointments.length,
    inferredAppointmentCount:
      mergedAppointments.length - confirmedAppointments.length,
    generatedAt: new Date().toISOString()
  }
};

await finishScrapeRun(scrapeRun.id, {
  runStatus: resultWithInference.status === "error" ? "error" : "success",
  appointmentsFound: mergedAppointments.length,
  errorMessage: resultWithInference.error || null
});

const confirmedInventoryResult = {
  ...result,
  appointments: confirmedAppointments
};

const insertedInventoryAppointments =
  await insertConfirmedAppointmentsFromResult(confirmedInventoryResult, {
    scrapeRunId: scrapeRun.id,
    rawScrapeResultId: rawScrapeResult.id
  });

console.log(
  `[INVENTORY] Saved ${insertedInventoryAppointments.length} confirmed appointment(s) to PostgreSQL inventory.`
);

const inferredCount = mergedAppointments.length - confirmedAppointments.length;

if (inferredCount > 0) {
  console.log(
    `[INVENTORY] ${inferredCount} inferred appointment(s) generated but not written to confirmed inventory yet.`
  );
}

results = upsertResult(results, resultWithInference);
cacheResult(resultWithInference);
saveResults(results);

      console.log("----- RESULT -----");
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await browser.close().catch(() => null);
  }

  await runVagaroDiscoveryOnly(filters);

  console.log("\n===== CACHE STATS =====");
  console.log(JSON.stringify(getCacheStats(), null, 2));

  console.log("\n===== SCRAPE COMPLETE =====");
  console.log(`Total results: ${results.length}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error("Fatal scrape error:", error);
    appendErrorLog({
      status: "fatal_error",
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}

module.exports = {
  run,
  scrapeWithRetries
};