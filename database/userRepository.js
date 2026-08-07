const db = require("../db");

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function ensurePreferences(userId) {
  await db.query(
    `INSERT INTO user_email_preferences (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function captureEmail({
  email,
  source = "unknown",
  productUpdatesEnabled = false
}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedSource = cleanText(source || "unknown", 120) || "unknown";

  const result = await db.query(
    `INSERT INTO users (
       email,
       source,
       last_source
     )
     VALUES ($1, $2, $2)
     ON CONFLICT (email)
     DO UPDATE SET
       last_source = EXCLUDED.last_source,
       updated_at = NOW()
     RETURNING
       id,
       email,
       status,
       email_verified AS "emailVerified",
       first_name AS "firstName",
       source,
       last_source AS "lastSource",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       last_login_at AS "lastLoginAt"`,
    [normalizedEmail, normalizedSource]
  );

  const user = result.rows[0];
  await ensurePreferences(user.id);

  if (productUpdatesEnabled) {
    await db.query(
      `UPDATE user_email_preferences
       SET
         product_updates_enabled = TRUE,
         product_updates_opted_in_at = COALESCE(product_updates_opted_in_at, NOW()),
         global_unsubscribed_at = NULL,
         updated_at = NOW()
       WHERE user_id = $1`,
      [user.id]
    );
  }

  return user;
}

async function getUserByEmail(email) {
  const result = await db.query(
    `SELECT
       id,
       email,
       status,
       email_verified AS "emailVerified",
       first_name AS "firstName",
       source,
       last_source AS "lastSource",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       last_login_at AS "lastLoginAt"
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [normalizeEmail(email)]
  );

  return result.rows[0] || null;
}

