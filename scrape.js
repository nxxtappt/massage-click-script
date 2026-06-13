require("dotenv").config();

const { chromium } = require("playwright");
const fs = require("fs");

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
const { syncBusinessViaApi } = require("./apiSyncRouter");

const MAX_ATTEMPTS = 2;
const RESULTS_FILE = "results.json";
const VAGARO_DISCOVERY_FILE = "vagaro-marketplace-results.json";

const scrapeVagaroMarketplace =
  vagaroModule.scrapeVagaroMarketplace ||
  vagaroModule.scrapeVagaroMarketplaceSearch ||
  vagaroModule;

function saveResults(results) {
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`Saved ${results.length} result(s) to ${RESULTS_FILE}`);
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
  const file = "errorLogs.json";
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

  fs.writeFileSync(file, JSON.stringify(existing.slice(0, 500), null, 2));
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

function getLookaheadHours(job = {}) {
  if (job.lookaheadHours) return Number(job.lookaheadHours);
  if (job.daysForward) return Number(job.daysForward) * 24;
  return null;
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

  return null;
}

function isWithinLookahead(item, result, cutoff) {
  const parsed = parseAppointmentDateTime(item, result);

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return true;
  }

  return parsed.getTime() <= cutoff.getTime();
}

function filterResultToLookahead(result = {}, job = {}) {
  const lookaheadHours = getLookaheadHours(job);

  if (!lookaheadHours || Number.isNaN(lookaheadHours)) {
    return result;
  }

  const cutoff = new Date(Date.now() + lookaheadHours * 60 * 60 * 1000);

  const filtered = {
    ...result,
    lookaheadHoursApplied: lookaheadHours,
    lookaheadCutoff: cutoff.toISOString()
  };

  ["appointments", "openings", "availability", "results"].forEach((key) => {
    if (Array.isArray(filtered[key])) {
      filtered[key] = filtered[key].filter((item) =>
        isWithinLookahead(item, filtered, cutoff)
      );
    }
  });

  if (Array.isArray(filtered.times)) {
    filtered.times = filtered.times.filter((time) =>
      isWithinLookahead(time, filtered, cutoff)
    );
  }

  return filtered;
}

async function scrapeMeevoBusiness(business, attemptNumber) {
  const startedAt = Date.now();

  console.log(
    `\n===== Scraping ${business.businessName} | ${business.serviceName} | Attempt ${attemptNumber} =====`
  );

  const meevoResult = await scrapeMeevoAvailability({
    bookingUrl: business.bookingUrl,
    categoryName: business.categoryName,
    serviceName: business.serviceName,
    daysForward: business.daysForward || 7
  });

  const openings = Array.isArray(meevoResult.openings)
    ? meevoResult.openings
    : [];

  const times = openings.map((opening) => opening.startTime).filter(Boolean);

  return {
    businessName: business.businessName,
    bookingUrl: business.bookingUrl,
    platform: business.platform,
    service: meevoResult.service?.name || business.serviceName,
    serviceName: meevoResult.service?.name || business.serviceName,
    serviceType: business.serviceType || "",
    durationMinutes: business.durationMinutes || null,
    platformServiceId: business.platformServiceId || business.serviceId || null,
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
    distanceMiles: business.distanceMiles || null,
    rawWidgetText: null
  };
}

