BEGIN;

CREATE TABLE IF NOT EXISTS admin_runtime_settings (
  settings_key TEXT PRIMARY KEY DEFAULT 'global',
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_cache (
  cache_key TEXT PRIMARY KEY,
  business_name TEXT,
  platform TEXT,
  service_name TEXT,
  service_type TEXT,
  duration_minutes INTEGER,
  status TEXT,
  payload_json JSONB NOT NULL,
  last_checked TIMESTAMPTZ,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS appointment_cache_expires_idx
ON appointment_cache (expires_at);

CREATE INDEX IF NOT EXISTS appointment_cache_business_idx
ON appointment_cache (LOWER(business_name));

CREATE TABLE IF NOT EXISTS search_locks (
  intent_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS search_locks_expires_idx
ON search_locks (expires_at);

CREATE TABLE IF NOT EXISTS scrape_error_logs (
  id BIGSERIAL PRIMARY KEY,
  business_name TEXT,
  platform TEXT,
  service_name TEXT,
  error_message TEXT NOT NULL,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scrape_error_logs_logged_idx
ON scrape_error_logs (logged_at DESC);

CREATE TABLE IF NOT EXISTS email_captures (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id BIGSERIAL PRIMARY KEY,
  cluster_id TEXT,
  run_status TEXT NOT NULL DEFAULT 'running',
  trigger_type TEXT NOT NULL DEFAULT 'scheduled',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  exit_code INTEGER,
  error_message TEXT
);

COMMIT;