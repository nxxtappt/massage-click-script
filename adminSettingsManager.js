const fs = require("fs");
const path = require("path");

const ADMIN_SETTINGS_FILE = path.join(__dirname, "admin-settings.json");

const DEFAULT_ADMIN_SETTINGS = {
  scraping: {
    enabled: true,
    onDemandEnabled: true,
    scheduledScrapingEnabled: true,
    skipFreshCache: true,
    maxConcurrentScrapes: 1,
    defaultIntervalMinutes: 15,
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
    onDemandPriorities: ["high", "medium", "normal"],
    onDemandDiscoveryStatuses: ["approved", "manual"],
    manualPriorities: ["high", "medium", "normal", "low"],
    manualDiscoveryStatuses: ["approved", "manual", "test", "pending"],
    maxServicesPerBusinessPerScheduledRun: 2,
    maxServicesPerBusinessPerOnDemandRun: 4,
    allowServicesWithoutPriority: false,
    allowServicesWithoutDiscoveryStatus: false
  },

  clusters: {
    "austin-central": {
      enabled: true,
      intervalMinutes: 15
    }
  },

  platforms: {
    mindbody: true,
    "mindbody-old": true,
    schedulista: true,
    meevo: true,
    axl3: true,
    booker: true,
    zenoti: true,
    vagaro: false
  },

  onDemand: {
    enabled: true,
    requireGeoFilter: false,
    maxJobsPerSearch: 10,
    ttlMinutes: 10
  },

  safety: {
    stopOnRepeatedErrors: false,
    maxErrorsPerRun: 20,
    logVerbose: true
  }
};

function deepMerge(base, override) {
  const output = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function ensureAdminSettingsFile() {
  if (!fs.existsSync(ADMIN_SETTINGS_FILE)) {
    fs.writeFileSync(
      ADMIN_SETTINGS_FILE,
      JSON.stringify(DEFAULT_ADMIN_SETTINGS, null, 2)
    );
  }
}

function loadAdminSettings() {
  ensureAdminSettingsFile();

  try {
    const parsed = JSON.parse(fs.readFileSync(ADMIN_SETTINGS_FILE, "utf8"));
    return deepMerge(DEFAULT_ADMIN_SETTINGS, parsed);
  } catch (error) {
    console.error("[ADMIN SETTINGS] Failed to load settings:", error.message);
    return DEFAULT_ADMIN_SETTINGS;
  }
}

function saveAdminSettings(settings) {
  const merged = deepMerge(DEFAULT_ADMIN_SETTINGS, settings || {});

  fs.writeFileSync(
    ADMIN_SETTINGS_FILE,
    JSON.stringify(merged, null, 2)
  );

  return merged;
}

function getSetting(pathText, fallback = undefined) {
  const settings = loadAdminSettings();

  const parts = String(pathText || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  let current = settings;

  for (const part of parts) {
    if (
      current &&
      typeof current === "object" &&
      Object.prototype.hasOwnProperty.call(current, part)
    ) {
      current = current[part];
    } else {
      return fallback;
    }
  }

  return current;
}

function setSetting(pathText, value) {
  const settings = loadAdminSettings();

  const parts = String(pathText || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    throw new Error("Setting path is required.");
  }

  let current = settings;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    if (
      !current[part] ||
      typeof current[part] !== "object" ||
      Array.isArray(current[part])
    ) {
      current[part] = {};
    }

    current = current[part];
  }

  current[parts[parts.length - 1]] = value;

  return saveAdminSettings(settings);
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;

  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }

  return value;
}

function isPlatformEnabled(platform) {
  const settings = loadAdminSettings();

  if (!platform) return false;

  return settings.platforms?.[platform] !== false;
}

function isClusterEnabled(clusterId) {
  const settings = loadAdminSettings();

  if (!clusterId) return true;

  if (!settings.clusters?.[clusterId]) {
    return true;
  }

  return settings.clusters[clusterId].enabled !== false;
}

function getClusterIntervalMinutes(clusterId) {
  const settings = loadAdminSettings();

  return (
    settings.clusters?.[clusterId]?.intervalMinutes ||
    settings.scraping.defaultIntervalMinutes ||
    15
  );
}

function getTtlMinutesForStatus(status) {
  const settings = loadAdminSettings();

  if (settings.cache.enabled === false) {
    return 0;
  }

  const normalizedStatus = String(status || "").toLowerCase();

  if (
    normalizedStatus === "success" ||
    normalizedStatus === "available_times_found"
  ) {
    return settings.cache.successTtlMinutes;
  }

  if (
    normalizedStatus === "no_times_found" ||
    normalizedStatus === "no_times_today" ||
    normalizedStatus === "next_available_found" ||
    normalizedStatus === "marketplace_business_found_no_times_yet"
  ) {
    return settings.cache.noTimesFoundTtlMinutes;
  }

  if (normalizedStatus === "fully_booked") {
    return settings.cache.fullyBookedTtlMinutes;
  }

  if (
    normalizedStatus === "error" ||
    normalizedStatus.includes("failed")
  ) {
    return settings.cache.errorTtlMinutes;
  }

  return settings.cache.unknownTtlMinutes || settings.cache.defaultTtlMinutes;
}

function shouldSkipVagaroDiscovery(filters = {}) {
  const settings = loadAdminSettings();

  if (
    filters.skipVagaroDiscovery === true ||
    filters.skipVagaroDiscovery === "true"
  ) {
    return true;
  }

  if (
    filters.skipVagaroDiscovery === false ||
    filters.skipVagaroDiscovery === "false"
  ) {
    return false;
  }

  return settings.scraping.skipVagaroDiscoveryByDefault === true;
}

function printAdminSettings() {
  const settings = loadAdminSettings();

  console.log("\n===== ADMIN SETTINGS =====");
  console.log(JSON.stringify(settings, null, 2));
}

function runCli() {
  const args = process.argv.slice(2);

  if (args.includes("--print")) {
    printAdminSettings();
    return;
  }

  const setArg = args.find((arg) => arg.startsWith("--set="));

  if (setArg) {
    const assignment = setArg.replace("--set=", "");
    const equalsIndex = assignment.indexOf("=");

    if (equalsIndex === -1) {
      throw new Error("Use --set=path.to.setting=value");
    }

    const settingPath = assignment.slice(0, equalsIndex);
    const rawValue = assignment.slice(equalsIndex + 1);
    const value = parseValue(rawValue);

    const updated = setSetting(settingPath, value);

    console.log("\n===== UPDATED ADMIN SETTINGS =====");
    console.log(JSON.stringify(updated, null, 2));
    return;
  }

  console.log("Usage:");
  console.log("node adminSettingsManager.js --print");
  console.log("node adminSettingsManager.js --set=scraping.enabled=false");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_ADMIN_SETTINGS,
  loadAdminSettings,
  saveAdminSettings,
  getSetting,
  setSetting,
  parseValue,
  isPlatformEnabled,
  isClusterEnabled,
  getClusterIntervalMinutes,
  getTtlMinutesForStatus,
  shouldSkipVagaroDiscovery
};