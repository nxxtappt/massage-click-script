"use strict";

const db = require("../db");

function cleanText(value, maxLength = 500) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanStringArray(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [...new Set(source.map((item) => cleanText(item, 200)).filter(Boolean))];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function query(text, params = []) {
  if (typeof db.query !== "function") {
    throw new Error("Database query function is unavailable.");
  }
  return db.query(text, params);
}

async function listGroups() {
  const { rows } = await query(`
    SELECT
      g.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', b.id,
            'businessId', b.business_id,
            'businessName', b.business_name,
            'platform', b.platform
          )
          ORDER BY b.business_name
        ) FILTER (WHERE b.id IS NOT NULL),
        '[]'::json
      ) AS businesses
    FROM scrape_groups g
    LEFT JOIN scrape_group_businesses gb ON gb.group_id = g.id
    LEFT JOIN businesses b ON b.id = gb.business_id
    GROUP BY g.id
    ORDER BY g.name
  `);
  return rows;
}

async function getGroup(id) {
  const { rows } = await query(`
    SELECT
      g.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', b.id,
            'businessId', b.business_id,
            'businessName', b.business_name,
            'platform', b.platform
          )
          ORDER BY b.business_name
        ) FILTER (WHERE b.id IS NOT NULL),
        '[]'::json
      ) AS businesses
    FROM scrape_groups g
    LEFT JOIN scrape_group_businesses gb ON gb.group_id = g.id
    LEFT JOIN businesses b ON b.id = gb.business_id
    WHERE g.id = $1
    GROUP BY g.id
    LIMIT 1
  `, [id]);
  return rows[0] || null;
}

async function saveGroup(payload = {}) {
  const name = cleanText(payload.name, 200);
  if (!name) throw new Error("Group name is required.");

  const selector = isPlainObject(payload.selector) ? payload.selector : {};
  const businessIds = cleanStringArray(payload.businessIds);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(`
      INSERT INTO scrape_groups (
        id, name, description, enabled, selector, updated_at
      ) VALUES (
        COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb, NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        enabled = EXCLUDED.enabled,
        selector = EXCLUDED.selector,
        updated_at = NOW()
      RETURNING *
    `, [
      payload.id || null,
      name,
      cleanText(payload.description, 2000),
      payload.enabled !== false,
      JSON.stringify(selector)
    ]);

    const group = rows[0];

    if (Array.isArray(payload.businessIds)) {
      await client.query(
        `DELETE FROM scrape_group_businesses WHERE group_id = $1`,
        [group.id]
      );

      if (businessIds.length) {
        await client.query(`
          INSERT INTO scrape_group_businesses (group_id, business_id)
          SELECT $1, b.id
          FROM businesses b
          WHERE b.business_id = ANY($2::text[])
             OR b.id::text = ANY($2::text[])
          ON CONFLICT DO NOTHING
        `, [group.id, businessIds]);
      }
    }

    await client.query("COMMIT");
    return getGroup(group.id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function deleteGroup(id) {
  await query(`DELETE FROM scrape_groups WHERE id = $1`, [id]);
}

async function listSchedules() {
  const { rows } = await query(`
    SELECT
      s.*,
      g.name AS group_name,
      b.business_id AS public_business_id,
      b.business_name
    FROM scrape_schedules s
    LEFT JOIN scrape_groups g ON g.id = s.group_id
    LEFT JOIN businesses b ON b.id = s.business_id
    ORDER BY s.name
  `);
  return rows;
}

async function getSchedule(id) {
  const { rows } = await query(`
    SELECT
      s.*,
      g.name AS group_name,
      g.selector AS group_selector,
      g.enabled AS group_enabled,
      b.business_id AS public_business_id,
      b.business_name
    FROM scrape_schedules s
    LEFT JOIN scrape_groups g ON g.id = s.group_id
    LEFT JOIN businesses b ON b.id = s.business_id
    WHERE s.id = $1
    LIMIT 1
  `, [id]);
  return rows[0] || null;
}

async function validateScheduleTarget(groupId, businessId) {
  if (groupId && businessId) {
    throw new Error("Choose either a group or a business, not both.");
  }
  if (!groupId && !businessId) {
    throw new Error("A schedule must target a group or a business.");
  }

  if (groupId) {
    const { rows } = await query(
      `SELECT id FROM scrape_groups WHERE id = $1 LIMIT 1`,
      [groupId]
    );
    if (!rows[0]) throw new Error("Scrape group not found.");
    return { groupId, databaseBusinessId: null };
  }

  const { rows } = await query(`
    SELECT id
    FROM businesses
    WHERE business_id = $1 OR id::text = $1
    LIMIT 1
  `, [String(businessId)]);

  if (!rows[0]) throw new Error("Business target not found.");
  return { groupId: null, databaseBusinessId: rows[0].id };
}

async function saveSchedule(payload = {}) {
  const name = cleanText(payload.name, 200);
  if (!name) throw new Error("Schedule name is required.");

  const target = await validateScheduleTarget(
    payload.groupId || null,
    payload.businessId || null
  );

  const calendarRules = isPlainObject(payload.calendarRules)
    ? payload.calendarRules
    : {};
  const scrapeOptions = isPlainObject(payload.scrapeOptions)
    ? payload.scrapeOptions
    : {};

  const { rows } = await query(`
    INSERT INTO scrape_schedules (
      id,
      name,
      enabled,
      timezone,
      group_id,
      business_id,
      calendar_rules,
      scrape_options,
      next_run_at,
      updated_at
    ) VALUES (
      COALESCE($1::uuid, gen_random_uuid()),
      $2,
      $3,
      $4,
      $5,
      $6,
      $7::jsonb,
      $8::jsonb,
      $9,
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      name = EXCLUDED.name,
      enabled = EXCLUDED.enabled,
      timezone = EXCLUDED.timezone,
      group_id = EXCLUDED.group_id,
      business_id = EXCLUDED.business_id,
      calendar_rules = EXCLUDED.calendar_rules,
      scrape_options = EXCLUDED.scrape_options,
      next_run_at = EXCLUDED.next_run_at,
      updated_at = NOW()
    RETURNING *
  `, [
    payload.id || null,
    name,
    payload.enabled !== false,
    cleanText(payload.timezone || "America/Chicago", 100),
    target.groupId,
    target.databaseBusinessId,
    JSON.stringify(calendarRules),
    JSON.stringify(scrapeOptions),
    payload.nextRunAt || null
  ]);

  return getSchedule(rows[0].id);
}

async function deleteSchedule(id) {
  await query(`DELETE FROM scrape_schedules WHERE id = $1`, [id]);
}

async function listExceptions(scheduleId = null) {
  const params = [];
  const where = scheduleId ? "WHERE schedule_id = $1" : "";
  if (scheduleId) params.push(scheduleId);

  const { rows } = await query(`
    SELECT *
    FROM scrape_schedule_exceptions
    ${where}
    ORDER BY exception_date DESC
  `, params);
  return rows;
}

async function getException(id) {
  const { rows } = await query(
    `SELECT * FROM scrape_schedule_exceptions WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function saveException(payload = {}) {
  if (!payload.scheduleId) throw new Error("scheduleId is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.exceptionDate || ""))) {
    throw new Error("exceptionDate must use YYYY-MM-DD format.");
  }

  const action = ["skip", "run", "override"].includes(payload.action)
    ? payload.action
    : "skip";

  const { rows } = await query(`
    INSERT INTO scrape_schedule_exceptions (
      id,
      schedule_id,
      exception_date,
      action,
      override_time,
      reason,
      payload
    ) VALUES (
      COALESCE($1::uuid, gen_random_uuid()),
      $2,
      $3,
      $4,
      $5,
      $6,
      $7::jsonb
    )
    ON CONFLICT (schedule_id, exception_date)
    DO UPDATE SET
      action = EXCLUDED.action,
      override_time = EXCLUDED.override_time,
      reason = EXCLUDED.reason,
      payload = EXCLUDED.payload
    RETURNING *
  `, [
    payload.id || null,
    payload.scheduleId,
    payload.exceptionDate,
    action,
    payload.overrideTime || null,
    cleanText(payload.reason, 1000),
    JSON.stringify(payload.payload || {})
  ]);
  return rows[0];
}

async function deleteException(id) {
  const { rows } = await query(
    `DELETE FROM scrape_schedule_exceptions WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

async function getDueSchedules(now = new Date()) {
  const { rows } = await query(`
    SELECT
      s.*,
      g.name AS group_name,
      g.selector AS group_selector,
      g.enabled AS group_enabled,
      b.business_id AS public_business_id,
      b.business_name
    FROM scrape_schedules s
    LEFT JOIN scrape_groups g ON g.id = s.group_id
    LEFT JOIN businesses b ON b.id = s.business_id
    WHERE s.enabled = TRUE
      AND (s.next_run_at IS NULL OR s.next_run_at <= $1)
    ORDER BY s.next_run_at NULLS FIRST, s.created_at
  `, [now.toISOString()]);
  return rows;
}

async function listEnabledSchedules() {
  const { rows } = await query(`
    SELECT
      s.*,
      g.name AS group_name,
      g.selector AS group_selector,
      g.enabled AS group_enabled,
      b.business_id AS public_business_id,
      b.business_name
    FROM scrape_schedules s
    LEFT JOIN scrape_groups g ON g.id = s.group_id
    LEFT JOIN businesses b ON b.id = s.business_id
    WHERE s.enabled = TRUE
    ORDER BY s.name
  `);
  return rows;
}

async function queryBusinessesBySelector(selector = {}) {
  if (!isPlainObject(selector) || Object.keys(selector).length === 0) {
    return [];
  }

  const values = [];
  const conditions = ["b.enabled = TRUE"];

  function addArrayCondition(sqlExpression, value) {
    const items = cleanStringArray(value).map((item) => item.toLowerCase());
    if (!items.length) return;
    values.push(items);
    conditions.push(`${sqlExpression} = ANY($${values.length}::text[])`);
  }

  const businessIds = cleanStringArray(selector.businessIds);
  if (businessIds.length) {
    values.push(businessIds);
    conditions.push(`(b.business_id = ANY($${values.length}::text[]) OR b.id::text = ANY($${values.length}::text[]))`);
  }

  addArrayCondition("LOWER(COALESCE(b.platform, ''))", selector.platforms || selector.platform);
  addArrayCondition(
    "LOWER(COALESCE(b.business_category, ''))",
    selector.businessCategories || selector.industries || selector.industry
  );
  addArrayCondition("LOWER(COALESCE(b.priority, ''))", selector.priorities || selector.priority);
  addArrayCondition(
    "LOWER(COALESCE(b.discovery_status, ''))",
    selector.discoveryStatuses || selector.discoveryStatus
  );
  addArrayCondition("LOWER(COALESCE(l.state, ''))", selector.states || selector.state);

  const metros = cleanStringArray(selector.metros || selector.metro || selector.cities || selector.city)
    .map((item) => item.toLowerCase());
  if (metros.length) {
    values.push(metros);
    conditions.push(`(
      LOWER(COALESCE(l.city, '')) = ANY($${values.length}::text[])
      OR LOWER(COALESCE(b.raw_json->>'metro', '')) = ANY($${values.length}::text[])
    )`);
  }

  const nameContains = cleanText(selector.nameContains || selector.businessName, 200);
  if (nameContains) {
    values.push(`%${nameContains}%`);
    conditions.push(`b.business_name ILIKE $${values.length}`);
  }

  const recognizedSelector =
    conditions.length > 1 ||
    businessIds.length > 0;

  if (!recognizedSelector) return [];

  const limit = Math.min(5000, Math.max(1, Number(selector.limit || 5000)));
  values.push(limit);

  const { rows } = await query(`
    SELECT DISTINCT
      b.id,
      b.business_id,
      b.business_name,
      b.platform,
      b.business_category,
      b.priority,
      b.discovery_status,
      l.city,
      l.state,
      l.timezone
    FROM businesses b
    LEFT JOIN LATERAL (
      SELECT city, state, timezone
      FROM business_locations
      WHERE business_id = b.id
      ORDER BY id
      LIMIT 1
    ) l ON TRUE
    WHERE ${conditions.join(" AND ")}
    ORDER BY b.business_name
    LIMIT $${values.length}
  `, values);

  return rows;
}

async function resolveScheduleBusinesses(scheduleOrId) {
  const schedule = typeof scheduleOrId === "object" && scheduleOrId
    ? scheduleOrId
    : await getSchedule(scheduleOrId);

  if (!schedule) return [];

  const businessMap = new Map();

  if (schedule.business_id) {
    const { rows } = await query(`
      SELECT
        b.id,
        b.business_id,
        b.business_name,
        b.platform,
        b.business_category,
        b.priority,
        b.discovery_status,
        l.city,
        l.state,
        l.timezone
      FROM businesses b
      LEFT JOIN LATERAL (
        SELECT city, state, timezone
        FROM business_locations
        WHERE business_id = b.id
        ORDER BY id
        LIMIT 1
      ) l ON TRUE
      WHERE b.id = $1 AND b.enabled = TRUE
    `, [schedule.business_id]);
    rows.forEach((row) => businessMap.set(String(row.id), row));
  }

  if (schedule.group_id && schedule.group_enabled !== false) {
    const explicit = await query(`
      SELECT
        b.id,
        b.business_id,
        b.business_name,
        b.platform,
        b.business_category,
        b.priority,
        b.discovery_status,
        l.city,
        l.state,
        l.timezone
      FROM scrape_group_businesses gb
      JOIN businesses b ON b.id = gb.business_id
      LEFT JOIN LATERAL (
        SELECT city, state, timezone
        FROM business_locations
        WHERE business_id = b.id
        ORDER BY id
        LIMIT 1
      ) l ON TRUE
      WHERE gb.group_id = $1 AND b.enabled = TRUE
    `, [schedule.group_id]);

    explicit.rows.forEach((row) => businessMap.set(String(row.id), row));

    const selector = schedule.group_selector || {};
    const dynamic = await queryBusinessesBySelector(selector);
    dynamic.forEach((row) => businessMap.set(String(row.id), row));
  }

  return [...businessMap.values()].sort((a, b) =>
    String(a.business_name || "").localeCompare(String(b.business_name || ""))
  );
}

async function acquireScheduleLock(scheduleId, occurrenceKey, ttlMinutes = 120) {
  const ttl = Math.min(1440, Math.max(5, Number(ttlMinutes) || 120));
  const { rows } = await query(`
    INSERT INTO scrape_schedule_locks (
      schedule_id, occurrence_key, locked_until
    ) VALUES (
      $1, $2, NOW() + ($3 || ' minutes')::interval
    )
    ON CONFLICT (schedule_id, occurrence_key)
    DO UPDATE SET locked_until = EXCLUDED.locked_until
      WHERE scrape_schedule_locks.locked_until < NOW()
    RETURNING *
  `, [scheduleId, occurrenceKey, String(ttl)]);
  return rows[0] || null;
}

async function releaseScheduleLock(scheduleId, occurrenceKey) {
  await query(`
    DELETE FROM scrape_schedule_locks
    WHERE schedule_id = $1 AND occurrence_key = $2
  `, [scheduleId, occurrenceKey]);
}

async function createHistory(payload = {}) {
  const { rows } = await query(`
    INSERT INTO scrape_schedule_history (
      schedule_id,
      occurrence_key,
      status,
      businesses_selected,
      jobs_built,
      jobs_rejected,
      started_at,
      queued_at,
      details,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, NOW(), NOW(), $7::jsonb, NOW()
    )
    ON CONFLICT (schedule_id, occurrence_key)
    DO UPDATE SET
      status = EXCLUDED.status,
      businesses_selected = EXCLUDED.businesses_selected,
      jobs_built = EXCLUDED.jobs_built,
      jobs_rejected = EXCLUDED.jobs_rejected,
      queued_at = NOW(),
      details = COALESCE(scrape_schedule_history.details, '{}'::jsonb) || EXCLUDED.details,
      updated_at = NOW()
    RETURNING *
  `, [
    payload.scheduleId,
    payload.occurrenceKey,
    payload.status || "queued",
    Number(payload.businessesSelected || 0),
    Number(payload.jobsBuilt || 0),
    Number(payload.jobsRejected || 0),
    JSON.stringify(payload.details || {})
  ]);
  return rows[0];
}

async function updateHistory(id, payload = {}) {
  const { rows } = await query(`
    UPDATE scrape_schedule_history
    SET status = COALESCE($2, status),
        businesses_selected = COALESCE($3, businesses_selected),
        jobs_built = COALESCE($4, jobs_built),
        jobs_rejected = COALESCE($5, jobs_rejected),
        finished_at = CASE WHEN $6 THEN COALESCE(finished_at, NOW()) ELSE finished_at END,
        details = COALESCE(details, '{}'::jsonb) || $7::jsonb,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [
    id,
    payload.status || null,
    payload.businessesSelected ?? null,
    payload.jobsBuilt ?? null,
    payload.jobsRejected ?? null,
    payload.finished === true,
    JSON.stringify(payload.details || {})
  ]);
  return rows[0] || null;
}

async function finishHistory(id, payload = {}) {
  return updateHistory(id, { ...payload, finished: true });
}

async function listHistory(limit = 100) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const { rows } = await query(`
    SELECT h.*, s.name AS schedule_name
    FROM scrape_schedule_history h
    LEFT JOIN scrape_schedules s ON s.id = h.schedule_id
    ORDER BY h.started_at DESC
    LIMIT $1
  `, [safeLimit]);
  return rows;
}

async function getHealth() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM scrape_schedules WHERE enabled)::int AS enabled_schedules,
      (SELECT COUNT(*) FROM scrape_groups WHERE enabled)::int AS enabled_groups,
      (SELECT COUNT(*) FROM scrape_schedule_locks WHERE locked_until > NOW())::int AS active_locks,
      (SELECT COUNT(*) FROM scrape_schedule_history WHERE status IN ('error', 'partial_error') AND started_at > NOW() - INTERVAL '24 hours')::int AS errors_24h,
      (SELECT MAX(finished_at) FROM scrape_schedule_history WHERE status = 'success') AS last_success_at,
      (SELECT MIN(next_run_at) FROM scrape_schedules WHERE enabled) AS next_run_at
  `);
  return rows[0] || {};
}

async function updateNextRun(scheduleId, nextRunAt) {
  const { rows } = await query(`
    UPDATE scrape_schedules
    SET next_run_at = $2,
        last_evaluated_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [scheduleId, nextRunAt]);
  return rows[0] || null;
}

async function markScheduleEnqueued(scheduleId, occurrenceDate) {
  const { rows } = await query(`
    UPDATE scrape_schedules
    SET last_enqueued_at = $2,
        last_error = NULL,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [scheduleId, occurrenceDate]);
  return rows[0] || null;
}

async function markScheduleError(scheduleId, errorMessage) {
  await query(`
    UPDATE scrape_schedules
    SET last_error = $2,
        consecutive_failures = consecutive_failures + 1,
        updated_at = NOW()
    WHERE id = $1
  `, [scheduleId, cleanText(errorMessage, 10000)]);
}

module.exports = {
  listGroups,
  getGroup,
  saveGroup,
  deleteGroup,
  listSchedules,
  getSchedule,
  saveSchedule,
  deleteSchedule,
  listExceptions,
  getException,
  saveException,
  deleteException,
  getDueSchedules,
  listEnabledSchedules,
  resolveScheduleBusinesses,
  acquireScheduleLock,
  releaseScheduleLock,
  createHistory,
  updateHistory,
  finishHistory,
  listHistory,
  getHealth,
  updateNextRun,
  markScheduleEnqueued,
  markScheduleError,
  queryBusinessesBySelector
};