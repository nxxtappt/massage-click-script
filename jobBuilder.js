const { loadAdminSettings } = require("./adminSettingsManager");
const { normalizeServiceType } = require("./normalizationUtils");
const {
  resolveEnabledIntegration,
  validateIntegration,
  applyIntegrationToJob
} = require("./platformIntegrationRegistry");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const map = {};

  parts.forEach((part) => {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  });

  return `${map.year}-${map.month}-${map.day}`;
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return false;
  }

  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);

  return (
    date.getFullYear() === year &&
    date.getMonth() + 1 === month &&
    date.getDate() === day
  );
}

function normalizeDateKey(value) {
  if (!value) return "";

  const raw = String(value).trim();

  if (isValidDateKey(raw)) {
    return raw;
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})(\/(\d{2,4}))?$/);

  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    let year = slashMatch[4] ? Number(slashMatch[4]) : new Date().getFullYear();

    if (year < 100) {
      year += 2000;
    }

    const candidate = `${year}-${pad2(month)}-${pad2(day)}`;

    return isValidDateKey(candidate) ? candidate : "";
  }

  return "";
}

function addDaysToDateKey(dateKey, daysToAdd) {
  const safeDateKey = normalizeDateKey(dateKey) || getTodayDateKey();
  const [year, month, day] = safeDateKey.split("-").map(Number);

  const date = new Date(year, month - 1, day + Number(daysToAdd || 0), 12, 0, 0);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function getDaysBetweenInclusive(startDateKey, endDateKey) {
  const start = normalizeDateKey(startDateKey);
  const end = normalizeDateKey(endDateKey);

  if (!start || !end) {
    return 1;
  }

  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);

  const startDate = new Date(startYear, startMonth - 1, startDay, 12, 0, 0);
  const endDate = new Date(endYear, endMonth - 1, endDay, 12, 0, 0);

  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  return Math.max(1, diffDays + 1);
}

function businessMatchesSearch(business = {}, businessSearch = "") {
  const target = normalize(businessSearch);

  if (!target) {
    return true;
  }

  const businessName = normalize(business.businessName || business.name || "");

  const aliases = Array.isArray(business.searchAliases)
    ? business.searchAliases.map(normalize)
    : [];

  const searchableText = normalize(
    [
      business.businessName,
      business.name,
      business.displayName,
      business.publicName,
      business.shortName,
      business.brandName,
      business.keywords,
      business.address,
      ...aliases
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (!businessName && !searchableText) {
    return false;
  }

  if (searchableText.includes(target)) {
    return true;
  }

  if (businessName && target.includes(businessName)) {
    return true;
  }

  const genericWords = new Set([
    "massage",
    "massages",
    "wellness",
    "therapy",
    "therapies",
    "spa",
    "studio",
    "lab",
    "clinic",
    "center",
    "centre",
    "athletic",
    "athlete",
    "the",
    "and",
    "austin",
    "tx",
    "texas"
  ]);

  const targetWords = target
    .split(" ")
    .filter((word) => word.length > 2)
    .filter((word) => !genericWords.has(word));

  if (!targetWords.length) {
    return false;
  }

  return targetWords.some((word) => searchableText.includes(word));
}

function parseCliFilters(argv = []) {
  const filters = {};

  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;

    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");

    if (!rawKey) continue;

    const key = rawKey.trim();
    const value = rawValue === undefined ? true : rawValue.trim();

    filters[key] = value;
  }

  if (filters.duration) {
    filters.durationMinutes = Number(filters.duration);
  }

  if (filters.durationMinutes) {
    filters.durationMinutes = Number(filters.durationMinutes);
  }

  if (filters.maxDistanceMiles) {
    filters.maxDistanceMiles = Number(filters.maxDistanceMiles);
  }

  if (filters.latitude) {
    filters.latitude = Number(filters.latitude);
  }

  if (filters.longitude) {
    filters.longitude = Number(filters.longitude);
  }

  if (filters.lookaheadHours) {
    filters.lookaheadHours = Number(filters.lookaheadHours);
  }

  if (filters.daysForward) {
    filters.daysForward = Number(filters.daysForward);
  }

  return filters;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number"
  ) {
    return null;
  }

  const earthRadiusMiles = 3958.8;

  const toRadians = (degrees) => degrees * (Math.PI / 180);

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMiles * c;
}

