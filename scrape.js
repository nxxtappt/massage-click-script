require("dotenv").config();

const { chromium } = require("playwright");
const { parseCliFilters, buildScrapeJobs } = require("./jobBuilder");

const {
  initializeAdminSettings,
  loadAdminSettings,
  isPlatformEnabled,
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
const { scrapeSquareBusiness } = require("./scrapers/square");
const { syncBusinessViaApi } = require("./apiSyncRouter");
const businessManager = require("./businessManager");
const inventoryManager = require("./inventoryManager");
const { getPlatformDefinition, validateIntegration } = require("./platformIntegrationRegistry");

const MAX_ATTEMPTS = 2;

function toBigIntIdOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text = String(value).trim();

  if (!/^\d+$/.test(text)) {
    return null;
  }

  try {
    return BigInt(text) > 0n ? text : null;
  } catch {
    return null;
  }
}

function resolveBusinessServiceId(...values) {
  for (const value of values) {
    const resolved = toBigIntIdOrNull(value);
    if (resolved) return resolved;
  }

  return null;
}
const {
  mergeConfirmedAndInferredAppointments
} = require("./availabilityInferenceEngine");
const {
  createScrapeRun,
  finishScrapeRun,
  insertRawScrapeResult,
  insertConfirmedAppointmentsFromResult,
  reconcileAppointmentInventoryScope
} = require("./database/inventoryRepository");

const { logScrapeError } = require("./database/runtimeStateRepository");

const scrapeVagaroMarketplace =
  vagaroModule.scrapeVagaroMarketplace ||
  vagaroModule.scrapeVagaroMarketplaceSearch ||
  vagaroModule;


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

async function appendErrorLog(entry) {
  try {
    await logScrapeError(entry);
  } catch (error) {
    console.error("[SCRAPE ERROR LOG] Failed:", error.message);
  }
}

