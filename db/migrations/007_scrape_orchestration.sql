BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF to_regclass('public.scrape_schedules') IS NULL
     OR to_regclass('public.scrape_schedule_history') IS NULL THEN
    RAISE EXCEPTION 'Scheduler V2 tables are missing. Run 006_integration_scheduler_v2.sql before 007_scrape_orchestration.sql.';
  END IF;
END
$$;

ALTER TABLE scrape_schedules
  ADD COLUMN IF NOT EXISTS last_enqueued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

ALTER TABLE scrape_schedule_history
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'admin',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  script_name TEXT NOT NULL DEFAULT 'scrape.js',
  args JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(args) = 'array'),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  schedule_id UUID REFERENCES scrape_schedules(id) ON DELETE SET NULL,
  schedule_history_id BIGINT REFERENCES scrape_schedule_history(id) ON DELETE SET NULL,
  occurrence_key TEXT,
  dedupe_key TEXT,
  requested_by TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  worker_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  timeout_seconds INTEGER NOT NULL DEFAULT 1800 CHECK (timeout_seconds >= 60),
  exit_code INTEGER,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error_message TEXT,
  stdout_tail TEXT,
  stderr_tail TEXT,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS scrape_jobs_dedupe_key_uidx
  ON scrape_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS scrape_jobs_claim_idx
  ON scrape_jobs (status, available_at, priority DESC, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS scrape_jobs_running_heartbeat_idx
  ON scrape_jobs (heartbeat_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS scrape_jobs_schedule_history_idx
  ON scrape_jobs (schedule_history_id, status);

CREATE INDEX IF NOT EXISTS scrape_jobs_created_idx
  ON scrape_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS scrape_workers (
  worker_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'stopping', 'offline')),
  current_job_id UUID REFERENCES scrape_jobs(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scrape_workers_heartbeat_idx
  ON scrape_workers (last_heartbeat_at DESC);

COMMIT;