function getCanonicalServiceTypeForService(service = {}, business = {}) {
  return normalizeServiceType(
    service.serviceType ||
      business.serviceType ||
      service.serviceCategory ||
      business.serviceCategory ||
      service.serviceName ||
      business.serviceName ||
      business.service ||
      ""
  );
}

function genericMassageAllowsService(serviceType) {
  return ["massage", "swedish", "relaxation"].includes(serviceType);
}

function getEnabledServicesForBusiness(business) {
  if (Array.isArray(business.services) && business.services.length > 0) {
    return business.services
      .filter((service) => service.enabled !== false)
      .map((service) => {
        const serviceType = getCanonicalServiceTypeForService(service, business);

        return {
          id:
            service.id ||
            service.businessServiceId ||
            service.business_service_id ||
            null,
          businessServiceId:
            service.businessServiceId ||
            service.id ||
            service.business_service_id ||
            null,
          integrationId:
            service.integrationId ||
            service.integration_id ||
            service.raw_json?.integrationId ||
            null,
          canonicalKey:
            service.canonicalKey ||
            service.canonical_key ||
            "",
          serviceName: service.serviceName || business.serviceName || "",
          serviceType,
          durationMinutes: service.durationMinutes || business.durationMinutes || null,
          price: service.price ?? business.price ?? null,
          sessionTypeId:
            service.sessionTypeId ||
            service.session_type_id ||
            null,

          platformServiceId:
            service.platformServiceId ||
            service.serviceButtonId ||
            service.serviceId ||
            business.serviceButtonId ||
            business.platformServiceId ||
            business.serviceId ||
            null,

          serviceButtonId:
            service.serviceButtonId ||
            service.platformServiceId ||
            service.serviceId ||
            business.serviceButtonId ||
            business.platformServiceId ||
            business.serviceId ||
            null,

          serviceId:
            service.serviceId ||
            service.platformServiceId ||
            service.serviceButtonId ||
            business.serviceId ||
            business.platformServiceId ||
            business.serviceButtonId ||
            null,

          categoryText:
            service.categoryText ||
            service.categoryName ||
            business.categoryText ||
            business.categoryName ||
            "Massage",

          categoryName:
            service.categoryName ||
            service.categoryText ||
            business.categoryName ||
            business.categoryText ||
            "Massage",

          parentServiceText:
            service.parentServiceText ||
            business.parentServiceText ||
            "",

          providerText:
            service.providerText ||
            business.providerText ||
            "First Available",

          skipProvider:
            typeof service.skipProvider === "boolean"
              ? service.skipProvider
              : Boolean(business.skipProvider),

          enabled: service.enabled !== false,
          scrapeDirectly:
            service.scrapeDirectly !== false &&
            service.inferenceRole !== "inferred" &&
            service.searchInference?.canBeInferred !== true,
          priority: service.priority || business.priority || "",
          discoveryStatus:
            service.discoveryStatus ||
            business.discoveryStatus ||
            "",

          daysForward:
            service.daysForward ||
            business.daysForward ||
            null,

          lookaheadHours:
            service.lookaheadHours ||
            business.lookaheadHours ||
            null,

          searchInference:
            service.searchInference ||
            service.inference ||
            null,

          inferenceEnabled:
            service.inferenceEnabled === true ||
            service.searchInference?.enabled === true ||
            Boolean(service.inferenceRole),

          inferenceRole:
            service.inferenceRole ||
            service.searchInference?.inferenceRole ||
            service.inference?.role ||
            "",

          canInfer:
            service.canInfer === true ||
            service.searchInference?.isInferenceAnchor === true ||
            service.searchInference?.inferenceRole === "anchor" ||
            service.inferenceRole === "anchor",

          inferShorterDurations:
            service.inferShorterDurations === true ||
            service.searchInference?.inferShorterDurations === true ||
            service.inference?.inferShorterDurations === true,

          inferServiceTypes: Array.isArray(service.inferServiceTypes)
            ? service.inferServiceTypes
            : Array.isArray(service.searchInference?.inferServiceTypes)
              ? service.searchInference.inferServiceTypes
              : [],

          inferStartIntervalMinutes:
            service.inferStartIntervalMinutes ||
            service.searchInference?.inferStartIntervalMinutes ||
            null,

          inferenceConfidence:
            service.inferenceConfidence ??
            service.searchInference?.confidence ??
            null,

          bookingIntervalMinutes:
            service.bookingIntervalMinutes ||
            null,

          anchorServiceId:
            service.anchorServiceId ||
            service.anchor_service_id ||
            service.searchInference?.anchorServiceId ||
            null,

          anchorServiceKey:
            service.anchorServiceKey ||
            service.anchor_service_key ||
            service.searchInference?.anchorServiceKey ||
            null,

          inferredFromAnchor:
            service.inferredFromAnchor === true ||
            service.searchInference?.canBeInferred === true ||
            service.searchInference?.inferenceRole === "inferred" ||
            service.inferenceRole === "inferred",

          inference:
            service.searchInference ||
            service.inference ||
            null
        };
          });
    }

  const serviceType = getCanonicalServiceTypeForService(business, business);

  return [
    {
      id:
        business.id ||
        business.businessServiceId ||
        business.business_service_id ||
        null,
      businessServiceId:
        business.businessServiceId ||
        business.id ||
        business.business_service_id ||
        null,
      integrationId: business.integrationId || business.integration_id || null,
      canonicalKey:
        business.canonicalKey ||
        business.canonical_key ||
        "",
      serviceName: business.serviceName || "",
      serviceType,
      durationMinutes: business.durationMinutes || null,
      price: business.price ?? null,
      sessionTypeId:
        business.sessionTypeId ||
        business.session_type_id ||
        null,

      platformServiceId:
        business.platformServiceId ||
        business.serviceButtonId ||
        business.serviceId ||
        null,

      serviceButtonId:
        business.serviceButtonId ||
        business.platformServiceId ||
        business.serviceId ||
        null,

      serviceId:
        business.serviceId ||
        business.platformServiceId ||
        business.serviceButtonId ||
        null,

      categoryText: business.categoryText || business.categoryName || "Massage",
      categoryName: business.categoryName || business.categoryText || "Massage",
      parentServiceText: business.parentServiceText || "",
      providerText: business.providerText || "First Available",
      skipProvider: Boolean(business.skipProvider),
      enabled: true,
      scrapeDirectly: business.scrapeDirectly !== false,
      priority: business.priority || "medium",
      discoveryStatus: business.discoveryStatus || "manual",
      daysForward: business.daysForward || null,
      lookaheadHours: business.lookaheadHours || null,
      searchInference: business.searchInference || null,
      inferenceRole:
        business.inferenceRole ||
        business.searchInference?.inferenceRole ||
        business.inference?.role ||
        "",
      canInfer:
        business.canInfer === true ||
        business.searchInference?.isInferenceAnchor === true ||
        business.searchInference?.inferenceRole === "anchor",
      inferShorterDurations:
        business.inferShorterDurations === true ||
        business.searchInference?.inferShorterDurations === true ||
        business.inference?.inferShorterDurations === true,
      inferredFromAnchor:
        business.inferredFromAnchor === true ||
        business.searchInference?.canBeInferred === true ||
        business.searchInference?.inferenceRole === "inferred",
      inference:
        business.searchInference ||
        business.inference ||
        null
    }
  ];
}

