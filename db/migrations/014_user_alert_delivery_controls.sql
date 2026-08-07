-- NextAppt user alert email delivery controls
-- Migration 014
-- Defaults intentionally disable delivery until an admin explicitly enables it.

BEGIN;

CREATE TABLE IF NOT EXISTS user_alert_delivery_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1
    CHECK (id = 1),

  emails_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  max_appointments_per_email INTEGER NOT NULL DEFAULT 3
    CHECK (max_appointments_per_email BETWEEN 1 AND 20),

  max_emails_per_alert_per_hour INTEGER NOT NULL DEFAULT 1
    CHECK (max_emails_per_alert_per_hour BETWEEN 0 AND 20),

  max_emails_per_alert_per_day INTEGER NOT NULL DEFAULT 3
    CHECK (max_emails_per_alert_per_day BETWEEN 0 AND 100),

  minimum_minutes_between_emails INTEGER NOT NULL DEFAULT 60
    CHECK (minimum_minutes_between_emails BETWEEN 0 AND 1440),

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO user_alert_delivery_settings (
  id,
  emails_enabled,
  max_appointments_per_email,
  max_emails_per_alert_per_hour,
  max_emails_per_alert_per_day,
  minimum_minutes_between_emails
)
VALUES (
  1,
  FALSE,
  3,
  1,
  3,
  60
)
ON CONFLICT (id) DO NOTHING;

COMMIT;