"use strict";

const db = require("../db");

async function query(text, params = []) {
  if (typeof db.query !== "function") throw new Error("Database query function is unavailable.");
  return db.query(text, params);
}

async function listGroups() {
  const { rows } = await query(`SELECT g.*, COALESCE(json_agg(json_build_object('businessId', b.business_id, 'businessName', b.business_name)) FILTER (WHERE b.id IS NOT NULL), '[]') AS businesses FROM scrape_groups g LEFT JOIN scrape_group_businesses gb ON gb.group_id = g.id LEFT JOIN businesses b ON b.id = gb.business_id GROUP BY g.id ORDER BY g.name`);
  return rows;
}

async function getGroup(id) {
  const { rows } = await query(`SELECT * FROM scrape_groups WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function saveGroup(payload = {}) {
  const { rows } = await query(`INSERT INTO scrape_groups (id, name, description, enabled, selector, updated_at) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, enabled=EXCLUDED.enabled, selector=EXCLUDED.selector, updated_at=NOW() RETURNING *`, [payload.id || null, payload.name, payload.description || "", payload.enabled !== false, JSON.stringify(payload.selector || {})]);
  const group = rows[0];
  if (Array.isArray(payload.businessIds)) {
    await query(`DELETE FROM scrape_group_businesses WHERE group_id = $1`, [group.id]);
    for (const businessId of payload.businessIds) {
      await query(`INSERT INTO scrape_group_businesses (group_id, business_id) SELECT $1, id FROM businesses WHERE business_id = $2 OR id::text = $2 ON CONFLICT DO NOTHING`, [group.id, String(businessId)]);
    }
  }
  return getGroup(group.id);
}

async function deleteGroup(id) {
  await query(`DELETE FROM scrape_groups WHERE id = $1`, [id]);
}

async function listSchedules() {
  const { rows } = await query(`SELECT s.*, g.name AS group_name FROM scrape_schedules s LEFT JOIN scrape_groups g ON g.id = s.group_id ORDER BY s.name`);
  return rows;
}

async function getSchedule(id) {
  const { rows } = await query(`SELECT * FROM scrape_schedules WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function saveSchedule(payload = {}) {
  const { rows } = await query(`INSERT INTO scrape_schedules (id, name, enabled, timezone, group_id, business_id, calendar_rules, scrape_options, next_run_at, updated_at) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5::uuid, (SELECT id FROM businesses WHERE business_id = $6 OR id::text = $6 LIMIT 1), $7::jsonb, $8::jsonb, $9, NOW()) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, enabled=EXCLUDED.enabled, timezone=EXCLUDED.timezone, group_id=EXCLUDED.group_id, business_id=EXCLUDED.business_id, calendar_rules=EXCLUDED.calendar_rules, scrape_options=EXCLUDED.scrape_options, next_run_at=EXCLUDED.next_run_at, updated_at=NOW() RETURNING *`, [payload.id || null, payload.name, payload.enabled !== false, payload.timezone || "America/Chicago", payload.groupId || null, payload.businessId || null, JSON.stringify(payload.calendarRules || {}), JSON.stringify(payload.scrapeOptions || {}), payload.nextRunAt || null]);
  return rows[0];
}

async function deleteSchedule(id) {
  await query(`DELETE FROM scrape_schedules WHERE id = $1`, [id]);
}

async function listExceptions(scheduleId = null) {
  const params = [];
  const where = scheduleId ? "WHERE schedule_id = $1" : "";
  if (scheduleId) params.push(scheduleId);
  const { rows } = await query(`SELECT * FROM scrape_schedule_exceptions ${where} ORDER BY exception_date DESC`, params);
  return rows;
}

async function saveException(payload = {}) {
  const { rows } = await query(`INSERT INTO scrape_schedule_exceptions (id, schedule_id, exception_date, action, override_time, reason, payload) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (schedule_id, exception_date) DO UPDATE SET action=EXCLUDED.action, override_time=EXCLUDED.override_time, reason=EXCLUDED.reason, payload=EXCLUDED.payload RETURNING *`, [payload.id || null, payload.scheduleId, payload.exceptionDate, payload.action || "skip", payload.overrideTime || null, payload.reason || "", JSON.stringify(payload.payload || {})]);
  return rows[0];
}

async function deleteException(id) {
  await query(`DELETE FROM scrape_schedule_exceptions WHERE id = $1`, [id]);
}

async function getDueSchedules(now = new Date()) {
  const { rows } = await query(`SELECT * FROM scrape_schedules WHERE enabled = TRUE AND (next_run_at IS NULL OR next_run_at <= $1) ORDER BY next_run_at NULLS FIRST`, [now.toISOString()]);
  return rows;
}

async function resolveScheduleBusinesses(schedule) {
  const params = [schedule.id];
  const { rows } = await query(`SELECT DISTINCT b.* FROM scrape_schedules s JOIN businesses b ON (s.business_id = b.id) OR EXISTS (SELECT 1 FROM scrape_group_businesses gb WHERE gb.group_id = s.group_id AND gb.business_id = b.id) WHERE s.id = $1 AND b.enabled = TRUE`, params);
  return rows;
}

async function acquireScheduleLock(scheduleId, occurrenceKey, ttlMinutes = 60) {
  const { rows } = await query(`INSERT INTO scrape_schedule_locks (schedule_id, occurrence_key, locked_until) VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval) ON CONFLICT (schedule_id, occurrence_key) DO UPDATE SET locked_until = EXCLUDED.locked_until WHERE scrape_schedule_locks.locked_until < NOW() RETURNING *`, [scheduleId, occurrenceKey, String(ttlMinutes)]);
  return rows[0] || null;
}

async function releaseScheduleLock(scheduleId, occurrenceKey) {
  await query(`DELETE FROM scrape_schedule_locks WHERE schedule_id=$1 AND occurrence_key=$2`, [scheduleId, occurrenceKey]);
}

async function createHistory(payload = {}) {
  const { rows } = await query(`INSERT INTO scrape_schedule_history (schedule_id, occurrence_key, status, businesses_selected, jobs_built, jobs_rejected, started_at, details) VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7::jsonb) ON CONFLICT (schedule_id, occurrence_key) DO UPDATE SET status=EXCLUDED.status, businesses_selected=EXCLUDED.businesses_selected, jobs_built=EXCLUDED.jobs_built, jobs_rejected=EXCLUDED.jobs_rejected, details=EXCLUDED.details RETURNING *`, [payload.scheduleId, payload.occurrenceKey, payload.status || "started", payload.businessesSelected || 0, payload.jobsBuilt || 0, payload.jobsRejected || 0, JSON.stringify(payload.details || {})]);
  return rows[0];
}

async function finishHistory(id, payload = {}) {
  const { rows } = await query(`UPDATE scrape_schedule_history SET status=$2, finished_at=NOW(), details=COALESCE(details,'{}'::jsonb) || $3::jsonb WHERE id=$1 RETURNING *`, [id, payload.status || "success", JSON.stringify(payload.details || {})]);
  return rows[0] || null;
}

async function listHistory(limit = 100) {
  const { rows } = await query(`SELECT h.*, s.name AS schedule_name FROM scrape_schedule_history h LEFT JOIN scrape_schedules s ON s.id=h.schedule_id ORDER BY h.started_at DESC LIMIT $1`, [Math.min(500, Number(limit) || 100)]);
  return rows;
}

async function getHealth() {
  const { rows } = await query(`SELECT (SELECT COUNT(*) FROM scrape_schedules WHERE enabled) AS enabled_schedules, (SELECT COUNT(*) FROM scrape_groups WHERE enabled) AS enabled_groups, (SELECT COUNT(*) FROM scrape_schedule_locks WHERE locked_until > NOW()) AS active_locks, (SELECT COUNT(*) FROM scrape_schedule_history WHERE status='error' AND started_at > NOW()-INTERVAL '24 hours') AS errors_24h, (SELECT MAX(finished_at) FROM scrape_schedule_history WHERE status='success') AS last_success_at`);
  return rows[0] || {};
}

async function updateNextRun(scheduleId, nextRunAt) {
  await query(`UPDATE scrape_schedules SET next_run_at=$2, last_evaluated_at=NOW() WHERE id=$1`, [scheduleId, nextRunAt]);
}

module.exports = { listGroups, getGroup, saveGroup, deleteGroup, listSchedules, getSchedule, saveSchedule, deleteSchedule, listExceptions, saveException, deleteException, getDueSchedules, resolveScheduleBusinesses, acquireScheduleLock, releaseScheduleLock, createHistory, finishHistory, listHistory, getHealth, updateNextRun };