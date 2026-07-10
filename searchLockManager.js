const runtimeStateRepository = require("./database/runtimeStateRepository");
const DEFAULT_LOCK_MINUTES = 5;
let locks = [];

async function initializeSearchLocks() { locks = await runtimeStateRepository.loadLocks(); return locks; }
function cleanupExpiredLocks() { locks = locks.filter((lock) => new Date(lock.expiresAt).getTime() > Date.now()); return locks; }
function loadLocks() { return cleanupExpiredLocks(); }
function getActiveLock(intentKey) { return loadLocks().find((lock) => lock.intentKey === intentKey) || null; }
function isIntentLocked(intentKey) { return Boolean(getActiveLock(intentKey)); }
async function createIntentLock(intentKey, options = {}) {
  const existing = getActiveLock(intentKey);
  if (existing) return existing;
  const expiresAt = new Date(Date.now() + Number(options.minutes || DEFAULT_LOCK_MINUTES) * 60000).toISOString();
  const created = await runtimeStateRepository.createLock(intentKey, expiresAt, options.metadata || {});
  if (created) locks.push(created);
  return created || getActiveLock(intentKey);
}
async function removeIntentLock(intentKey) {
  locks = locks.filter((lock) => lock.intentKey !== intentKey);
  return runtimeStateRepository.removeLock(intentKey);
}
function getLockStats() { const active = loadLocks(); return { activeLocks: active.length, locks: active, source: "postgres" }; }
module.exports = { initializeSearchLocks, loadLocks, getActiveLock, isIntentLocked, createIntentLock, removeIntentLock, cleanupExpiredLocks, getLockStats };