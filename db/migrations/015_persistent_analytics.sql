-- NextAppt persistent analytics
-- 015 is available because the proposed bulk-email-import update was not deployed.

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_path TEXT,
  first_referrer TEXT,
  user_agent TEXT
);

CREATE TABLE IF NOT EXISTS analytics_sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_path TEXT,
  referrer TEXT,
  user_agent TEXT,
  page_view_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started_at
  ON analytics_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_last_seen_at
  ON analytics_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_visitor_id
  ON analytics_sessions(visitor_id);

CREATE TABLE IF NOT EXISTS analytics_page_views (
  id BIGSERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  referrer TEXT,
  business_slug TEXT,
  metro TEXT,
  category_slug TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_page_views_viewed_at
  ON analytics_page_views(viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_page_views_path
  ON analytics_page_views(path);
CREATE INDEX IF NOT EXISTS idx_analytics_page_views_business_slug
  ON analytics_page_views(business_slug, viewed_at DESC);

CREATE TABLE IF NOT EXISTS analytics_appointment_clicks (
  id BIGSERIAL PRIMARY KEY,
  legacy_id TEXT UNIQUE,
  visitor_id TEXT,
  session_id TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  business_name TEXT,
  business_slug TEXT,
  platform TEXT,
  service_name TEXT,
  service_category TEXT,
  duration_minutes INTEGER,
  therapist_name TEXT,
  appointment_date TEXT,
  appointment_time TEXT,
  start_time TEXT,
  local_date_key DATE,
  local_time_key TIME,
  booking_url TEXT,
  source_page TEXT,
  page_path TEXT,
  referrer TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_clicks_clicked_at
  ON analytics_appointment_clicks(clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_clicks_business
  ON analytics_appointment_clicks(business_name, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_clicks_business_slug
  ON analytics_appointment_clicks(business_slug, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_clicks_service
  ON analytics_appointment_clicks(service_name, clicked_at DESC);

COMMIT;