async function cacheResult() {
  // PostgreSQL inventory is the only runtime appointment store.
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

function usesDedicatedBrowser(job = {}) {
  const platform = String(job.platform || "").toLowerCase();

  return (
    String(job.integrationType || "").toLowerCase() === "api" ||
    platform === "meevo" ||
    platform === "square"
  );
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
  const integrationValidation = scrapeTarget.integration
    ? validateIntegration(scrapeTarget.integration, scrapeTarget)
    : { valid: false, errors: ["No integration resolved for scrape job."], warnings: [] };
  if (!integrationValidation.valid) {
    throw new Error(`Invalid scrape integration: ${integrationValidation.errors.join(" ")}`);
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { page, context } = usesDedicatedBrowser(scrapeTarget)
      ? { page: null, context: null }
      : await createScrapePage(browser);

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

      if (scrapeTarget.platform === "vagaro") {
        await closeScrapePage(page, context);
        const result = await scrapeVagaroMarketplace({
          business: scrapeTarget,
          bookingUrl: scrapeTarget.bookingUrl,
          service: scrapeTarget.serviceName,
          serviceName: scrapeTarget.serviceName,
          city: scrapeTarget.city || "austin",
          state: scrapeTarget.state || "tx",
          limit: scrapeTarget.maxResults || 20,
          inspectBusinessPages: true,
          integrationConfig: scrapeTarget.integrationConfig || {},
          ...buildScrapeWindowPayload(scrapeTarget)
        });
        const rows = Array.isArray(result) ? result : (result.results || result.appointments || []);
        return {
          businessName: scrapeTarget.businessName, bookingUrl: scrapeTarget.bookingUrl, platform: "vagaro",
          serviceName: scrapeTarget.serviceName, service: scrapeTarget.serviceName, serviceType: scrapeTarget.serviceType || "massage",
          durationMinutes: scrapeTarget.durationMinutes || null, platformServiceId: scrapeTarget.platformServiceId || null,
          appointments: rows, times: rows.map((item) => item.time || item.startTime).filter(Boolean),
          status: rows.length ? "success" : "no_times_found", attemptNumber: attempt, scrapeDurationMs: Date.now() - startedAt,
          lastChecked: new Date().toISOString(), distanceMiles: scrapeTarget.distanceMiles || null,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
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


      if (scrapeTarget.platform === "square") {
        const result = await scrapeSquareBusiness(scrapeTarget);
        await closeScrapePage(page, context);

        return {
          ...result,
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: "square",
          serviceName: scrapeTarget.serviceName || result.serviceName || result.service || "",
          service: scrapeTarget.serviceName || result.serviceName || result.service || "",
          serviceType: scrapeTarget.serviceType || result.serviceType || "hair",
          durationMinutes: scrapeTarget.durationMinutes || result.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId ||
            scrapeTarget.serviceId ||
            result.platformServiceId ||
            null,
          provider: result.provider || scrapeTarget.providerText || "Any staff",
          distanceMiles: scrapeTarget.distanceMiles || null,
          attemptNumber: attempt,
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

async function run() {
  await initializeAdminSettings();

  const adminSettings = loadAdminSettings();
  const filters = parseCliFilters(process.argv);

  const forceRefresh =
    filters.forceRefresh === true ||
    filters.forceRefresh === "true";

  if (adminSettings.scraping.enabled === false) {
    console.log("[ADMIN] Scraping is disabled.");
    return;
  }

  const businesses = await businessManager.getAllBusinesses({
    includeDisabled: false
  });

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
    "hand-stone",
    "square",
    "vagaro"
  ].filter((platform) => Boolean(getPlatformDefinition(platform)));

  const scrapeableBusinesses = businesses.filter((business) => {
    return (
      supportedPlatforms.includes(business.platform) &&
      isPlatformEnabled(business.platform)
    );
  });

  let scrapeJobs = buildScrapeJobs(scrapeableBusinesses, filters);
  const rejectedJobs = scrapeJobs.filter((job) => job.jobValidation && !job.jobValidation.valid);
  scrapeJobs = scrapeJobs.filter((job) => !job.jobValidation || job.jobValidation.valid);
  if (rejectedJobs.length) {
    console.warn(`[JOB VALIDATION] Rejected ${rejectedJobs.length} invalid job(s).`);
  }

  const businessConfigByName = new Map(
    scrapeableBusinesses.map((business) => [
      normalizeResultKeyValue(business.businessName || business.name),
      business
    ])
  );

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

  console.log("[INVENTORY] PostgreSQL is the only runtime appointment store.");

  if (scrapeJobs.length === 0) {
    console.log("No scrape jobs matched the filters or enabled platforms.");
    console.log("[INVENTORY] No PostgreSQL inventory changes were made.");
    return;
  }

  let browser = null;
  let results = [];

  console.log("[INVENTORY] Starting a new PostgreSQL-backed scrape run.");

  try {
    for (const job of scrapeJobs) {
      const dedicatedBrowser = usesDedicatedBrowser(job);

      // Meevo owns its own Chromium instance. Close the shared browser first so
      // a mixed scrape run never holds two Chromium processes at the same time.
      if (dedicatedBrowser && browser) {
        await browser.close().catch(() => null);
        browser = null;
      }

      if (!dedicatedBrowser && !browser) {
        browser = await chromium.launch({ headless: true });
      }

      const businessServiceId = resolveBusinessServiceId(
        job.businessServiceId,
        job.business_service_id,
        job.serviceDatabaseId,
        job.serviceConfigId
      );

      const scrapeRun = await createScrapeRun({
        triggerType:
          filters.manual === true || filters.manual === "true"
            ? "manual"
            : "scheduled",
        businessName: job.businessName,
        platform: job.platform,
        serviceName: job.serviceName || job.service || "",
        serviceType: job.serviceType || "",
        businessServiceId,
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
        businessServiceId,
        durationMinutes: result.durationMinutes || job.durationMinutes || null,
        scrapeStartDate: result.scrapeStartDate || job.scrapeStartDate || null,
        scrapeEndDate: result.scrapeEndDate || job.scrapeEndDate || null,
        rawResult: result
      });

result.businessServiceId = resolveBusinessServiceId(
  result.businessServiceId,
  businessServiceId
);

const confirmedAppointments = resultTimesToAppointments(result);

function toDateKey(displayDate) {
  const directMatch = String(displayDate || "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (directMatch) return directMatch[1];

  const parsed = new Date(displayDate);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function getAppointmentLocalDateKey(appointment = {}, fallback = "") {
  const candidates = [
    appointment.localDateKey,
    appointment.dateKey,
    appointment.appointmentDate,
    appointment.date,
    appointment.startTime,
    appointment.startDateTime,
    appointment.appointmentStart,
    appointment.rawDate,
    fallback
  ];

  for (const candidate of candidates) {
    const dateKey = toDateKey(candidate);
    if (dateKey) return dateKey;
  }

  return "";
}

function getAppointmentLocalTimeKey(appointment = {}) {
  const candidates = [
    appointment.localTimeKey,
    appointment.timeKey,
    appointment.appointmentTime,
    appointment.time,
    appointment.startTime,
    appointment.startDateTime,
    appointment.appointmentStart,
    appointment.rawTime
  ];

  for (const candidate of candidates) {
    const raw = String(candidate || "").trim();
    if (!raw) continue;

    const isoMatch = raw.match(/T(\d{1,2}):(\d{2})/);
    if (isoMatch) {
      return `${String(isoMatch[1]).padStart(2, "0")}:${isoMatch[2]}`;
    }

    const displayMatch = raw.match(/(?:^|\s)(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!displayMatch) continue;

    let hour = Number(displayMatch[1]);
    const minute = displayMatch[2];
    const ampm = String(displayMatch[3] || "").toUpperCase();

    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  return "";
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
      businessName:
        appointment.businessName ||
        result.businessName ||
        job.businessName ||
        "",
      platform:
        appointment.platform ||
        result.platform ||
        job.platform ||
        "",
      bookingUrl:
        appointment.bookingUrl ||
        result.bookingUrl ||
        job.bookingUrl ||
        "",
      serviceName:
        appointment.serviceName ||
        appointment.service ||
        result.serviceName ||
        result.service ||
        job.serviceName ||
        "",
      service:
        appointment.service ||
        appointment.serviceName ||
        result.serviceName ||
        result.service ||
        job.serviceName ||
        "",
      serviceType:
        appointment.serviceType ||
        appointment.serviceCategory ||
        result.serviceType ||
        job.serviceType ||
        "",
      serviceCategory:
        appointment.serviceCategory ||
        appointment.serviceType ||
        result.serviceType ||
        job.serviceType ||
        "",
      durationMinutes:
        appointment.durationMinutes ||
        appointment.duration ||
        result.durationMinutes ||
        job.durationMinutes ||
        null,
      therapistName:
        appointment.therapistName ||
        appointment.providerName ||
        appointment.provider ||
        result.provider ||
        result.providerText ||
        "",
      provider:
        appointment.provider ||
        appointment.providerName ||
        appointment.therapistName ||
        result.provider ||
        result.providerText ||
        "",
      platformServiceId:
        appointment.platformServiceId ||
        result.platformServiceId ||
        job.platformServiceId ||
        null,
      serviceId:
        appointment.serviceId ||
        result.serviceId ||
        job.serviceId ||
        null,
      businessServiceId: resolveBusinessServiceId(
        appointment.businessServiceId,
        appointment.business_service_id,
        result.businessServiceId,
        businessServiceId
      ),
      sourceType: appointment.sourceType || "confirmed",
      localDateKey: getAppointmentLocalDateKey(appointment, localDateKey),
      localTimeKey: getAppointmentLocalTimeKey(appointment)
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

    localDateKey: getAppointmentLocalDateKey(
      {
        time,
        startTime: time
      },
      localDateKey
    ),
    localTimeKey: getAppointmentLocalTimeKey({
      time,
      startTime: time
    }),

    time,
    rawTime: time,

    price: result.price || null,

    sourceType: "confirmed",
    businessServiceId: resolveBusinessServiceId(
      result.businessServiceId,
      businessServiceId
    )
  }));
}

const hydratedBusinessConfig =
  businessConfigByName.get(
    normalizeResultKeyValue(result.businessName || job.businessName)
  ) || job;

const mergedAppointments = mergeConfirmedAndInferredAppointments(
  confirmedAppointments,
  hydratedBusinessConfig,
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
  businessServiceId,
  appointments: confirmedAppointments
};

const reconciledInventory = await reconcileAppointmentInventoryScope({
  businessServiceId,
  anchorServiceId: businessServiceId,
  scrapeStartDate: result.scrapeStartDate || job.scrapeStartDate || null,
  scrapeEndDate: result.scrapeEndDate || job.scrapeEndDate || null
});

console.log(
  `[INVENTORY] Removed ${reconciledInventory.deleted} previous inventory row(s) for this service and scrape window.`
);

const insertedInventoryAppointments =
  await insertConfirmedAppointmentsFromResult(confirmedInventoryResult, {
    scrapeRunId: scrapeRun.id,
    rawScrapeResultId: rawScrapeResult.id
  });

console.log(
  `[INVENTORY] Saved ${insertedInventoryAppointments.length} confirmed appointment(s) to PostgreSQL inventory.`
);

const inferredAppointments = mergedAppointments.filter(
  (appointment) =>
    String(appointment.sourceType || "").toLowerCase() === "inferred"
);

if (inferredAppointments.length > 0) {
  const savedInferred = await inventoryManager.insertInferredAppointments(
    inferredAppointments,
    {
      businessName: result.businessName || job.businessName,
      platform: result.platform || job.platform,
      anchorServiceId: businessServiceId
    }
  );

  console.log(
    `[INVENTORY] Saved ${savedInferred.length} inferred appointment(s) to PostgreSQL inventory.`
  );
} else if (confirmedAppointments.length > 0) {
  const anchor = confirmedAppointments[0] || {};
  console.warn("[INFERENCE] No inferred appointments generated.", {
    businessName: result.businessName || job.businessName || "",
    businessServiceId,
    serviceName: anchor.serviceName || anchor.service || job.serviceName || "",
    serviceType: anchor.serviceType || anchor.serviceCategory || job.serviceType || "",
    durationMinutes: anchor.durationMinutes || job.durationMinutes || null,
    inferenceRole: job.inferenceRole || "",
    inferShorterDurations: job.inferShorterDurations === true,
    configuredServiceCount: Array.isArray(hydratedBusinessConfig.services)
      ? hydratedBusinessConfig.services.length
      : 0
  });
}

results = upsertResult(results, resultWithInference);

      console.log("----- RESULT -----");
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await browser?.close?.().catch(() => null);
  }

  console.log("\n===== SCRAPE COMPLETE =====");
  console.log(`Total results: ${results.length}`);
}

if (require.main === module) {
  run().catch(async (error) => {
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
  scrapeWithRetries,
  usesDedicatedBrowser
};