function getRequestedDate(filters = {}) {
  return (
    normalizeDateKey(filters.scrapeDate) ||
    normalizeDateKey(filters.targetDate) ||
    normalizeDateKey(filters.appointmentDate) ||
    normalizeDateKey(filters.date) ||
    normalizeDateKey(filters.targetLocalDateKey) ||
    ""
  );
}

function getResolvedScrapeWindow(service = {}, business = {}, filters = {}, adminSettings = null) {
  const settings = adminSettings || loadAdminSettings();
  const today = getTodayDateKey();

  const explicitStartDate =
    normalizeDateKey(filters.scrapeStartDate) ||
    normalizeDateKey(filters.startDate) ||
    "";

  const explicitEndDate =
    normalizeDateKey(filters.scrapeEndDate) ||
    normalizeDateKey(filters.endDate) ||
    "";

  const requestedDate = getRequestedDate(filters);

  if (requestedDate) {
    return {
      scrapeStartDate: requestedDate,
      scrapeEndDate: requestedDate,
      lookaheadHours: 24,
      daysForward: 1,
      scrapeWindowMode: "specific_date"
    };
  }

  if (explicitStartDate || explicitEndDate) {
    const scrapeStartDate = explicitStartDate || today;
    const scrapeEndDate = explicitEndDate || scrapeStartDate;
    const daysForward = getDaysBetweenInclusive(scrapeStartDate, scrapeEndDate);

    return {
      scrapeStartDate,
      scrapeEndDate,
      lookaheadHours: daysForward * 24,
      daysForward,
      scrapeWindowMode: "custom_range"
    };
  }

  if (filters.daysForward) {
    const daysForward = Math.max(1, Number(filters.daysForward));

    return {
      scrapeStartDate: today,
      scrapeEndDate: addDaysToDateKey(today, daysForward - 1),
      lookaheadHours: daysForward * 24,
      daysForward,
      scrapeWindowMode: "days_forward"
    };
  }

  if (filters.lookaheadHours) {
    const lookaheadHours = Math.max(1, Number(filters.lookaheadHours));
    const daysForward = Math.max(1, Math.ceil(lookaheadHours / 24));

    return {
      scrapeStartDate: today,
      scrapeEndDate: addDaysToDateKey(today, daysForward - 1),
      lookaheadHours,
      daysForward,
      scrapeWindowMode: "lookahead_hours"
    };
  }

  if (service.lookaheadHours || business.lookaheadHours) {
    const lookaheadHours = Math.max(
      1,
      Number(service.lookaheadHours || business.lookaheadHours)
    );

    const daysForward = Math.max(1, Math.ceil(lookaheadHours / 24));

    return {
      scrapeStartDate: today,
      scrapeEndDate: addDaysToDateKey(today, daysForward - 1),
      lookaheadHours,
      daysForward,
      scrapeWindowMode: "business_or_service_lookahead"
    };
  }

  if (service.daysForward || business.daysForward) {
    const daysForward = Math.max(1, Number(service.daysForward || business.daysForward));

    return {
      scrapeStartDate: today,
      scrapeEndDate: addDaysToDateKey(today, daysForward - 1),
      lookaheadHours: daysForward * 24,
      daysForward,
      scrapeWindowMode: "business_or_service_days_forward"
    };
  }

  // Jane's standard public treatment view exposes a seven-day calendar.
  // Keep that full window unless an explicit date/range or service/business
  // window was supplied above.
  if (normalize(business.platform) === "jane") {
    const daysForward = 7;

    return {
      scrapeStartDate: today,
      scrapeEndDate: addDaysToDateKey(today, daysForward - 1),
      lookaheadHours: 168,
      daysForward,
      scrapeWindowMode: "jane_default_7_days"
    };
  }

  const defaultLookaheadHours = Number(settings.scraping?.defaultLookaheadHours || 48);
  const lookaheadHours = Math.max(1, defaultLookaheadHours);
  const daysForward = Math.max(1, Math.ceil(lookaheadHours / 24));

  return {
    scrapeStartDate: today,
    scrapeEndDate: addDaysToDateKey(today, daysForward - 1),
    lookaheadHours,
    daysForward,
    scrapeWindowMode: "default_lookahead"
  };
}

