const db = require("../db");

const MATCHER_LOCK_KEY = 91724017;

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}


async function getDeliverySettings() {
  const result = await db.query(
    `SELECT
       emails_enabled AS "emailsEnabled",
       max_appointments_per_email AS "maxAppointmentsPerEmail",
       max_emails_per_alert_per_hour AS "maxEmailsPerAlertPerHour",
       max_emails_per_alert_per_day AS "maxEmailsPerAlertPerDay",
       minimum_minutes_between_emails AS "minimumMinutesBetweenEmails",
       updated_at AS "updatedAt"
     FROM user_alert_delivery_settings
     WHERE id = 1
     LIMIT 1`
  );

  if (!result.rows[0]) {
    throw new Error(
      "User alert delivery settings are missing. Run migration 014_user_alert_delivery_controls.sql."
    );
  }

  return result.rows[0];
}

async function updateDeliverySettings(settings = {}) {
  const current = await getDeliverySettings();

  function integerSetting(value, fallback, min, max) {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const parsed = Number.parseInt(value, 10);

    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new Error(`Setting must be between ${min} and ${max}.`);
    }

    return parsed;
  }

  const emailsEnabled =
    typeof settings.emailsEnabled === "boolean"
      ? settings.emailsEnabled
      : current.emailsEnabled;

  const maxAppointmentsPerEmail = integerSetting(
    settings.maxAppointmentsPerEmail,
    current.maxAppointmentsPerEmail,
    1,
    20
  );

  const maxEmailsPerAlertPerHour = integerSetting(
    settings.maxEmailsPerAlertPerHour,
    current.maxEmailsPerAlertPerHour,
    0,
    20
  );

  const maxEmailsPerAlertPerDay = integerSetting(
    settings.maxEmailsPerAlertPerDay,
    current.maxEmailsPerAlertPerDay,
    0,
    100
  );

  const minimumMinutesBetweenEmails = integerSetting(
    settings.minimumMinutesBetweenEmails,
    current.minimumMinutesBetweenEmails,
    0,
    1440
  );

  const result = await db.query(
    `UPDATE user_alert_delivery_settings
     SET
       emails_enabled = $1,
       max_appointments_per_email = $2,
       max_emails_per_alert_per_hour = $3,
       max_emails_per_alert_per_day = $4,
       minimum_minutes_between_emails = $5,
       updated_at = NOW()
     WHERE id = 1
     RETURNING
       emails_enabled AS "emailsEnabled",
       max_appointments_per_email AS "maxAppointmentsPerEmail",
       max_emails_per_alert_per_hour AS "maxEmailsPerAlertPerHour",
       max_emails_per_alert_per_day AS "maxEmailsPerAlertPerDay",
       minimum_minutes_between_emails AS "minimumMinutesBetweenEmails",
       updated_at AS "updatedAt"`,
    [
      emailsEnabled,
      maxAppointmentsPerEmail,
      maxEmailsPerAlertPerHour,
      maxEmailsPerAlertPerDay,
      minimumMinutesBetweenEmails
    ]
  );

  return result.rows[0];
}

async function getAlertDeliveryState(alertId) {
  const result = await db.query(
    `SELECT
       MAX(sent_at) FILTER (
         WHERE status = 'sent'
       ) AS "lastSentAt",
       COUNT(*) FILTER (
         WHERE status = 'sent'
           AND sent_at >= NOW() - INTERVAL '1 hour'
       )::int AS "sentLastHour",
       COUNT(*) FILTER (
         WHERE status = 'sent'
           AND sent_at >= NOW() - INTERVAL '24 hours'
       )::int AS "sentLast24Hours"
     FROM appointment_alert_notifications
     WHERE alert_id = $1`,
    [alertId]
  );

  return result.rows[0] || {
    lastSentAt: null,
    sentLastHour: 0,
    sentLast24Hours: 0
  };
}