async function scrapeWithRetries(browser, business) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { page, context } = await createScrapePage(browser);
    const startedAt = Date.now();

    try {
      if (business.integrationType === "api") {
        console.log(
          `[API SYNC] Using API integration for ${business.businessName} | ${business.serviceName}`
        );

        const appointments = await syncBusinessViaApi({
          business,
          businessName: business.businessName,
          platform: business.platform,
          serviceName: business.serviceName,
          serviceType: business.serviceType,
          durationMinutes: business.durationMinutes,
          bookingUrl: business.bookingUrl
        });

        await closeScrapePage(page, context);

        return {
          businessName: business.businessName,
          bookingUrl: business.bookingUrl,
          platform: business.platform,
          integrationType: "api",
          apiProvider: business.apiProvider || "",
          service: business.serviceName,
          serviceName: business.serviceName,
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId:
            business.platformServiceId || business.serviceId || null,
          provider: "API",
          date: null,
          times: [],
          status: appointments.length > 0 ? "success" : "no_times_found",
          attemptNumber: attempt,
          scrapeDurationMs: Date.now() - startedAt,
          lastChecked: new Date().toISOString(),
          appointments,
          openings: [],
          distanceMiles: business.distanceMiles || null,
          rawWidgetText: null
        };
      }

      if (business.platform === "schedulista") {
        const result = await scrapeSchedulistaBusiness(browser, business);
        await closeScrapePage(page, context);

        return {
          ...result,
          serviceName: business.serviceName || result.serviceName || result.service,
          serviceType: business.serviceType || result.serviceType || "",
          durationMinutes:
            business.durationMinutes || result.durationMinutes || null,
          platformServiceId:
            business.platformServiceId || business.serviceId || null,
          distanceMiles: business.distanceMiles || null
        };
      }

      if (business.platform === "mindbody") {
        const result = await scrapeMindbodyBusiness(page, business, attempt);
        await closeScrapePage(page, context);

        return {
          ...result,
          distanceMiles: business.distanceMiles || null
        };
      }

      if (business.platform === "mindbody-old") {
        await closeScrapePage(page, context);
        const result = await scrapeMindbodyOldBusiness(browser, business);

        return {
          ...result,
          serviceName: business.serviceName || result.serviceName || result.service,
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId:
            business.platformServiceId || business.serviceId || null,
          distanceMiles: business.distanceMiles || null
        };
      }

      if (business.platform === "oakhaven") {
        await closeScrapePage(page, context);

        const result = await scrapeOakHavenBusiness(business);

        return {
          ...result,
          serviceName: business.serviceName || result.serviceName || result.service,
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId:
            business.platformServiceId || business.SessionTypeIds || null,
          attemptNumber: attempt,
          scrapeDurationMs: Date.now() - startedAt,
          distanceMiles: business.distanceMiles || null
        };
      }

      if (business.platform === "meevo") {
        await closeScrapePage(page, context);
        return await scrapeMeevoBusiness(business, attempt);
      }

      if (business.platform === "axl3") {
        await closeScrapePage(page, context);
        const result = await scrapeAxl3Business(browser, business);

        return {
          ...result,
          serviceName: business.serviceName || result.serviceName || result.service,
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId: business.platformServiceId || null,
          distanceMiles: business.distanceMiles || null
        };
      }

      if (business.platform === "booker") {
        await closeScrapePage(page, context);
        const result = await scrapeBookerBusiness(browser, business);

        return {
          ...result,
          serviceName: business.serviceName || result.serviceName || result.service,
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId: business.platformServiceId || null,
          distanceMiles: business.distanceMiles || null
        };
      }

      if (business.platform === "massage-envy") {
        await closeScrapePage(page, context);

        const result = await scrapeMassageEnvyBusiness(browser, business);

        return {
          ...result,
          businessName: business.businessName,
          bookingUrl: business.bookingUrl,
          platform: "massage-envy",
          service:
            business.serviceName ||
            result.serviceName ||
            result.service ||
            "60 Min Relaxation Massage",
          serviceName:
            business.serviceName ||
            result.serviceName ||
            result.service ||
            "60 Min Relaxation Massage",
          serviceType:
            business.serviceType ||
            result.serviceType ||
            "swedish",
          durationMinutes:
            business.durationMinutes ||
            result.durationMinutes ||
            60,
          platformServiceId:
            business.platformServiceId ||
            business.serviceId ||
            result.platformServiceId ||
            null,
          provider:
            result.provider ||
            business.providerText ||
            "First Available",
          attemptNumber: attempt,
          scrapeDurationMs: Date.now() - startedAt,
          lastChecked:
            result.lastChecked ||
            new Date().toISOString(),
          distanceMiles: business.distanceMiles || null
        };
      }

      if (business.platform === "zenoti") {
        await closeScrapePage(page, context);

        const result = await scrapeZenoti(business, {
          serviceName: business.serviceName,
          daysAhead: business.daysForward || 21
        });

        const appointments = Array.isArray(result.appointments)
          ? result.appointments
          : [];

        const times = appointments
          .map((appointment) => appointment.time || appointment.date)
          .filter(Boolean);

        return {
          businessName: business.businessName,
          bookingUrl: business.bookingUrl,
          platform: "zenoti",
          service:
            business.serviceName || result.serviceName || result.service || "",
          serviceName:
            business.serviceName || result.serviceName || result.service || "",
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId:
            business.platformServiceId || business.serviceId || null,
          provider: business.providerText || "Any Therapist",
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
          distanceMiles: business.distanceMiles || null,
          rawWidgetText: null,
          appointments
        };
      }

      throw new Error(`Unsupported platform: ${business.platform}`);
    } catch (error) {
      lastError = error;

      console.error(
        `Attempt ${attempt} failed for ${business.businessName} | ${business.serviceName}:`,
        error.message
      );

      await closeScrapePage(page, context);

      if (attempt < MAX_ATTEMPTS) {
        console.log(`Retrying ${business.businessName} | ${business.serviceName}...`);
      }

      if (attempt === MAX_ATTEMPTS) {
        const errorResult = {
          businessName: business.businessName,
          bookingUrl: business.bookingUrl,
          platform: business.platform,
          service: business.serviceName,
          serviceName: business.serviceName,
          serviceType: business.serviceType || "",
          durationMinutes: business.durationMinutes || null,
          platformServiceId:
            business.platformServiceId ||
            business.serviceButtonId ||
            business.serviceId ||
            business.SessionTypeIds ||
            null,
          provider: business.skipProvider
            ? "Auto-selected"
            : business.providerText || "No preference",
          date: null,
          times: [],
          status: "error",
          attemptNumber: attempt,
          error: lastError.message,
          scrapeDurationMs: Date.now() - startedAt,
          lastChecked: new Date().toISOString(),
          distanceMiles: business.distanceMiles || null,
          rawWidgetText: null
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

  const businesses = JSON.parse(fs.readFileSync("businesses.json", "utf8"));

  const supportedPlatforms = [
    "mindbody",
    "mindbody-old",
    "schedulista",
    "meevo",
    "axl3",
    "booker",
    "zenoti",
    "oakhaven",
    "massage-envy"
  ];

  const scrapeableBusinesses = businesses.filter((business) => {
    return (
      supportedPlatforms.includes(business.platform) &&
      isPlatformEnabled(business.platform)
    );
  });

  let scrapeJobs = buildScrapeJobs(scrapeableBusinesses, filters);
  scrapeJobs = enforceOnDemandLimits(scrapeJobs, filters, adminSettings);

  console.log(`Loaded ${businesses.length} businesses from businesses.json`);
  console.log(`Built ${scrapeJobs.length} service-level scrape job(s)`);

  if (Object.keys(filters).length > 0) {
    console.log("Filters applied:");
    console.log(JSON.stringify(filters, null, 2));
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

if (fs.existsSync(RESULTS_FILE)) {
  try {
    const existingResults = JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8"));
    results = Array.isArray(existingResults) ? existingResults : [];
  } catch (error) {
    console.error("[RESULTS] Failed to load existing results.json:", error.message);
    results = [];
  }
}

console.log(`[RESULTS] Starting with ${results.length} existing result(s).`);

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

          const filteredCachedResult = filterResultToLookahead(cachedResult, job);

          results = upsertResult(results, filteredCachedResult);
          saveResults(results);
          continue;
        }
      }
        const rawResult = await scrapeWithRetries(browser, job);
        const result = filterResultToLookahead(rawResult, job);

        results = upsertResult(results, result);
        cacheResult(result);
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