function getResolvedDaysForward(service = {}, business = {}, filters = {}, adminSettings = null) {
  return getResolvedScrapeWindow(service, business, filters, adminSettings).daysForward;
}

function getScrapeMode(filters = {}) {
  if (filters.manual === true || filters.manual === "true") {
    return "manual";
  }

  if (filters.onDemand === true || filters.onDemand === "true") {
    return "onDemand";
  }

  return "scheduled";
}

function normalizeList(values = []) {
  if (!Array.isArray(values)) return [];

  return values
    .map((value) => normalize(value))
    .filter(Boolean);
}

function servicePassesServiceRules(service, business, filters = {}, adminSettings = null) {
  const settings = adminSettings || loadAdminSettings();
  const rules = settings.serviceRules || {};
  const mode = getScrapeMode(filters);

  if (filters.ignoreServiceRules === true || filters.ignoreServiceRules === "true") {
    return true;
  }

  if (service.enabled === false) {
    return false;
  }

  const priority = normalize(service.priority);
  const discoveryStatus = normalize(service.discoveryStatus);

  let allowedPriorities = [];
  let allowedDiscoveryStatuses = [];

  if (mode === "scheduled") {
    allowedPriorities = normalizeList(rules.scheduledPriorities || ["high"]);
    allowedDiscoveryStatuses = normalizeList(rules.scheduledDiscoveryStatuses || ["approved"]);
  }

  if (mode === "onDemand") {
    allowedPriorities = normalizeList(rules.onDemandPriorities || ["high", "medium", "normal"]);
    allowedDiscoveryStatuses = normalizeList(
      rules.onDemandDiscoveryStatuses || ["approved", "manual"]
    );
  }

  if (mode === "manual") {
    allowedPriorities = normalizeList(
      rules.manualPriorities || ["high", "medium", "normal", "low"]
    );
    allowedDiscoveryStatuses = normalizeList(
      rules.manualDiscoveryStatuses || ["approved", "manual", "test", "pending"]
    );
  }

  const allowNoPriority = rules.allowServicesWithoutPriority === true;
  const allowNoDiscoveryStatus = rules.allowServicesWithoutDiscoveryStatus === true;

  if (!priority && !allowNoPriority) {
    return false;
  }

  if (!discoveryStatus && !allowNoDiscoveryStatus) {
    return false;
  }

  if (priority && allowedPriorities.length && !allowedPriorities.includes(priority)) {
    return false;
  }

  if (
    discoveryStatus &&
    allowedDiscoveryStatuses.length &&
    !allowedDiscoveryStatuses.includes(discoveryStatus)
  ) {
    return false;
  }

  return true;
}

