-- NextAppt consumer user accounts + appointment alerts
-- Migration 012

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead', 'active', 'disabled')),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  first_name TEXT,
  source TEXT,
  last_source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_status
  ON users(status);

CREATE INDEX IF NOT EXISTS idx_users_email_verified
  ON users(email_verified);

CREATE INDEX IF NOT EXISTS idx_users_created_at
  ON users(created_at DESC);

CREATE TABLE IF NOT EXISTS user_login_codes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_salt TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_login_codes_user_created
  ON user_login_codes(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_login_codes_active
  ON user_login_codes(user_id, expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
  ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_email_preferences (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  appointment_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  product_updates_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  product_updates_opted_in_at TIMESTAMPTZ,
  marketing_opted_in_at TIMESTAMPTZ,
  global_unsubscribed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_alerts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused')),
  metro TEXT,
  category_slug TEXT,
  service_type TEXT,
  duration_minutes INTEGER,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,
  provider_name TEXT,
  target_date DATE,
  target_date_end DATE,
  start_time TIME,
  end_time TIME,
  radius_miles NUMERIC(6,2),
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at TIMESTAMPTZ,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointment_alerts_user_status
  ON appointment_alerts(user_id, status);

CREATE INDEX IF NOT EXISTS idx_appointment_alerts_active_target
  ON appointment_alerts(status, target_date, target_date_end)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_appointment_alerts_metro_category
  ON appointment_alerts(metro, category_slug)
  WHERE status = 'active';