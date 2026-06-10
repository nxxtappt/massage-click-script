const { loadAdminSettings } = require("./adminSettingsManager");
const { normalizeServiceType } = require("./normalizationUtils");

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
          serviceName: service.serviceName || business.serviceName || "",
          serviceType,
          durationMinutes: service.durationMinutes || business.durationMinutes || null,

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
          priority: service.priority || business.priority || "",
          discoveryStatus:
            service.discoveryStatus ||
            business.discoveryStatus ||
            "",

          daysForward:
            service.daysForward ||
            business.daysForward ||
            null
        };
      });
  }

  const serviceType = getCanonicalServiceTypeForService(business, business);

  return [
    {
      serviceName: business.serviceName || "",
      serviceType,
      durationMinutes: business.durationMinutes || null,

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
      priority: business.priority || "medium",
      discoveryStatus: business.discoveryStatus || "manual",
      daysForward: business.daysForward || null
    }
  ];
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

  if (filters.business) {
    if (!businessMatchesSearch(business, filters.business)) {
      return false;
    }
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
    const targetServiceType = normalizeServiceType(filters.service);

    if (targetServiceType === "massage") {
      if (!genericMassageAllowsService(serviceType)) {
        return false;
      }
    } else if (targetServiceType && targetServiceType !== targetServiceRaw) {
      if (serviceType !== targetServiceType) {
        return false;
      }
    } else if (!serviceName.includes(targetServiceRaw) && !serviceText.includes(targetServiceRaw)) {
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

function buildScrapeJobs(businesses, filters = {}) {
  const adminSettings = loadAdminSettings();
  const jobs = [];

  for (const business of businesses) {
    if (business.enabled === false) continue;

    const services = getEnabledServicesForBusiness(business);

    for (const service of services) {
      if (!servicePassesServiceRules(service, business, filters, adminSettings)) {
        continue;
      }

      if (!serviceMatchesFilters(service, business, filters)) {
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

      jobs.push({
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
        daysForward: service.daysForward || business.daysForward || null,

        distanceMiles:
          typeof distanceMiles === "number"
            ? Number(distanceMiles.toFixed(2))
            : null
      });
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
  getScrapeMode
};