function serviceMatchesFilters(service, business, filters = {}) {
  if (filters.platform && normalize(business.platform) !== normalize(filters.platform)) {
    return false;
  }

  const serviceType = normalizeServiceType(service.serviceType);
  const serviceName = normalize(service.serviceName);
  const serviceText = normalize(
    [
      service.serviceName,
      service.serviceType,
      service.durationMinutes,
      service.platformServiceId,
      service.serviceButtonId,
      service.serviceId
    ].join(" ")
  );

  if (filters.serviceType) {
    const targetServiceType = normalizeServiceType(filters.serviceType);

    if (targetServiceType === "massage") {
      if (!genericMassageAllowsService(serviceType)) {
        return false;
      }
    } else if (serviceType !== targetServiceType) {
      return false;
    }
  }

if (filters.service) {
  const targetServiceRaw = normalize(filters.service);

  if (
    !serviceName.includes(targetServiceRaw) &&
    !serviceText.includes(targetServiceRaw)
  ) {
    return false;
  }
}

  if (filters.durationMinutes) {
    if (Number(service.durationMinutes) !== Number(filters.durationMinutes)) {
      return false;
    }
  }

  if (filters.priority) {
    if (normalize(service.priority) !== normalize(filters.priority)) {
      return false;
    }
  }

  if (filters.discoveryStatus) {
    if (normalize(service.discoveryStatus) !== normalize(filters.discoveryStatus)) {
      return false;
    }
  }

  if (
    filters.latitude &&
    filters.longitude &&
    filters.maxDistanceMiles &&
    business.latitude &&
    business.longitude
  ) {
    const distanceMiles = milesBetween(
      Number(filters.latitude),
      Number(filters.longitude),
      Number(business.latitude),
      Number(business.longitude)
    );

    if (distanceMiles !== null && distanceMiles > Number(filters.maxDistanceMiles)) {
      return false;
    }
  }

  return true;
}

