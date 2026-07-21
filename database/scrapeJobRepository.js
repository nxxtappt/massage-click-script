"use strict";

const db = require("../db");

const ALLOWED_SCRIPTS = new Set(["scrape.js"]);
const JOB_STATUSES = new Set([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled"
]);

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) {
    throw new Error("Scrape job args must be an array.");
  }

  return args
    .slice(0, 100)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .map((value) => value.slice(0, 2000));
}

function normalizeScriptName(value) {
  const scriptName = String(value || "scrape.js").trim();
  if (!ALLOWED_SCRIPTS.has(scriptName)) {
    throw new Error(`Unsupported scrape job script: ${scriptName}`);
  }
  return scriptName;
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return JOB_STATUSES.has(status) ? status : "";
}

async function enqueueJob(payload = {}) {
  const scriptName = normalizeScriptName(payload.scriptName);
  const args = normalizeArgs(payload.args || []);
  const priority = clampInteger(payload.priority, 100, 0, 1000);
  const maxAttempts = clampInteger(payload.maxAttempts, 3, 1, 10);
  const timeoutSeconds = clampInteger(payload.timeoutSeconds, 1800, 60, 14400);
  const dedupeKey = String(payload.dedupeKey || "").trim() || null;
  const availableAt = payload.availableAt || new Date().toISOString();

  try {
    const { rows } = await db.query(
      `INSERT INTO scrape_jobs (
         source,
         priority,
         script_name,
         args,
         request_payload,
         schedule_id,
         schedule_history_id,
         occurrence_key,
         dedupe_key,
         requested_by,
         available_at,
         max_attempts,
         timeout_seconds,
         updated_at
       ) VALUES (
         $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
       )
       RETURNING *`,
      [
        String(payload.source || "admin").slice(0, 80),
        priority,
        scriptName,
        JSON.stringify(args),
        JSON.stringify(payload.requestPayload || {}),
        payload.scheduleId || null,
        payload.scheduleHistoryId || null,
        payload.occurrenceKey || null,
        dedupeKey,
        String(payload.requestedBy || "").slice(0, 200) || null,
        availableAt,
        maxAttempts,
        timeoutSeconds
      ]
    );

    return { ...rows[0], alreadyExisted: false };
  } catch (error) {
    if (error.code !== "23505" || !dedupeKey) throw error;

    const existing = await db.query(
      `SELECT * FROM scrape_jobs WHERE dedupe_key = $1 LIMIT 1`,
      [dedupeKey]
    );

    if (!existing.rows[0]) throw error;
    return { ...existing.rows[0], alreadyExisted: true };
  }
}

async function getJob(id) {
  const { rows } = await db.query(
    `SELECT j.*, h.occurrence_key AS history_occurrence_key,
            s.name AS schedule_name
       FROM scrape_jobs j
       LEFT JOIN scrape_schedule_history h ON h.id = j.schedule_history_id
       LEFT JOIN scrape_schedules s ON s.id = j.schedule_id
      WHERE j.id = $1
      LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function listJobs(options = {}) {
  const values = [];
  const where = [];

  const status = normalizeStatus(options.status);
  if (status) {
    values.push(status);
    where.push(`j.status = $${values.length}`);
  }

  if (options.source) {
    values.push(String(options.source));
    where.push(`j.source = $${values.length}`);
  }

  if (options.scheduleId) {
    values.push(options.scheduleId);
    where.push(`j.schedule_id = $${values.length}`);
  }

  const limit = clampInteger(options.limit, 100, 1, 500);
  values.push(limit);

  const { rows } = await db.query(
    `SELECT j.*, s.name AS schedule_name
       FROM scrape_jobs j
       LEFT JOIN scrape_schedules s ON s.id = j.schedule_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY j.created_at DESC
      LIMIT $${values.length}`,
    values
  );

  return rows;
}

async function registerWorker(workerId, metadata = {}) {
  const { rows } = await db.query(
    `INSERT INTO scrape_workers (
       worker_id, status, started_at, last_heartbeat_at, metadata, updated_at
     ) VALUES ($1, 'idle', NOW(), NOW(), $2::jsonb, NOW())
     ON CONFLICT (worker_id)
     DO UPDATE SET
       status = 'idle',
       current_job_id = NULL,
       started_at = NOW(),
       last_heartbeat_at = NOW(),
       stopped_at = NULL,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [workerId, JSON.stringify(metadata || {})]
  );
  return rows[0];
}

