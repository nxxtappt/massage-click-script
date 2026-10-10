CREATE TABLE IF NOT EXISTS business_interest_notifications (
  id BIGSERIAL PRIMARY KEY,
  alert_id BIGINT UNIQUE REFERENCES appointment_alerts(id) ON DELETE SET NULL,
  business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_email TEXT,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS business_interests_by_business ON business_interest_notifications (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS business_interests_pending_mail ON business_interest_notifications (next_attempt_at) WHERE email_sent_at IS NULL;