function evaluateDeliveryLimit(settings, state) {
  if (!settings.emailsEnabled) {
    return {
      allowed: false,
      reason: "global_email_kill_switch"
    };
  }

  if (
    Number(settings.maxEmailsPerAlertPerHour) === 0 ||
    Number(state.sentLastHour || 0) >=
      Number(settings.maxEmailsPerAlertPerHour)
  ) {
    return {
      allowed: false,
      reason: "hourly_alert_email_limit"
    };
  }

  if (
    Number(settings.maxEmailsPerAlertPerDay) === 0 ||
    Number(state.sentLast24Hours || 0) >=
      Number(settings.maxEmailsPerAlertPerDay)
  ) {
    return {
      allowed: false,
      reason: "daily_alert_email_limit"
    };
  }

  if (
    state.lastSentAt &&
    Number(settings.minimumMinutesBetweenEmails) > 0
  ) {
    const elapsedMinutes =
      (Date.now() - new Date(state.lastSentAt).getTime()) / 60000;

    if (
      elapsedMinutes <
      Number(settings.minimumMinutesBetweenEmails)
    ) {
      return {
        allowed: false,
        reason: "alert_email_cooldown"
      };
    }
  }

  return {
    allowed: true,
    reason: null
  };
}

async function acquireMatcherLock() {
  const client = await db.connect();

  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [MATCHER_LOCK_KEY]
    );

    if (!result.rows[0]?.locked) {
      client.release();
      return null;
    }

    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseMatcherLock(client) {
  if (!client) return;

  try {
    await client.query(
      "SELECT pg_advisory_unlock($1)",
      [MATCHER_LOCK_KEY]
    );
  } finally {
    client.release();
  }
}

async function listActiveAlertsForMatching({ limit = 250, alertId = null } = {}) {
  const safeLimit = clampInteger(limit, 250, 1, 1000);
  const normalizedAlertId = alertId ? String(alertId).trim() : "";

  const result = await db.query(
    `SELECT
       a.id,
       a.user_id AS "userId",
       a.label,
       a.status,
       a.metro,
       a.category_slug AS "categorySlug",
       a.service_type AS "serviceType",
       a.duration_minutes AS "durationMinutes",
       a.business_id AS "businessId",
       b.business_name AS "businessName",
       a.provider_name AS "providerName",
       a.target_date AS "targetDate",
       a.target_date_end AS "targetDateEnd",
       a.start_time AS "startTime",
       a.end_time AS "endTime",
       a.radius_miles AS "radiusMiles",
       a.latitude,
       a.longitude,
       a.filters_json AS filters,
       a.last_checked_at AS "lastCheckedAt",
       a.last_notified_at AS "lastNotifiedAt",
       a.last_match_count AS "lastMatchCount",
       a.last_error AS "lastError",
       u.email,
       u.first_name AS "firstName"
     FROM appointment_alerts a
     JOIN users u
       ON u.id = a.user_id
     JOIN user_email_preferences p
       ON p.user_id = u.id
     LEFT JOIN businesses b
       ON b.id = a.business_id
     WHERE a.status = 'active'
       AND u.status = 'active'
       AND u.email_verified = TRUE
       AND p.appointment_alerts_enabled = TRUE
       AND p.global_unsubscribed_at IS NULL
       AND ($1 = '' OR a.id::text = $1)
     ORDER BY a.last_checked_at ASC NULLS FIRST, a.created_at ASC
     LIMIT $2`,
    [normalizedAlertId, safeLimit]
  );

  return result.rows;
}

async function markAlertExpired(alertId) {
  const result = await db.query(
    `UPDATE appointment_alerts
     SET
       status = 'expired',
       last_checked_at = NOW(),
       last_match_count = 0,
       last_error = NULL,
       updated_at = NOW()
     WHERE id = $1
       AND status = 'active'
     RETURNING id`,
    [alertId]
  );

  return Boolean(result.rows[0]);
}

