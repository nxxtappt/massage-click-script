const { normalizeServiceType } = require("./normalizationUtils");
const runtimeStateRepository = require("./database/runtimeStateRepository");

const DEFAULT_CACHE_TTL_MINUTES = 15;
let cache = [];

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
function buildCacheKey(result = {}) {
  return [
    normalize(result.businessName),
    normalize(result.platform),
    normalize(result.serviceName || result.service),
    normalizeServiceType(result.serviceType || result.serviceCategory || result.serviceName || result.service || ""),
    result.durationMinutes || 0
  ].join("|");
}
function isExpired(item) { return !item?.expiresAt || new Date(item.expiresAt).getTime() <= Date.now(); }
function removeExpiredCacheEntries(items = []) { return items.filter((item) => !isExpired(item)); }
function getAgeMinutes(item) {
  const checked = item?.lastChecked || item?.cachedAt;
  const time = checked ? new Date(checked).getTime() : NaN;
  return Number.isNaN(time) ? null : Math.round((Date.now() - time) / 60000);
}
function isFreshCacheEntry(item, maxAgeMinutes = 15) {
  const age = getAgeMinutes(item);
  return !isExpired(item) && typeof age === "number" && age <= maxAgeMinutes;
}
async function initializeAppointmentCache() {
  cache = removeExpiredCacheEntries(await runtimeStateRepository.loadCache());
  return cache;
}
function loadAppointmentCache() { return removeExpiredCacheEntries(cache); }
async function saveAppointmentCache(items = []) {
  await runtimeStateRepository.clearCache();
  cache = [];
  for (const item of items) await upsertAppointmentResult(item, { preserveExpiry: true });
  return cache;
}
function findCacheEntryForTarget(target = {}) {
  const key = buildCacheKey(target);
  return loadAppointmentCache().find((item) => item.cacheKey === key) || null;
}
function analyzeTargetsForCache(targets = [], options = {}) {
  const freshTargets = [], staleTargets = [], missingTargets = [];
  for (const target of targets) {
    const cacheEntry = findCacheEntryForTarget(target);
    if (!cacheEntry) missingTargets.push({ target, cacheEntry: null });
    else if (isFreshCacheEntry(cacheEntry, options.freshMinutes || 15)) freshTargets.push({ target, cacheEntry });
    else staleTargets.push({ target, cacheEntry });
  }
  return { freshTargets, staleTargets, missingTargets, counts: { fresh: freshTargets.length, stale: staleTargets.length, missing: missingTargets.length, total: targets.length } };
}
async function upsertAppointmentResult(result = {}, options = {}) {
  const ttl = Number(options.ttlMinutes || DEFAULT_CACHE_TTL_MINUTES);
  const now = new Date();
  const canonicalServiceType = normalizeServiceType(result.serviceType || result.serviceCategory || result.serviceName || result.service || "");
  const entry = {
    ...result,
    cacheKey: buildCacheKey({ ...result, serviceType: canonicalServiceType }),
    serviceType: canonicalServiceType,
    serviceName: result.serviceName || result.service || null,
    cachedAt: result.cachedAt || now.toISOString(),
    lastChecked: result.lastChecked || now.toISOString(),
    expiresAt: options.preserveExpiry && result.expiresAt
      ? result.expiresAt
      : new Date(now.getTime() + ttl * 60000).toISOString()
  };
  cache = cache.filter((item) => item.cacheKey !== entry.cacheKey);
  cache.push(entry);
  await runtimeStateRepository.upsertCache(entry);
  return entry;
}
function getCachedAppointments(filters = {}) {
  const serviceType = filters.serviceType ? normalizeServiceType(filters.serviceType) : "";
  return loadAppointmentCache().filter((item) => {
    if (filters.platform && normalize(item.platform) !== normalize(filters.platform)) return false;
    if (filters.business && !normalize(item.businessName).includes(normalize(filters.business))) return false;
    if (serviceType && normalizeServiceType(item.serviceType) !== serviceType) return false;
    if (filters.durationMinutes && Number(item.durationMinutes) !== Number(filters.durationMinutes)) return false;
    if (filters.status && normalize(item.status) !== normalize(filters.status)) return false;
    return true;
  });
}
async function clearAppointmentCache() { cache = []; return runtimeStateRepository.clearCache(); }
function getCacheStats() {
  const active = loadAppointmentCache();
  return { totalEntries: active.length, activeEntries: active.length, expiredEntries: 0, source: "postgres" };
}
module.exports = {
  initializeAppointmentCache,
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