function limitServicesPerBusiness(jobs, filters = {}, adminSettings = null) {
  const settings = adminSettings || loadAdminSettings();
  const rules = settings.serviceRules || {};
  const mode = getScrapeMode(filters);

  let limit = null;

  if (mode === "scheduled") {
    limit = Number(rules.maxServicesPerBusinessPerScheduledRun || 0);
  }

  if (mode === "onDemand") {
    limit = Number(rules.maxServicesPerBusinessPerOnDemandRun || 0);
  }

  if (mode === "manual") {
    limit = null;
  }

  if (!limit || limit <= 0) {
    return jobs;
  }

  const grouped = new Map();
  const limited = [];

  for (const job of jobs) {
    const key = normalize(job.businessName || job.name || "unknown");

    if (!grouped.has(key)) {
      grouped.set(key, 0);
    }

    const currentCount = grouped.get(key);

    if (currentCount >= limit) {
      continue;
    }

    grouped.set(key, currentCount + 1);
    limited.push(job);
  }

  return limited;
}
function hasExplicitServiceTarget(filters = {}) {
  return Boolean(
    filters.service ||
      filters.serviceName ||
      filters.serviceId ||
      filters.platformServiceId ||
      filters.serviceButtonId ||
      filters.duration ||
      filters.durationMinutes
  );
}

function serviceIsInferenceAnchor(service = {}) {
  const searchInference = service.searchInference || service.inference || {};

  return Boolean(
    service.canInfer === true ||
      service.inferenceRole === "anchor" ||
      searchInference.role === "anchor" ||
      searchInference.inferenceRole === "anchor" ||
      searchInference.isInferenceAnchor === true
  );
}

function serviceIsInferredTarget(service = {}) {
  const searchInference = service.searchInference || service.inference || {};

  return Boolean(
    service.inferredFromAnchor === true ||
      service.inferenceRole === "inferred" ||
      searchInference.role === "inferred" ||
      searchInference.inferenceRole === "inferred" ||
      searchInference.canBeInferred === true
  );
}

function shouldScrapeServiceDirectly(service = {}, filters = {}) {
  const forceDirectScrape =
    filters.forceDirectScrape === true ||
    filters.forceDirectScrape === "true";

  if (forceDirectScrape) {
    return true;
  }

  if (serviceIsInferredTarget(service)) {
    return false;
  }

  return service.scrapeDirectly !== false;
}

function sortServicesForScraping(services = []) {
  return [...services].sort((a, b) => {
    const anchorDifference =
      Number(serviceIsInferenceAnchor(b)) -
      Number(serviceIsInferenceAnchor(a));

    if (anchorDifference) {
      return anchorDifference;
    }

    const priorityRank = {
      high: 0,
      medium: 1,
      normal: 2,
      low: 3
    };

    const aPriority = priorityRank[normalize(a.priority)] ?? 4;
    const bPriority = priorityRank[normalize(b.priority)] ?? 4;

    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return String(a.serviceName || "").localeCompare(
      String(b.serviceName || "")
    );
  });
}

