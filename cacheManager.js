"use strict";

async function initializeAppointmentCache() {
  return { source: "postgres", initialized: true };
}

function unsupported() {
  throw new Error("File appointment cache is disabled. Use inventoryManager/PostgreSQL.");
}

function getCacheStats() {
  return { source: "postgres", active: 0, expired: 0, total: 0 };
}

module.exports = {
  initializeAppointmentCache,
  loadAppointmentCache: unsupported,
  saveAppointmentCache: unsupported,
  upsertAppointmentResult: unsupported,
  getCachedAppointments: unsupported,
  clearAppointmentCache: unsupported,
  findCacheEntryForTarget: unsupported,
  analyzeTargetsForCache: unsupported,
  getCacheStats
};