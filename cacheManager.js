const fs = require("fs");
const path = require("path");

const { normalizeServiceType } = require("./normalizationUtils");

const CACHE_DIR = path.join(__dirname, "cache");

const APPOINTMENT_CACHE_FILE = path.join(
  CACHE_DIR,
  "appointment-cache.json"
);

const DEFAULT_CACHE_TTL_MINUTES = 15;

function ensureCacheExists() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, {
      recursive: true
    });
  }

  if (!fs.existsSync(APPOINTMENT_CACHE_FILE)) {
    fs.writeFileSync(
      APPOINTMENT_CACHE_FILE,
      JSON.stringify([], null, 2)
    );
  }
}

function loadAppointmentCache() {
  ensureCacheExists();

  try {
    const raw = fs.readFileSync(
      APPOINTMENT_CACHE_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch (error) {
    console.error(
      "[CACHE] Failed to load appointment cache:",
      error.message
    );

    return [];
  }
}

function saveAppointmentCache(cache) {
  ensureCacheExists();

  fs.writeFileSync(
    APPOINTMENT_CACHE_FILE,
    JSON.stringify(cache, null, 2)
  );
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCacheKey(result) {
  const canonicalServiceType =
    normalizeServiceType(
      result.serviceType ||
      result.serviceCategory ||
      result.serviceName ||
      result.service ||
      ""
    );

  return [
    normalize(result.businessName),
    normalize(result.platform),
    normalize(
      result.serviceName ||
      result.service
    ),
    canonicalServiceType,
    result.durationMinutes || 0
  ].join("|");
}

function buildExpirationDate(
  ttlMinutes =
    DEFAULT_CACHE_TTL_MINUTES
) {
  const expires = new Date();

  expires.setMinutes(
    expires.getMinutes() +
      ttlMinutes
  );

  return expires.toISOString();
}

function isExpired(item) {
  if (!item.expiresAt) {
    return true;
  }

  const expiresAt = new Date(
    item.expiresAt
  );

  return (
    expiresAt.getTime() <
    Date.now()
  );
}

function removeExpiredCacheEntries(
  cache = []
) {
  return cache.filter(
    (item) => !isExpired(item)
  );
}

function getAgeMinutes(item) {
  const checked =
    item.lastChecked ||
    item.cachedAt;

  if (!checked) {
    return null;
  }

  const checkedTime =
    new Date(checked).getTime();

  if (
    Number.isNaN(checkedTime)
  ) {
    return null;
  }

  return Math.round(
    (Date.now() - checkedTime) /
      60000
  );
}

function isFreshCacheEntry(
  item,
  maxAgeMinutes = 15
) {
  if (!item) {
    return false;
  }

  if (isExpired(item)) {
    return false;
  }

  const ageMinutes =
    getAgeMinutes(item);

  if (
    typeof ageMinutes !==
    "number"
  ) {
    return false;
  }

  return (
    ageMinutes <= maxAgeMinutes
  );
}

function findCacheEntryForTarget(
  target = {}
) {
  const cache =
    loadAppointmentCache();

  const cacheKey =
    buildCacheKey(target);

  return (
    cache.find(
      (item) =>
        item.cacheKey ===
        cacheKey
    ) || null
  );
}

function analyzeTargetsForCache(
  targets = [],
  options = {}
) {
  const {
    freshMinutes = 15
  } = options;

  const freshTargets = [];
  const staleTargets = [];
  const missingTargets = [];

  for (const target of targets) {
    const cacheEntry =
      findCacheEntryForTarget(
        target
      );

    if (!cacheEntry) {
      missingTargets.push({
        target,
        cacheEntry: null
      });

      continue;
    }

    if (
      isFreshCacheEntry(
        cacheEntry,
        freshMinutes
      )
    ) {
      freshTargets.push({
        target,
        cacheEntry
      });
    } else {
      staleTargets.push({
        target,
        cacheEntry
      });
    }
  }

  return {
    freshTargets,
    staleTargets,
    missingTargets,

    counts: {
      fresh:
        freshTargets.length,
      stale:
        staleTargets.length,
      missing:
        missingTargets.length,
      total: targets.length
    }
  };
}

function upsertAppointmentResult(
  result,
  options = {}
) {
  const {
    ttlMinutes =
      DEFAULT_CACHE_TTL_MINUTES
  } = options;

  const cache =
    loadAppointmentCache();

  const cleanedCache =
    removeExpiredCacheEntries(
      cache
    );

  const canonicalServiceType =
    normalizeServiceType(
      result.serviceType ||
      result.serviceCategory ||
      result.serviceName ||
      result.service ||
      ""
    );

  const cacheKey =
    buildCacheKey({
      ...result,
      serviceType: canonicalServiceType
    });

  const cacheEntry = {
    cacheKey,

    businessName:
      result.businessName ||
      null,

    bookingUrl:
      result.bookingUrl ||
      null,

    platform:
      result.platform || null,

    service:
      result.service ||
      result.serviceName ||
      null,

    serviceName:
      result.serviceName ||
      result.service ||
      null,

    serviceType:
      canonicalServiceType,

    durationMinutes:
      result.durationMinutes ||
      null,

    platformServiceId:
      result.platformServiceId ||
      null,

    provider:
      result.provider || null,

    date:
      result.date || null,

    times: Array.isArray(
      result.times
    )
      ? result.times
      : [],

    therapistAvailability:
      result.therapistAvailability ||
      [],

    openings:
      result.openings || [],

      appointments:
      result.appointments || [],

    therapists:
      result.therapists || [],

    category:
      result.category || null,

    distanceMiles:
      typeof result.distanceMiles ===
      "number"
        ? result.distanceMiles
        : null,

    price:
    result.price ||
    result.servicePrice ||
    result.cost ||
    null,

    status:
      result.status ||
      "unknown",

    error:
      result.error || null,

    scrapeDurationMs:
      result.scrapeDurationMs ||
      null,

    lastChecked:
      result.lastChecked ||
      new Date().toISOString(),

    expiresAt:
      buildExpirationDate(
        ttlMinutes
      ),

    cachedAt:
      new Date().toISOString(),

    rawWidgetText:
      result.rawWidgetText ||
      null
  };

  const existingIndex =
    cleanedCache.findIndex(
      (item) =>
        item.cacheKey ===
        cacheKey
    );

  if (existingIndex >= 0) {
    cleanedCache[
      existingIndex
    ] = cacheEntry;
  } else {
    cleanedCache.push(
      cacheEntry
    );
  }

  saveAppointmentCache(
    cleanedCache
  );

  console.log(
    `[CACHE] Saved: ${cacheKey}`
  );

  return cacheEntry;
}

function getCachedAppointments(
  filters = {}
) {
  const cache =
    removeExpiredCacheEntries(
      loadAppointmentCache()
    );

  const canonicalFilterServiceType =
    filters.serviceType
      ? normalizeServiceType(filters.serviceType)
      : null;

  return cache.filter(
    (item) => {
      if (
        filters.platform &&
        normalize(
          item.platform
        ) !==
          normalize(
            filters.platform
          )
      ) {
        return false;
      }

      if (
        filters.business &&
        !normalize(
          item.businessName
        ).includes(
          normalize(
            filters.business
          )
        )
      ) {
        return false;
      }

      if (
        canonicalFilterServiceType &&
        normalizeServiceType(
          item.serviceType
        ) !== canonicalFilterServiceType
      ) {
        return false;
      }

      if (
        filters.durationMinutes &&
        Number(
          item.durationMinutes
        ) !==
          Number(
            filters.durationMinutes
          )
      ) {
        return false;
      }

      if (
        filters.status &&
        normalize(
          item.status
        ) !==
          normalize(
            filters.status
          )
      ) {
        return false;
      }

      return true;
    }
  );
}

function clearAppointmentCache() {
  saveAppointmentCache([]);

  console.log(
    "[CACHE] Appointment cache cleared."
  );
}

function getCacheStats() {
  const cache =
    loadAppointmentCache();

  const active =
    removeExpiredCacheEntries(
      cache
    );

  const expiredCount =
    cache.length -
    active.length;

  return {
    totalEntries:
      cache.length,

    activeEntries:
      active.length,

    expiredEntries:
      expiredCount,

    cacheFile:
      APPOINTMENT_CACHE_FILE
  };
}

module.exports = {
  loadAppointmentCache,
  saveAppointmentCache,
  upsertAppointmentResult,
  getCachedAppointments,
  clearAppointmentCache,
  getCacheStats,
  removeExpiredCacheEntries,
  buildCacheKey,
  isExpired,

  getAgeMinutes,
  isFreshCacheEntry,
  findCacheEntryForTarget,
  analyzeTargetsForCache
};