-- NextAppt user appointment alert notification ledger
-- Migration 013

BEGIN;

ALTER TABLE appointment_alerts
  DROP CONSTRAINT IF EXISTS appointment_alerts_status_check;

ALTER TABLE appointment_alerts
  ADD CONSTRAINT appointment_alerts_status_check
  CHECK (status IN ('active', 'paused', 'expired'));

ALTER TABLE appointment_alerts
  ADD COLUMN IF NOT EXISTS last_match_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE appointment_alerts
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS appointment_alert_notifications (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT NOT NULL REFERENCES appointment_alerts(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  appointment_key TEXT NOT NULL,
  inventory_id BIGINT,

  business_name TEXT NOT NULL,
  service_name TEXT,
  service_category TEXT,
  category_slug TEXT,
  duration_minutes INTEGER,
  provider_name TEXT,
  booking_url TEXT,
  appointment_start TIMESTAMPTZ,
  appointment_end TIMESTAMPTZ,
  local_date DATE,
  local_time TIME,
  timezone TEXT,
  source_type TEXT,
  confidence NUMERIC(5,4),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  email_message_id TEXT,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT appointment_alert_notifications_alert_key_unique
    UNIQUE (alert_id, appointment_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_user_created
  ON appointment_alert_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_alert_created
  ON appointment_alert_notifications(alert_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_notifications_status_updated
  ON appointment_alert_notifications(status, updated_at DESC);

COMMIT;