-- NextAppt PostgreSQL Inventory Support Schema
-- Migration 003
-- Purpose: support scrape queues, inventory lifecycle, stale cleanup, and inference jobs.

CREATE TABLE IF NOT EXISTS scrape_queue (
  id BIGSERIAL PRIMARY KEY,

  business_name TEXT NOT NULL,
  platform TEXT NOT NULL,

  service_name TEXT,
  service_type TEXT,
  duration_minutes INTEGER,

  priority TEXT NOT NULL DEFAULT 'normal',
  queue_status TEXT NOT NULL DEFAULT 'queued',

  scrape_start_date DATE,
  scrape_end_date DATE,
  lookahead_hours INTEGER,
  days_forward INTEGER,
  scrape_window_mode TEXT,

  requested_by TEXT NOT NULL DEFAULT 'system',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  error_message TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS inventory_events (
  id BIGSERIAL PRIMARY KEY,

  appointment_inventory_id BIGINT REFERENCES appointment_inventory(id) ON DELETE SET NULL,

  event_type TEXT NOT NULL,
  event_reason TEXT,

  business_name TEXT,
  platform TEXT,
  service_name TEXT,
  appointment_start TIMESTAMPTZ,

  previous_state JSONB,
  next_state JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id BIGSERIAL PRIMARY KEY,

  business_name TEXT NOT NULL,
  platform TEXT,

  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,

  total_confirmed INTEGER NOT NULL DEFAULT 0,
  total_inferred INTEGER NOT NULL DEFAULT 0,
  total_searchable INTEGER NOT NULL DEFAULT 0,
  total_expired INTEGER NOT NULL DEFAULT 0,

  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_expirations (
  id BIGSERIAL PRIMARY KEY,

  appointment_inventory_id BIGINT REFERENCES appointment_inventory(id) ON DELETE CASCADE,

  expiration_reason TEXT NOT NULL,
  expired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS inference_jobs (
  id BIGSERIAL PRIMARY KEY,

  business_name TEXT NOT NULL,
  platform TEXT NOT NULL,

  service_name TEXT,
  source_service_type TEXT,
  target_service_type TEXT,

  source_duration_minutes INTEGER,
  target_duration_minutes INTEGER,

  inference_type TEXT NOT NULL,
  job_status TEXT NOT NULL DEFAULT 'queued',

  inference_window_start DATE,
  inference_window_end DATE,

  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.950,

  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  error_message TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_queue_status
  ON scrape_queue(queue_status, priority, requested_at);

CREATE INDEX IF NOT EXISTS idx_inventory_events_business
  ON inventory_events(business_name, platform, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_business_date
  ON inventory_snapshots(business_name, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_inference_jobs_status
  ON inference_jobs(job_status, created_at);
