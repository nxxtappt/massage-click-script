"use strict";

const db = require("./db");

const DEFAULT_SETTINGS = Object.freeze({
  searchEnabled: true,
  scraping: {
    enabled: true,
    onDemandEnabled: false,
    scheduledScrapingEnabled: true,
    skipFreshCache: false,
    defaultIntervalMinutes: 15,
    defaultLookaheadHours: 48,
    maxServicesPerBusiness: 25
  },
  platforms: {},
  serviceRules: {
    scheduledPriorities: ["high"],
    scheduledDiscoveryStatuses: ["approved"],
    onDemandPriorities: ["high", "medium", "normal"],
    onDemandDiscoveryStatuses: ["approved", "manual"],
    manualPriorities: ["high", "medium", "normal", "low"],
    manualDiscoveryStatuses: ["approved", "manual", "test", "pending"],
    allowServicesWithoutPriority: true,
    allowServicesWithoutDiscoveryStatus: true
  },
  cache: {
    successTtlMinutes: 0,
    emptyTtlMinutes: 0,
    errorTtlMinutes: 0
  },
  clusters: {},
  safety: {}
});

let settingsCache = structuredClone(DEFAULT_SETTINGS);
let initialized = false;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeSettings(base, incoming) {
  const output = { ...base };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (isPlainObject(value) && isPlainObject(base?.[key])) {
      output[key] = mergeSettings(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function ensureSettingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      settings_key TEXT PRIMARY KEY,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function initializeAdminSettings() {
  await ensureSettingsTable();
  const existing = await db.query(
    `SELECT settings FROM app_settings WHERE settings_key = 'admin' LIMIT 1`
  );
  const merged = mergeSettings(DEFAULT_SETTINGS, existing.rows[0]?.settings || {});
  const { rows } = await db.query(
    `INSERT INTO app_settings (settings_key, settings, updated_at)
     VALUES ('admin', $1::jsonb, NOW())
     ON CONFLICT (settings_key)
     DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
     RETURNING settings`,
    [JSON.stringify(merged)]
  );
  settingsCache = mergeSettings(DEFAULT_SETTINGS, rows[0]?.settings || {});
  initialized = true;
  return loadAdminSettings();
}

function loadAdminSettings() {
  return structuredClone(settingsCache);
}

async function saveAdminSettings(nextSettings = {}) {
  if (!initialized) await initializeAdminSettings();
  const merged = mergeSettings(DEFAULT_SETTINGS, nextSettings);
  const { rows } = await db.query(
    `INSERT INTO app_settings (settings_key, settings, updated_at)
     VALUES ('admin', $1::jsonb, NOW())
     ON CONFLICT (settings_key)
     DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()
     RETURNING settings`,
    [JSON.stringify(merged)]
  );
  settingsCache = mergeSettings(DEFAULT_SETTINGS, rows[0]?.settings || {});
  return loadAdminSettings();
}

async function updateAdminSettings(patch = {}) {
  return saveAdminSettings(mergeSettings(settingsCache, patch));
}

function isPlatformEnabled(platform) {
  const key = String(platform || "").trim().toLowerCase();
  const configured = settingsCache.platforms?.[key];
  if (configured === false) return false;
  if (isPlainObject(configured) && configured.enabled === false) return false;
  return true;
}

function getTtlMinutesForStatus() {
  return 0;
}

module.exports = {
  DEFAULT_SETTINGS,
  initializeAdminSettings,
  loadAdminSettings,
  saveAdminSettings,
  updateAdminSettings,
  getAdminSettings: loadAdminSettings,
  setAdminSettings: saveAdminSettings,
  saveSettings: saveAdminSettings,
  updateSettings: updateAdminSettings,
  isPlatformEnabled,
  getTtlMinutesForStatus
};