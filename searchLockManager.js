const fs = require("fs");
const path = require("path");

const LOCKS_FILE = path.join(__dirname, "search-locks.json");

const DEFAULT_LOCK_MINUTES = 5;

function ensureLocksFileExists() {
  if (!fs.existsSync(LOCKS_FILE)) {
    fs.writeFileSync(
      LOCKS_FILE,
      JSON.stringify([], null, 2)
    );
  }
}

function loadLocks() {
  ensureLocksFileExists();

  try {
    const raw = fs.readFileSync(
      LOCKS_FILE,
      "utf8"
    );

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed
      : [];
  } catch (error) {
    console.error(
      "[LOCKS] Failed to load locks:",
      error.message
    );

    return [];
  }
}

function saveLocks(locks = []) {
  ensureLocksFileExists();

  fs.writeFileSync(
    LOCKS_FILE,
    JSON.stringify(locks, null, 2)
  );
}

function getExpirationDate(
  minutes = DEFAULT_LOCK_MINUTES
) {
  const date = new Date();

  date.setMinutes(
    date.getMinutes() + minutes
  );

  return date.toISOString();
}

function isExpired(lock) {
  if (!lock.expiresAt) {
    return true;
  }

  return (
    new Date(lock.expiresAt).getTime() <
    Date.now()
  );
}

function cleanupExpiredLocks() {
  const locks = loadLocks();

  const activeLocks = locks.filter(
    (lock) => !isExpired(lock)
  );

  saveLocks(activeLocks);

  return activeLocks;
}

function getActiveLock(intentKey) {
  const locks = cleanupExpiredLocks();

  return (
    locks.find(
      (lock) => lock.intentKey === intentKey
    ) || null
  );
}

function isIntentLocked(intentKey) {
  return Boolean(
    getActiveLock(intentKey)
  );
}

function createIntentLock(
  intentKey,
  options = {}
) {
  const {
    minutes = DEFAULT_LOCK_MINUTES,
    metadata = {}
  } = options;

  const locks = cleanupExpiredLocks();

  const existingLock = locks.find(
    (lock) => lock.intentKey === intentKey
  );

  if (existingLock) {
    return existingLock;
  }

  const newLock = {
    intentKey,

    createdAt: new Date().toISOString(),

    expiresAt: getExpirationDate(
      minutes
    ),

    metadata
  };

  locks.push(newLock);

  saveLocks(locks);

  console.log(
    `[LOCKS] Created lock for ${intentKey}`
  );

  return newLock;
}

function removeIntentLock(intentKey) {
  const locks = cleanupExpiredLocks();

  const filtered = locks.filter(
    (lock) => lock.intentKey !== intentKey
  );

  saveLocks(filtered);

  console.log(
    `[LOCKS] Removed lock for ${intentKey}`
  );
}

function getLockStats() {
  const locks = cleanupExpiredLocks();

  return {
    activeLocks: locks.length,
    locks
  };
}

module.exports = {
  loadLocks,
  getActiveLock,
  isIntentLocked,
  createIntentLock,
  removeIntentLock,
  cleanupExpiredLocks,
  getLockStats
};