function businessHasInferenceAnchors(services = []) {
  return services.some(serviceIsInferenceAnchor);
}

function filterServicesForInferenceAnchors(services = [], filters = {}) {
  const anchorOnly =
    filters.anchorOnly === true ||
    filters.anchorOnly === "true" ||
    filters.inferenceOnly === true ||
    filters.inferenceOnly === "true";

  if (!anchorOnly) {
    return services;
  }

  if (hasExplicitServiceTarget(filters)) {
    return services;
  }

  if (!businessHasInferenceAnchors(services)) {
    return services;
  }

  return services.filter(serviceIsInferenceAnchor);
}
function businessMatchesExactNameOrAlias(business = {}, businessSearch = "") {
  const target = normalize(businessSearch);

  if (!target) {
    return false;
  }

  const names = [
    business.businessName,
    business.name,
    business.displayName,
    business.publicName,
    business.shortName,
    business.brandName,
    ...(Array.isArray(business.searchAliases) ? business.searchAliases : [])
  ]
    .map(normalize)
    .filter(Boolean);

  return names.includes(target);
}

function getBusinessFilterMode(businesses = [], filters = {}) {
  if (!filters.business) {
    return "none";
  }

  const hasExactMatch = businesses.some((business) =>
    businessMatchesExactNameOrAlias(business, filters.business)
  );

  return hasExactMatch ? "exact" : "loose";
}

function businessPassesBusinessFilter(business = {}, filters = {}, businessFilterMode = "none") {
  if (!filters.business) {
    return true;
  }

  if (businessFilterMode === "exact") {
    return businessMatchesExactNameOrAlias(business, filters.business);
  }

  return businessMatchesSearch(business, filters.business);
}

function validateScrapeJob(job = {}) {
  const errors = [];
  const warnings = [];
  if (!job.businessName) errors.push("businessName is required.");
  if (!job.serviceName) errors.push("serviceName is required.");
  if (!job.durationMinutes || Number(job.durationMinutes) <= 0) warnings.push("durationMinutes is missing or invalid.");
  if (!job.integration) errors.push("No enabled integration resolved for the business/service.");
  if (job.integrationValidation) {
    errors.push(...(job.integrationValidation.errors || []));
    warnings.push(...(job.integrationValidation.warnings || []));
  }
  return { valid: errors.length === 0, errors, warnings, job };
}

function resolveJobIntegration(business = {}, service = {}, filters = {}) {
  return resolveEnabledIntegration(business, {
    integrationId: filters.integrationId || service.integrationId,
    platform: filters.platform || business.platform,
    integrationType: filters.integrationType
  });
}