async function heartbeatWorker(workerId, currentJobId = null, metadata = null) {
  const values = [workerId, currentJobId];
  let metadataSql = "metadata";

  if (metadata) {
    values.push(JSON.stringify(metadata));
    metadataSql = `metadata || $${values.length}::jsonb`;
  }

  const { rows } = await db.query(
    `UPDATE scrape_workers
        SET status = CASE WHEN $2::uuid IS NULL THEN 'idle' ELSE 'running' END,
            current_job_id = $2,
            last_heartbeat_at = NOW(),
            metadata = ${metadataSql},
            updated_at = NOW()
      WHERE worker_id = $1
      RETURNING *`,
    values
  );

  if (currentJobId) {
    await db.query(
      `UPDATE scrape_jobs
          SET heartbeat_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND worker_id = $2 AND status = 'running'`,
      [currentJobId, workerId]
    );
  }

  return rows[0] || null;
}

async function markWorkerStopped(workerId) {
  await db.query(
    `UPDATE scrape_workers
        SET status = 'offline',
            current_job_id = NULL,
            stopped_at = NOW(),
            last_heartbeat_at = NOW(),
            updated_at = NOW()
      WHERE worker_id = $1`,
    [workerId]
  );
}

async function claimNextJob(workerId) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const selected = await client.query(
      `SELECT *
         FROM scrape_jobs
        WHERE status = 'queued'
          AND available_at <= NOW()
          AND cancel_requested = FALSE
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );

    const job = selected.rows[0];

    if (!job) {
      await client.query(
        `UPDATE scrape_workers
            SET status = 'idle', current_job_id = NULL,
                last_heartbeat_at = NOW(), updated_at = NOW()
          WHERE worker_id = $1`,
        [workerId]
      );
      await client.query("COMMIT");
      return null;
    }

    const claimed = await client.query(
      `UPDATE scrape_jobs
          SET status = 'running',
              worker_id = $2,
              claimed_at = NOW(),
              started_at = NOW(),
              heartbeat_at = NOW(),
              finished_at = NULL,
              attempt_count = attempt_count + 1,
              exit_code = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [job.id, workerId]
    );

    await client.query(
      `INSERT INTO scrape_workers (
         worker_id, status, current_job_id, started_at,
         last_heartbeat_at, metadata, updated_at
       ) VALUES ($1, 'running', $2, NOW(), NOW(), '{}'::jsonb, NOW())
       ON CONFLICT (worker_id)
       DO UPDATE SET
         status = 'running',
         current_job_id = EXCLUDED.current_job_id,
         last_heartbeat_at = NOW(),
         stopped_at = NULL,
         updated_at = NOW()`,
      [workerId, job.id]
    );

    await client.query("COMMIT");
    return claimed.rows[0] || null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function refreshScheduleHistory(scheduleHistoryId) {
  if (!scheduleHistoryId) return null;

  const summary = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
       COUNT(*) FILTER (WHERE status = 'running')::int AS running,
       COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       MAX(error_message) FILTER (WHERE error_message IS NOT NULL) AS last_error
     FROM scrape_jobs
     WHERE schedule_history_id = $1`,
    [scheduleHistoryId]
  );

  const counts = summary.rows[0] || {};
  const total = Number(counts.total || 0);
  const pending = Number(counts.queued || 0) + Number(counts.running || 0);
  const errors = Number(counts.failed || 0) + Number(counts.cancelled || 0);

  let status = "queued";
  let terminal = false;

  if (Number(counts.running || 0) > 0) {
    status = "running";
  } else if (pending > 0) {
    status = "queued";
  } else if (total === 0) {
    status = "error";
    terminal = true;
  } else if (errors === 0) {
    status = "success";
    terminal = true;
  } else if (Number(counts.succeeded || 0) > 0) {
    status = "partial_error";
    terminal = true;
  } else if (Number(counts.cancelled || 0) === total) {
    status = "cancelled";
    terminal = true;
  } else {
    status = "error";
    terminal = true;
  }

  const { rows } = await db.query(
    `UPDATE scrape_schedule_history
        SET status = $2,
            jobs_built = $3,
            finished_at = CASE WHEN $4 THEN COALESCE(finished_at, NOW()) ELSE NULL END,
            updated_at = NOW(),
            details = COALESCE(details, '{}'::jsonb) || $5::jsonb
      WHERE id = $1
      RETURNING *`,
    [
      scheduleHistoryId,
      status,
      total,
      terminal,
      JSON.stringify({ queueCounts: counts })
    ]
  );

  const history = rows[0] || null;

  if (history?.schedule_id && terminal) {
    if (status === "success") {
      await db.query(
        `UPDATE scrape_schedules
            SET last_completed_at = NOW(),
                consecutive_failures = 0,
                last_error = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [history.schedule_id]
      );
    } else {
      await db.query(
        `UPDATE scrape_schedules
            SET last_completed_at = NOW(),
                consecutive_failures = consecutive_failures + 1,
                last_error = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [history.schedule_id, counts.last_error || status]
      );
    }
  }

  return history;
}

async function markJobSucceeded(id, workerId, payload = {}) {
  const { rows } = await db.query(
    `UPDATE scrape_jobs
        SET status = 'succeeded',
            exit_code = COALESCE($3, 0),
            result = $4::jsonb,
            stdout_tail = $5,
            stderr_tail = $6,
            error_message = NULL,
            heartbeat_at = NOW(),
            finished_at = NOW(),
            cancel_requested = FALSE,
            updated_at = NOW()
      WHERE id = $1
        AND worker_id = $2
        AND status = 'running'
      RETURNING *`,
    [
      id,
      workerId,
      payload.exitCode,
      JSON.stringify(payload.result || {}),
      payload.stdoutTail || null,
      payload.stderrTail || null
    ]
  );

  await heartbeatWorker(workerId, null);
  const job = rows[0] || null;
  if (job?.schedule_history_id) {
    await refreshScheduleHistory(job.schedule_history_id);
  }
  return job;
}

async function markJobFailed(id, workerId, payload = {}) {
  const client = await db.connect();
  let updatedJob = null;

  try {
    await client.query("BEGIN");

    const selected = await client.query(
      `SELECT * FROM scrape_jobs WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const job = selected.rows[0];

    if (!job) {
      await client.query("COMMIT");
      return null;
    }

    const retryable = payload.retryable !== false;
    const shouldRetry =
      retryable &&
      !job.cancel_requested &&
      Number(job.attempt_count || 0) < Number(job.max_attempts || 1);

    const retryDelaySeconds = clampInteger(
      payload.retryDelaySeconds,
      Math.min(300, 15 * Math.max(1, Number(job.attempt_count || 1))),
      1,
      3600
    );

    const update = await client.query(
      `UPDATE scrape_jobs
          SET status = $3,
              available_at = CASE
                WHEN $3 = 'queued' THEN NOW() + ($4 || ' seconds')::interval
                ELSE available_at
              END,
              worker_id = CASE WHEN $3 = 'queued' THEN NULL ELSE worker_id END,
              claimed_at = CASE WHEN $3 = 'queued' THEN NULL ELSE claimed_at END,
              started_at = CASE WHEN $3 = 'queued' THEN NULL ELSE started_at END,
              heartbeat_at = NOW(),
              finished_at = CASE WHEN $3 = 'queued' THEN NULL ELSE NOW() END,
              exit_code = $5,
              error_message = $6,
              stdout_tail = $7,
              stderr_tail = $8,
              result = $9::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND ($2::text IS NULL OR worker_id = $2)
        RETURNING *`,
      [
        id,
        workerId || null,
        shouldRetry ? "queued" : "failed",
        String(retryDelaySeconds),
        payload.exitCode ?? null,
        String(payload.errorMessage || "Scrape job failed.").slice(0, 10000),
        payload.stdoutTail || null,
        payload.stderrTail || null,
        JSON.stringify(payload.result || {})
      ]
    );

    updatedJob = update.rows[0] || null;

    if (workerId) {
      await client.query(
        `UPDATE scrape_workers
            SET status = 'idle', current_job_id = NULL,
                last_heartbeat_at = NOW(), updated_at = NOW()
          WHERE worker_id = $1`,
        [workerId]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }

  if (updatedJob?.schedule_history_id) {
    await refreshScheduleHistory(updatedJob.schedule_history_id);
  }

  return updatedJob;
}

async function markJobCancelled(id, workerId, payload = {}) {
  const { rows } = await db.query(
    `UPDATE scrape_jobs
        SET status = 'cancelled',
            finished_at = NOW(),
            heartbeat_at = NOW(),
            error_message = $3,
            stdout_tail = $4,
            stderr_tail = $5,
            updated_at = NOW()
      WHERE id = $1
        AND ($2::text IS NULL OR worker_id = $2)
        AND status IN ('queued', 'running')
      RETURNING *`,
    [
      id,
      workerId || null,
      payload.errorMessage || "Cancelled by administrator.",
      payload.stdoutTail || null,
      payload.stderrTail || null
    ]
  );

  if (workerId) await heartbeatWorker(workerId, null);
  const job = rows[0] || null;
  if (job?.schedule_history_id) {
    await refreshScheduleHistory(job.schedule_history_id);
  }
  return job;
}

async function requestJobCancellation(id) {
  const { rows } = await db.query(
    `UPDATE scrape_jobs
        SET cancel_requested = TRUE,
            status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
            finished_at = CASE WHEN status = 'queued' THEN NOW() ELSE finished_at END,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('queued', 'running')
      RETURNING *`,
    [id]
  );

  const job = rows[0] || null;
  if (job?.schedule_history_id && job.status === "cancelled") {
    await refreshScheduleHistory(job.schedule_history_id);
  }
  return job;
}

async function isCancellationRequested(id) {
  const { rows } = await db.query(
    `SELECT cancel_requested FROM scrape_jobs WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0]?.cancel_requested === true;
}

async function retryJob(id) {
  const { rows } = await db.query(
    `UPDATE scrape_jobs
        SET status = 'queued',
            available_at = NOW(),
            claimed_at = NULL,
            started_at = NULL,
            heartbeat_at = NULL,
            finished_at = NULL,
            worker_id = NULL,
            attempt_count = 0,
            exit_code = NULL,
            cancel_requested = FALSE,
            error_message = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('failed', 'cancelled')
      RETURNING *`,
    [id]
  );

  const job = rows[0] || null;
  if (job?.schedule_history_id) {
    await refreshScheduleHistory(job.schedule_history_id);
  }
  return job;
}

async function recoverStaleJobs(staleMinutes = 20) {
  const minutes = clampInteger(staleMinutes, 20, 2, 1440);
  const { rows } = await db.query(
    `UPDATE scrape_jobs
        SET status = CASE
              WHEN attempt_count < max_attempts AND cancel_requested = FALSE
                THEN 'queued'
              ELSE CASE WHEN cancel_requested THEN 'cancelled' ELSE 'failed' END
            END,
            available_at = NOW(),
            worker_id = NULL,
            claimed_at = NULL,
            started_at = NULL,
            finished_at = CASE
              WHEN attempt_count < max_attempts AND cancel_requested = FALSE
                THEN NULL
              ELSE NOW()
            END,
            error_message = COALESCE(error_message, '') ||
              CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE E'\n' END ||
              'Recovered after stale worker heartbeat.',
            updated_at = NOW()
      WHERE status = 'running'
        AND COALESCE(heartbeat_at, started_at, claimed_at, created_at)
              < NOW() - ($1 || ' minutes')::interval
      RETURNING *`,
    [String(minutes)]
  );

  await db.query(
    `UPDATE scrape_workers
        SET status = 'offline', current_job_id = NULL,
            stopped_at = COALESCE(stopped_at, NOW()), updated_at = NOW()
      WHERE last_heartbeat_at < NOW() - ($1 || ' minutes')::interval
        AND status <> 'offline'`,
    [String(minutes)]
  );

  const historyIds = [
    ...new Set(rows.map((row) => row.schedule_history_id).filter(Boolean))
  ];
  for (const historyId of historyIds) {
    await refreshScheduleHistory(historyId);
  }

  return rows;
}

async function getQueueHealth() {
  const { rows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_jobs,
       COUNT(*) FILTER (WHERE status = 'running')::int AS running_jobs,
       COUNT(*) FILTER (WHERE status = 'succeeded' AND finished_at > NOW() - INTERVAL '24 hours')::int AS succeeded_24h,
       COUNT(*) FILTER (WHERE status = 'failed' AND finished_at > NOW() - INTERVAL '24 hours')::int AS failed_24h,
       MIN(created_at) FILTER (WHERE status = 'queued') AS oldest_queued_at
     FROM scrape_jobs`
  );
  return rows[0] || {};
}

async function listWorkers() {
  const { rows } = await db.query(
    `SELECT *,
       CASE
         WHEN last_heartbeat_at < NOW() - INTERVAL '2 minutes' THEN 'offline'
         ELSE status
       END AS effective_status
     FROM scrape_workers
     ORDER BY last_heartbeat_at DESC`
  );
  return rows;
}

module.exports = {
  ALLOWED_SCRIPTS,
  enqueueJob,
  getJob,
  listJobs,
  registerWorker,
  heartbeatWorker,
  markWorkerStopped,
  claimNextJob,
  markJobSucceeded,
  markJobFailed,
  markJobCancelled,
  requestJobCancellation,
  isCancellationRequested,
  retryJob,
  recoverStaleJobs,
  refreshScheduleHistory,
  getQueueHealth,
  listWorkers
};