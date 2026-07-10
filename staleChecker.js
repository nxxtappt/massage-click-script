const { findCacheEntryForTarget, isExpired } = require("./cacheManager");
function findCachedResultForJob(job) { return findCacheEntryForTarget(job); }
function isFreshCachedResult(item) { return Boolean(item) && !isExpired(item); }
function shouldSkipScrapeForFreshCache(job, options = {}) {
  if (options.forceRefresh) return { skip: false, reason: "force_refresh_enabled", cachedResult: null };
  const cachedResult = findCachedResultForJob(job);
  if (!cachedResult) return { skip: false, reason: "no_cache_entry", cachedResult: null };
  if (!isFreshCachedResult(cachedResult)) return { skip: false, reason: "cache_expired", cachedResult };
  return { skip: true, reason: "fresh_cache_found", cachedResult };
}
module.exports = { findCachedResultForJob, isFreshCachedResult, shouldSkipScrapeForFreshCache };