async function markAlertChecked(
  alertId,
  { matchCount = 0, notified = false, error = null } = {}
) {
  const result = await db.query(
    `UPDATE appointment_alerts
     SET
       last_checked_at = NOW(),
       last_match_count = $2,
       last_notified_at = CASE
         WHEN $3 = TRUE THEN NOW()
         ELSE last_notified_at
       END,
       last_error = $4,
       updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [
      alertId,
      Number(matchCount || 0),
      notified === true,
      error ? String(error?.message || error).slice(0, 4000) : null
    ]
  );

  return Boolean(result.rows[0]);
}

async function reserveNotification({ alert, appointment, appointmentKey }) {
  const confidence = Number(appointment.confidence);

  const result = await db.query(
    `INSERT INTO appointment_alert_notifications (
       alert_id,
       user_id,
       appointment_key,
       inventory_id,
       business_name,
       service_name,
       service_category,
       category_slug,
       duration_minutes,
       provider_name,
       booking_url,
       appointment_start,
       appointment_end,
       local_date,
       local_time,
       timezone,
       source_type,
       confidence
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16, $17, $18
     )
     ON CONFLICT (alert_id, appointment_key)
     DO UPDATE SET
       inventory_id = EXCLUDED.inventory_id,
       booking_url = EXCLUDED.booking_url,
       status = 'pending',
       attempt_count = appointment_alert_notifications.attempt_count + 1,
       last_error = NULL,
       updated_at = NOW()
     WHERE (
       appointment_alert_notifications.status = 'failed'
       AND appointment_alert_notifications.updated_at < NOW() - INTERVAL '10 minutes'
     ) OR (
       appointment_alert_notifications.status = 'pending'
       AND appointment_alert_notifications.updated_at < NOW() - INTERVAL '30 minutes'
     )
     RETURNING
       id,
       alert_id AS "alertId",
       appointment_key AS "appointmentKey",
       attempt_count AS "attemptCount"`,
    [
      alert.id,
      alert.userId,
      appointmentKey,
      appointment.id || null,
      appointment.businessName || "Unknown Business",
      appointment.serviceName || appointment.service || null,
      appointment.serviceCategory || appointment.serviceType || null,
      appointment.categorySlug || null,
      appointment.durationMinutes || null,
      appointment.providerName || appointment.therapistName || null,
      appointment.bookingUrl || null,
      appointment.appointmentStart || appointment.startTime || null,
      appointment.appointmentEnd || appointment.endTime || null,
      appointment.localDateKey || appointment.localDate || null,
      appointment.localTimeKey || appointment.localTime || null,
      appointment.timezone || null,
      appointment.sourceType || null,
      Number.isFinite(confidence) ? confidence : null
    ]
  );

  return result.rows[0] || null;
}

async function markNotificationsSent(notificationIds = [], emailMessageId = null) {
  const ids = notificationIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return 0;

  const result = await db.query(
    `UPDATE appointment_alert_notifications
     SET
       status = 'sent',
       email_message_id = $2,
       last_error = NULL,
       sent_at = NOW(),
       updated_at = NOW()
     WHERE id = ANY($1::bigint[])
     RETURNING id`,
    [ids, emailMessageId || null]
  );

  return result.rows.length;
}

async function markNotificationsFailed(notificationIds = [], error) {
  const ids = notificationIds.map(Number).filter(Number.isFinite);
  if (!ids.length) return 0;

  const result = await db.query(
    `UPDATE appointment_alert_notifications
     SET
       status = 'failed',
       last_error = $2,
       updated_at = NOW()
     WHERE id = ANY($1::bigint[])
     RETURNING id`,
    [
      ids,
      String(error?.message || error || "Notification failed").slice(0, 4000)
    ]
  );

  return result.rows.length;
}

async function getNotificationActivity({ limit = 30 } = {}) {
  const safeLimit = clampInteger(limit, 30, 1, 100);

  const [statsResult, recentResult] = await Promise.all([
    db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (
           WHERE status = 'sent'
             AND sent_at >= NOW() - INTERVAL '24 hours'
         )::int AS "sentLast24Hours"
       FROM appointment_alert_notifications`
    ),
    db.query(
      `SELECT
         n.id,
         n.alert_id AS "alertId",
         n.business_name AS "businessName",
         n.service_name AS "serviceName",
         n.duration_minutes AS "durationMinutes",
         n.local_date AS "localDate",
         n.local_time AS "localTime",
         n.source_type AS "sourceType",
         n.status,
         n.attempt_count AS "attemptCount",
         n.last_error AS "lastError",
         n.sent_at AS "sentAt",
         n.created_at AS "createdAt",
         u.email
       FROM appointment_alert_notifications n
       JOIN users u ON u.id = n.user_id
       ORDER BY n.created_at DESC
       LIMIT $1`,
      [safeLimit]
    )
  ]);

  return {
    stats: statsResult.rows[0] || {
      pending: 0,
      sent: 0,
      failed: 0,
      sentLast24Hours: 0
    },
    recent: recentResult.rows
  };
}

module.exports = {
  getDeliverySettings,
  updateDeliverySettings,
  getAlertDeliveryState,
  evaluateDeliveryLimit,
  acquireMatcherLock,
  releaseMatcherLock,
  listActiveAlertsForMatching,
  markAlertExpired,
  markAlertChecked,
  reserveNotification,
  markNotificationsSent,
  markNotificationsFailed,
  getNotificationActivity
};