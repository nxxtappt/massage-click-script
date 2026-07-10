const db = require("../db");

async function getSettings(key = "global") {
  const result = await db.query(
    `SELECT settings_json FROM admin_runtime_settings WHERE settings_key = $1`,
    [key]
  );
  return result.rows[0]?.settings_json || null;
}

async function saveSettings(settings, key = "global") {
  const result = await db.query(
    `INSERT INTO admin_runtime_settings (settings_key, settings_json, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (settings_key) DO UPDATE
     SET settings_json = EXCLUDED.settings_json, updated_at = NOW()
     RETURNING settings_json`,
    [key, JSON.stringify(settings || {})]
  );
  return result.rows[0].settings_json;
}

async function loadCache() {
  const result = await db.query(
    `SELECT payload_json FROM appointment_cache WHERE expires_at > NOW() ORDER BY cached_at DESC`
  );
  return result.rows.map((row) => row.payload_json).filter(Boolean);
}

async function upsertCache(entry) {
  await db.query(
    `INSERT INTO appointment_cache (
      cache_key, business_name, platform, service_name, service_type,
      duration_minutes, status, payload_json, last_checked, cached_at, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
    ON CONFLICT (cache_key) DO UPDATE SET
      business_name = EXCLUDED.business_name,
      platform = EXCLUDED.platform,
      service_name = EXCLUDED.service_name,
      service_type = EXCLUDED.service_type,
      duration_minutes = EXCLUDED.duration_minutes,
      status = EXCLUDED.status,
      payload_json = EXCLUDED.payload_json,
      last_checked = EXCLUDED.last_checked,
      cached_at = EXCLUDED.cached_at,
      expires_at = EXCLUDED.expires_at`,
    [
      entry.cacheKey,
      entry.businessName,
      entry.platform,
      entry.serviceName,
      entry.serviceType,
      entry.durationMinutes,
      entry.status,
      JSON.stringify(entry),
      entry.lastChecked || null,
      entry.cachedAt,
      entry.expiresAt
    ]
  );
  return entry;
}

async function clearCache() {
  const result = await db.query(`DELETE FROM appointment_cache`);
  return result.rowCount;
}

async function cleanupExpiredCache() {
  const result = await db.query(`DELETE FROM appointment_cache WHERE expires_at <= NOW()`);
  return result.rowCount;
}

async function loadLocks() {
  await db.query(`DELETE FROM search_locks WHERE expires_at <= NOW()`);
  const result = await db.query(
    `SELECT intent_key, created_at, expires_at, metadata_json FROM search_locks ORDER BY created_at DESC`
  );
  return result.rows.map((row) => ({
    intentKey: row.intent_key,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at,
    metadata: row.metadata_json || {}
  }));
}

async function createLock(intentKey, expiresAt, metadata = {}) {
  const result = await db.query(
    `INSERT INTO search_locks (intent_key, expires_at, metadata_json)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (intent_key) DO NOTHING
     RETURNING intent_key, created_at, expires_at, metadata_json`,
    [intentKey, expiresAt, JSON.stringify(metadata)]
  );
  const row = result.rows[0];
  return row
    ? { intentKey: row.intent_key, createdAt: row.created_at, expiresAt: row.expires_at, metadata: row.metadata_json }
    : null;
}

async function removeLock(intentKey) {
  const result = await db.query(`DELETE FROM search_locks WHERE intent_key = $1`, [intentKey]);
  return result.rowCount > 0;
}

async function logScrapeError(entry = {}) {
  const result = await db.query(
    `INSERT INTO scrape_error_logs (
      business_name, platform, service_name, error_message, details_json
    ) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
    [
      entry.businessName || null,
      entry.platform || null,
      entry.serviceName || null,
      entry.error || entry.errorMessage || "Unknown scrape error",
      JSON.stringify(entry)
    ]
  );
  return result.rows[0];
}

async function getScrapeErrors(limit = 500) {
  const result = await db.query(
    `SELECT * FROM scrape_error_logs ORDER BY logged_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 500, 1), 5000)]
  );
  return result.rows;
}

async function saveEmailCapture(email, source) {
  const result = await db.query(
    `INSERT INTO email_captures (email, source)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source
     RETURNING *`,
    [email, source || "unknown"]
  );
  return result.rows[0];
}

module.exports = {
  getSettings,
  saveSettings,
  loadCache,
  upsertCache,
  clearCache,
  cleanupExpiredCache,
  loadLocks,
  createLock,
  removeLock,
  logScrapeError,
  getScrapeErrors,
  saveEmailCapture
};