async function getUserById(userId) {
  const result = await db.query(
    `SELECT
       id,
       email,
       status,
       email_verified AS "emailVerified",
       first_name AS "firstName",
       source,
       last_source AS "lastSource",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       last_login_at AS "lastLoginAt"
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function getLoginCodeRateState(userId) {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE created_at >= NOW() - INTERVAL '1 hour'
       )::int AS "hourCount",
       MAX(created_at) AS "lastSentAt"
     FROM user_login_codes
     WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0] || { hourCount: 0, lastSentAt: null };
}

async function createLoginCode({ userId, codeHash, codeSalt, expiresAt }) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE user_login_codes
       SET used_at = COALESCE(used_at, NOW())
       WHERE user_id = $1
         AND used_at IS NULL`,
      [userId]
    );

    const result = await client.query(
      `INSERT INTO user_login_codes (
         user_id,
         code_hash,
         code_salt,
         expires_at
       )
       VALUES ($1, $2, $3, $4)
       RETURNING
         id,
         user_id AS "userId",
         expires_at AS "expiresAt",
         created_at AS "createdAt"`,
      [userId, codeHash, codeSalt, expiresAt]
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function invalidateLoginCode(loginCodeId) {
  await db.query(
    `UPDATE user_login_codes
     SET used_at = COALESCE(used_at, NOW())
     WHERE id = $1`,
    [loginCodeId]
  );
}

async function getActiveLoginCode(userId) {
  const result = await db.query(
    `SELECT
       id,
       user_id AS "userId",
       code_hash AS "codeHash",
       code_salt AS "codeSalt",
       attempt_count AS "attemptCount",
       expires_at AS "expiresAt",
       created_at AS "createdAt"
     FROM user_login_codes
     WHERE user_id = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function incrementLoginCodeAttempt(loginCodeId) {
  const result = await db.query(
    `UPDATE user_login_codes
     SET
       attempt_count = attempt_count + 1,
       used_at = CASE
         WHEN attempt_count + 1 >= 5 THEN NOW()
         ELSE used_at
       END
     WHERE id = $1
     RETURNING attempt_count AS "attemptCount", used_at AS "usedAt"`,
    [loginCodeId]
  );

  return result.rows[0] || null;
}

async function activateUserWithCode({ userId, loginCodeId }) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const codeResult = await client.query(
      `UPDATE user_login_codes
       SET used_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING id`,
      [loginCodeId, userId]
    );

    if (!codeResult.rows[0]) {
      throw new Error("Login code is no longer valid.");
    }

    const userResult = await client.query(
      `UPDATE users
       SET
         status = 'active',
         email_verified = TRUE,
         last_login_at = NOW(),
         updated_at = NOW()
       WHERE id = $1
         AND status <> 'disabled'
       RETURNING
         id,
         email,
         status,
         email_verified AS "emailVerified",
         first_name AS "firstName",
         source,
         last_source AS "lastSource",
         created_at AS "createdAt",
         updated_at AS "updatedAt",
         last_login_at AS "lastLoginAt"`,
      [userId]
    );

    if (!userResult.rows[0]) {
      throw new Error("This account is disabled.");
    }

    await client.query("COMMIT");
    return userResult.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createSession({ userId, tokenHash, expiresAt }) {
  const result = await db.query(
    `INSERT INTO user_sessions (
       user_id,
       token_hash,
       expires_at
     )
     VALUES ($1, $2, $3)
     RETURNING
       id,
       user_id AS "userId",
       expires_at AS "expiresAt",
       created_at AS "createdAt"`,
    [userId, tokenHash, expiresAt]
  );

  return result.rows[0];
}

async function getUserBySessionTokenHash(tokenHash) {
  const result = await db.query(
    `SELECT
       u.id,
       u.email,
       u.status,
       u.email_verified AS "emailVerified",
       u.first_name AS "firstName",
       u.source,
       u.last_source AS "lastSource",
       u.created_at AS "createdAt",
       u.updated_at AS "updatedAt",
       u.last_login_at AS "lastLoginAt",
       s.id AS "sessionId",
       s.expires_at AS "sessionExpiresAt"
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND u.status = 'active'
     LIMIT 1`,
    [tokenHash]
  );

  const user = result.rows[0] || null;

  if (user?.sessionId) {
    await db.query(
      `UPDATE user_sessions
       SET last_seen_at = NOW()
       WHERE id = $1`,
      [user.sessionId]
    );
  }

  return user;
}

async function deleteSessionByTokenHash(tokenHash) {
  await db.query(
    `DELETE FROM user_sessions
     WHERE token_hash = $1`,
    [tokenHash]
  );
}

async function getPreferences(userId) {
  await ensurePreferences(userId);

  const result = await db.query(
    `SELECT
       appointment_alerts_enabled AS "appointmentAlertsEnabled",
       product_updates_enabled AS "productUpdatesEnabled",
       marketing_enabled AS "marketingEnabled",
       global_unsubscribed_at AS "globalUnsubscribedAt",
       updated_at AS "updatedAt"
     FROM user_email_preferences
     WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function updatePreferences(userId, preferences = {}) {
  await ensurePreferences(userId);

  const current = await getPreferences(userId);
  const nextAppointmentAlerts =
    typeof preferences.appointmentAlertsEnabled === "boolean"
      ? preferences.appointmentAlertsEnabled
      : current.appointmentAlertsEnabled;
  const nextProductUpdates =
    typeof preferences.productUpdatesEnabled === "boolean"
      ? preferences.productUpdatesEnabled
      : current.productUpdatesEnabled;
  const nextMarketing =
    typeof preferences.marketingEnabled === "boolean"
      ? preferences.marketingEnabled
      : current.marketingEnabled;

  const result = await db.query(
    `UPDATE user_email_preferences
     SET
       appointment_alerts_enabled = $2,
       product_updates_enabled = $3,
       marketing_enabled = $4,
       product_updates_opted_in_at = CASE
         WHEN $3 = TRUE THEN COALESCE(product_updates_opted_in_at, NOW())
         ELSE product_updates_opted_in_at
       END,
       marketing_opted_in_at = CASE
         WHEN $4 = TRUE THEN COALESCE(marketing_opted_in_at, NOW())
         ELSE marketing_opted_in_at
       END,
       global_unsubscribed_at = CASE
         WHEN $2 = TRUE OR $3 = TRUE OR $4 = TRUE THEN NULL
         ELSE global_unsubscribed_at
       END,
       updated_at = NOW()
     WHERE user_id = $1
     RETURNING
       appointment_alerts_enabled AS "appointmentAlertsEnabled",
       product_updates_enabled AS "productUpdatesEnabled",
       marketing_enabled AS "marketingEnabled",
       global_unsubscribed_at AS "globalUnsubscribedAt",
       updated_at AS "updatedAt"`,
    [userId, nextAppointmentAlerts, nextProductUpdates, nextMarketing]
  );

  return result.rows[0];
}

async function updateProfile(userId, profile = {}) {
  const firstName = cleanText(profile.firstName, 120) || null;

  const result = await db.query(
    `UPDATE users
     SET
       first_name = $2,
       updated_at = NOW()
     WHERE id = $1
     RETURNING
       id,
       email,
       status,
       email_verified AS "emailVerified",
       first_name AS "firstName",
       source,
       last_source AS "lastSource",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       last_login_at AS "lastLoginAt"`,
    [userId, firstName]
  );

  return result.rows[0] || null;
}

async function listAlertsForUser(userId) {
  const result = await db.query(
    `SELECT
       id,
       label,
       status,
       metro,
       category_slug AS "categorySlug",
       service_type AS "serviceType",
       duration_minutes AS "durationMinutes",
       business_id AS "businessId",
       provider_name AS "providerName",
       target_date AS "targetDate",
       target_date_end AS "targetDateEnd",
       start_time AS "startTime",
       end_time AS "endTime",
       radius_miles AS "radiusMiles",
       latitude,
       longitude,
       filters_json AS filters,
       last_checked_at AS "lastCheckedAt",
       last_notified_at AS "lastNotifiedAt",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM appointment_alerts
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return result.rows;
}

async function createAlert(userId, alert = {}) {
  const status = alert.status === "paused" ? "paused" : "active";
  const filters =
    alert.filters && typeof alert.filters === "object" && !Array.isArray(alert.filters)
      ? alert.filters
      : {};

  const result = await db.query(
    `INSERT INTO appointment_alerts (
       user_id,
       label,
       status,
       metro,
       category_slug,
       service_type,
       duration_minutes,
       business_id,
       provider_name,
       target_date,
       target_date_end,
       start_time,
       end_time,
       radius_miles,
       latitude,
       longitude,
       filters_json
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16, $17::jsonb
     )
     RETURNING id`,
    [
      userId,
      cleanText(alert.label, 180) || null,
      status,
      cleanText(alert.metro, 120) || null,
      cleanText(alert.categorySlug, 120) || null,
      cleanText(alert.serviceType, 180) || null,
      alert.durationMinutes ? Number(alert.durationMinutes) : null,
      alert.businessId ? Number(alert.businessId) : null,
      cleanText(alert.providerName, 180) || null,
      alert.targetDate || null,
      alert.targetDateEnd || null,
      alert.startTime || null,
      alert.endTime || null,
      alert.radiusMiles ? Number(alert.radiusMiles) : null,
      alert.latitude ? Number(alert.latitude) : null,
      alert.longitude ? Number(alert.longitude) : null,
      JSON.stringify(filters)
    ]
  );

  await db.query(
    `UPDATE user_email_preferences
     SET
       appointment_alerts_enabled = TRUE,
       global_unsubscribed_at = NULL,
       updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );

  const alerts = await listAlertsForUser(userId);
  return alerts.find((item) => String(item.id) === String(result.rows[0].id)) || null;
}

async function setAlertStatus(userId, alertId, status) {
  const nextStatus = status === "paused" ? "paused" : "active";

  const result = await db.query(
    `UPDATE appointment_alerts
     SET
       status = $3,
       updated_at = NOW()
     WHERE id = $2
       AND user_id = $1
     RETURNING id`,
    [userId, alertId, nextStatus]
  );

  return Boolean(result.rows[0]);
}

async function deleteAlert(userId, alertId) {
  const result = await db.query(
    `DELETE FROM appointment_alerts
     WHERE id = $2
       AND user_id = $1
     RETURNING id`,
    [userId, alertId]
  );

  return Boolean(result.rows[0]);
}

async function listUsers({
  search = "",
  status = "",
  verified = "",
  page = 1,
  limit = 25
} = {}) {
  const safePage = clampInteger(page, 1, 1, 100000);
  const safeLimit = clampInteger(limit, 25, 1, 100);
  const offset = (safePage - 1) * safeLimit;
  const searchText = cleanText(search, 240);
  const statusText = ["lead", "active", "disabled"].includes(status) ? status : "";
  const verifiedText = verified === "true" || verified === "false" ? verified : "";

  const where = `
    WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR COALESCE(u.first_name, '') ILIKE '%' || $1 || '%')
      AND ($2 = '' OR u.status = $2)
      AND (
        $3 = '' OR
        ($3 = 'true' AND u.email_verified = TRUE) OR
        ($3 = 'false' AND u.email_verified = FALSE)
      )
  `;

  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM users u
     ${where}`,
    [searchText, statusText, verifiedText]
  );

  const rowsResult = await db.query(
    `SELECT
       u.id,
       u.email,
       u.status,
       u.email_verified AS "emailVerified",
       u.first_name AS "firstName",
       u.source,
       u.last_source AS "lastSource",
       u.created_at AS "createdAt",
       u.last_login_at AS "lastLoginAt",
       COALESCE(p.appointment_alerts_enabled, FALSE) AS "appointmentAlertsEnabled",
       COALESCE(p.product_updates_enabled, FALSE) AS "productUpdatesEnabled",
       COALESCE(p.marketing_enabled, FALSE) AS "marketingEnabled",
       COUNT(a.id) FILTER (WHERE a.status = 'active')::int AS "activeAlertCount"
     FROM users u
     LEFT JOIN user_email_preferences p ON p.user_id = u.id
     LEFT JOIN appointment_alerts a ON a.user_id = u.id
     ${where}
     GROUP BY u.id, p.user_id
     ORDER BY u.created_at DESC
     LIMIT $4 OFFSET $5`,
    [searchText, statusText, verifiedText, safeLimit, offset]
  );

  const total = countResult.rows[0]?.total || 0;

  return {
    users: rowsResult.rows,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit))
  };
}

async function getUserStats() {
  const result = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'lead')::int AS leads,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active,
       COUNT(*) FILTER (WHERE status = 'disabled')::int AS disabled,
       COUNT(*) FILTER (WHERE email_verified = TRUE)::int AS verified
     FROM users`
  );

  const alertResult = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS "activeAlerts"
     FROM appointment_alerts`
  );

  return {
    ...(result.rows[0] || {}),
    activeAlerts: alertResult.rows[0]?.activeAlerts || 0
  };
}

async function getAdminUserDetail(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const [preferences, alerts] = await Promise.all([
    getPreferences(userId),
    listAlertsForUser(userId)
  ]);

  return { user, preferences, alerts };
}

async function setUserStatus(userId, status) {
  const nextStatus = ["lead", "active", "disabled"].includes(status)
    ? status
    : null;

  if (!nextStatus) {
    throw new Error("Invalid user status.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `UPDATE users
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING
         id,
         email,
         status,
         email_verified AS "emailVerified"`,
      [userId, nextStatus]
    );

    if (nextStatus === "disabled") {
      await client.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1`,
        [userId]
      );
    }

    await client.query("COMMIT");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  normalizeEmail,
  captureEmail,
  getUserByEmail,
  getUserById,
  getLoginCodeRateState,
  createLoginCode,
  invalidateLoginCode,
  getActiveLoginCode,
  incrementLoginCodeAttempt,
  activateUserWithCode,
  createSession,
  getUserBySessionTokenHash,
  deleteSessionByTokenHash,
  getPreferences,
  updatePreferences,
  updateProfile,
  listAlertsForUser,
  createAlert,
  setAlertStatus,
  deleteAlert,
  listUsers,
  getUserStats,
  getAdminUserDetail,
  setUserStatus
};