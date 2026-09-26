CREATE TABLE IF NOT EXISTS billing_leads (
  id BIGSERIAL PRIMARY KEY,
  business_key TEXT NOT NULL,
  business_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  requested_plan TEXT NOT NULL CHECK (requested_plan IN ('verified_free', 'premium', 'premium_intel')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  click_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_leads_business_plan_key UNIQUE (business_key, requested_plan)
);

CREATE INDEX IF NOT EXISTS billing_leads_status_recent_idx
ON billing_leads (status, last_clicked_at DESC);
