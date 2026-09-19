"use strict";

async function initializeSearchLocks() {
  return { source: "postgres", initialized: true };
}

function disabled() {
  throw new Error("Legacy file search locks are disabled. Use PostgreSQL scheduler locks.");
}

module.exports = {
  initializeSearchLocks,
  loadLocks: disabled,
  getActiveLock: disabled,
  isIntentLocked: disabled,
  createIntentLock: disabled,
  removeIntentLock: disabled,
  cleanupExpiredLocks: disabled,
  getLockStats: () => ({ source: "postgres", activeLocks: 0, locks: [] })
};