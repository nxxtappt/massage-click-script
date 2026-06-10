const {
  loadAppointmentCache,
  buildCacheKey,
  isExpired
} = require("./cacheManager");

function findCachedResultForJob(job) {
  const cache = loadAppointmentCache();
  const cacheKey = buildCacheKey(job);

  return cache.find((item) => item.cacheKey === cacheKey) || null;
}

function isFreshCachedResult(item) {
  if (!item) return false;
  return !isExpired(item);
}

function shouldSkipScrapeForFreshCache(job, options = {}) {
  const { forceRefresh = false } = options;

  if (forceRefresh) {
    return {
      skip: false,
      reason: "force_refresh_enabled",
      cachedResult: null
    };
  }

  const cachedResult = findCachedResultForJob(job);

  if (!cachedResult) {
    return {
      skip: false,
      reason: "no_cache_entry",
      cachedResult: null
    };
  }

  if (!isFreshCachedResult(cachedResult)) {
    return {
      skip: false,
      reason: "cache_expired",
      cachedResult
    };
  }

  return {
    skip: true,
    reason: "fresh_cache_found",
    cachedResult
  };
}

module.exports = {
  findCachedResultForJob,
  isFreshCachedResult,
  shouldSkipScrapeForFreshCache
};