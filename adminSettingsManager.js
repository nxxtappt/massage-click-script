const runtimeStateRepository = require("./database/runtimeStateRepository");

const DEFAULT_ADMIN_SETTINGS = {
  searchEnabled: true,
  scraping: {
    enabled: true,
    scheduledScrapingEnabled: true,
    skipFreshCache: true,
    maxConcurrentScrapes: 1,
    defaultIntervalMinutes: 15,
    defaultLookaheadHours: 48,
    skipVagaroDiscoveryByDefault: true
  },
  cache: {
    enabled: true,
    defaultTtlMinutes: 15,
    successTtlMinutes: 15,
    noTimesFoundTtlMinutes: 8,
    fullyBookedTtlMinutes: 8,
    errorTtlMinutes: 3,
    unknownTtlMinutes: 5
  },
  serviceRules: {
    scheduledPriorities: ["high"],
    scheduledDiscoveryStatuses: ["approved"],
    manualPriorities: ["high", "medium", "normal", "low"],
    manualDiscoveryStatuses: ["approved", "manual", "test", "pending"],
    maxServicesPerBusinessPerScheduledRun: 2,
    allowServicesWithoutPriority: false,
    allowServicesWithoutDiscoveryStatus: false
  },
  clusters: {
    "austin-central": { enabled: true, intervalMinutes: 15 }
  },
  platforms: {
    mindbody: true,
    "mindbody-old": true,
    schedulista: true,
    meevo: true,
    axl3: true,
    booker: true,
    zenoti: true,
    mangomint: true,
    "hand-stone": true,
    "massage-envy": true,
    vagaro: false
  },
  safety: {
    stopOnRepeatedErrors: false,
    maxErrorsPerRun: 20,
    logVerbose: true
  }
};

let settingsCache = structuredClone(DEFAULT_ADMIN_SETTINGS);
let initialized = false;

function deepMerge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) &&
        base[key] && typeof base[key] === "object" && !Array.isArray(base[key])) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function initializeAdminSettings() {
  const stored = await runtimeStateRepository.getSettings();
  settingsCache = deepMerge(DEFAULT_ADMIN_SETTINGS, stored || {});
  if (!stored) await runtimeStateRepository.saveSettings(settingsCache);
  initialized = true;
  return settingsCache;
}

function loadAdminSettings() {
  return settingsCache;
}

async function saveAdminSettings(settings) {
  settingsCache = deepMerge(DEFAULT_ADMIN_SETTINGS, settings || {});
  await runtimeStateRepository.saveSettings(settingsCache);
  initialized = true;
  return settingsCache;
}

function getSetting(pathText, fallback) {
  const parts = String(pathText || "").split(".").filter(Boolean);
  let current = settingsCache;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return fallback;
    current = current[part];
  }
  return current;
}

async function setSetting(pathText, value) {
  const parts = String(pathText || "").split(".").filter(Boolean);
  if (!parts.length) throw new Error("Setting path is required.");
  const next = structuredClone(settingsCache);
  let current = next;
  for (let i = 0; i < parts.length - 1; i += 1) {
    current[parts[i]] = current[parts[i]] && typeof current[parts[i]] === "object"
      ? current[parts[i]] : {};
    current = current[parts[i]];
  }
  current[parts.at(-1)] = value;
  return saveAdminSettings(next);
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function isPlatformEnabled(platform) {
  return Boolean(platform) && settingsCache.platforms?.[platform] !== false;
}
function isClusterEnabled(clusterId) {
  return !clusterId || !settingsCache.clusters?.[clusterId] || settingsCache.clusters[clusterId].enabled !== false;
}
function getClusterIntervalMinutes(clusterId) {
  return settingsCache.clusters?.[clusterId]?.intervalMinutes || settingsCache.scraping.defaultIntervalMinutes || 15;
}
function getTtlMinutesForStatus(status) {
  if (settingsCache.cache.enabled === false) return 0;
  const value = String(status || "").toLowerCase();
  if (["success", "available_times_found"].includes(value)) return settingsCache.cache.successTtlMinutes;
  if (["no_times_found", "no_times_today", "next_available_found", "marketplace_business_found_no_times_yet"].includes(value)) return settingsCache.cache.noTimesFoundTtlMinutes;
  if (value === "fully_booked") return settingsCache.cache.fullyBookedTtlMinutes;
  if (value === "error" || value.includes("failed")) return settingsCache.cache.errorTtlMinutes;
  return settingsCache.cache.unknownTtlMinutes || settingsCache.cache.defaultTtlMinutes;
}
function shouldSkipVagaroDiscovery(filters = {}) {
  if (filters.skipVagaroDiscovery === true || filters.skipVagaroDiscovery === "true") return true;
  if (filters.skipVagaroDiscovery === false || filters.skipVagaroDiscovery === "false") return false;
  return settingsCache.scraping.skipVagaroDiscoveryByDefault === true;
}

async function runCli() {
  await initializeAdminSettings();
  const args = process.argv.slice(2);
  if (args.includes("--print")) return console.log(JSON.stringify(settingsCache, null, 2));
  const setArg = args.find((arg) => arg.startsWith("--set="));
  if (setArg) {
    const assignment = setArg.slice(6);
    const index = assignment.indexOf("=");
    if (index < 0) throw new Error("Use --set=path.to.setting=value");
    const updated = await setSetting(assignment.slice(0, index), parseValue(assignment.slice(index + 1)));
    console.log(JSON.stringify(updated, null, 2));
  }
}
if (require.main === module) runCli().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = {
  DEFAULT_ADMIN_SETTINGS,
  initializeAdminSettings,
  loadAdminSettings,
  saveAdminSettings,
  getSetting,
  setSetting,
  parseValue,
  isPlatformEnabled,
  isClusterEnabled,
  getClusterIntervalMinutes,
  getTtlMinutesForStatus,
  shouldSkipVagaroDiscovery,
  isInitialized: () => initialized
};