function buildScrapeJobs(businesses, filters = {}) {
  const adminSettings = loadAdminSettings();
  const jobs = [];
  const businessFilterMode = getBusinessFilterMode(businesses, filters);

  for (const business of businesses) {
    if (business.enabled === false) continue;

    if (!businessPassesBusinessFilter(business, filters, businessFilterMode)) {
      continue;
    }

    const services = sortServicesForScraping(
      filterServicesForInferenceAnchors(
        getEnabledServicesForBusiness(business),
        filters
      ).filter((service) => shouldScrapeServiceDirectly(service, filters))
    );

    for (const service of services) {
      if (!servicePassesServiceRules(service, business, filters, adminSettings)) {
        continue;
      }

      if (!serviceMatchesFilters(service, business, filters)) {
        continue;
      }

      const integration = resolveJobIntegration(business, service, filters);
      if (!integration) {
        continue;
      }
      const integrationValidation = validateIntegration(integration, business);
      if (!integrationValidation.valid && filters.allowInvalidJobs !== true && filters.allowInvalidJobs !== "true") {
        continue;
      }

      const distanceMiles =
        filters.latitude &&
        filters.longitude &&
        business.latitude &&
        business.longitude
          ? milesBetween(
              Number(filters.latitude),
              Number(filters.longitude),
              Number(business.latitude),
              Number(business.longitude)
            )
          : null;

      const scrapeWindow = getResolvedScrapeWindow(
        service,
        business,
        filters,
        adminSettings
      );

      const baseJob = {
        ...business,

        integrationType: business.integrationType || "scrape",
        apiProvider: business.apiProvider || "",
        credentialId: business.credentialId || "",

        serviceName: service.serviceName,
        serviceType: normalizeServiceType(service.serviceType),
        durationMinutes: service.durationMinutes,

        platformServiceId: service.platformServiceId,
        serviceButtonId: service.serviceButtonId,
        serviceId: service.serviceId,

        categoryText: service.categoryText,
        categoryName: service.categoryName,
        parentServiceText: service.parentServiceText,
        providerText: service.providerText,
        skipProvider: service.skipProvider,

        servicePriority: service.priority,
        priority: service.priority,
        discoveryStatus: service.discoveryStatus,
        searchInference: service.searchInference || service.inference || null,
        inferenceEnabled: service.inferenceEnabled === true,
        inferenceRole: service.inferenceRole || service.searchInference?.inferenceRole || "",
        canInfer: service.canInfer === true,
        inferredFromAnchor: service.inferredFromAnchor === true,
        inferShorterDurations: service.inferShorterDurations === true,
        inferServiceTypes: Array.isArray(service.inferServiceTypes)
          ? service.inferServiceTypes
          : [],
        inferStartIntervalMinutes: service.inferStartIntervalMinutes || null,
        inferenceConfidence: service.inferenceConfidence ?? null,
        bookingIntervalMinutes: service.bookingIntervalMinutes || null,
        businessServiceId:
          service.businessServiceId ||
          service.business_service_id ||
          service.id ||
          null,
        serviceDatabaseId:
          service.businessServiceId ||
          service.business_service_id ||
          service.id ||
          null,
        anchorServiceId:
          service.anchorServiceId ||
          service.anchor_service_id ||
          service.searchInference?.anchorServiceId ||
          null,
        anchorServiceKey:
          service.anchorServiceKey ||
          service.anchor_service_key ||
          service.searchInference?.anchorServiceKey ||
          null,

        scrapeStartDate: scrapeWindow.scrapeStartDate,
        scrapeEndDate: scrapeWindow.scrapeEndDate,
        lookaheadHours: scrapeWindow.lookaheadHours,
        daysForward: scrapeWindow.daysForward,
        scrapeWindowMode: scrapeWindow.scrapeWindowMode,

        distanceMiles:
          typeof distanceMiles === "number"
            ? Number(distanceMiles.toFixed(2))
            : null,
        integrationValidation
      };

      const resolvedJob = applyIntegrationToJob(baseJob, integration);
      const jobValidation = validateScrapeJob(resolvedJob);
      if (jobValidation.valid || filters.allowInvalidJobs === true || filters.allowInvalidJobs === "true") {
        jobs.push({ ...resolvedJob, jobValidation });
      }
    }
  }

  return limitServicesPerBusiness(jobs, filters, adminSettings);
}

module.exports = {
  parseCliFilters,
  buildScrapeJobs,
  getEnabledServicesForBusiness,
  servicePassesServiceRules,
  serviceMatchesFilters,
  businessMatchesSearch,
  businessMatchesExactNameOrAlias,
  businessPassesBusinessFilter,
  serviceIsInferenceAnchor,
  serviceIsInferredTarget,
  shouldScrapeServiceDirectly,
  sortServicesForScraping,
  filterServicesForInferenceAnchors,
  getScrapeMode,
  getResolvedDaysForward,
  getResolvedScrapeWindow,
  resolveJobIntegration,
  validateScrapeJob
};