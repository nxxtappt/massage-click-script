-- NextAppt.ai legal policy versions + clickwrap acceptance audit trail
-- Migration 013
-- Current legal version: 2026-08-08

CREATE TABLE IF NOT EXISTS legal_policy_versions (
  id BIGSERIAL PRIMARY KEY,
  policy_type TEXT NOT NULL
    CHECK (policy_type IN ('terms', 'privacy')),
  version TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  public_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_type, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_policy_current_type
  ON legal_policy_versions(policy_type)
  WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id BIGSERIAL PRIMARY KEY,

  subject_type TEXT NOT NULL
    CHECK (subject_type IN ('consumer_user', 'business_user')),

  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  business_id BIGINT REFERENCES businesses(id) ON DELETE SET NULL,

  accepted_by_email TEXT NOT NULL,

  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  terms_content_sha256 TEXT NOT NULL,
  privacy_content_sha256 TEXT NOT NULL,

  terms_accepted BOOLEAN NOT NULL DEFAULT TRUE
    CHECK (terms_accepted = TRUE),
  privacy_acknowledged BOOLEAN NOT NULL DEFAULT TRUE
    CHECK (privacy_acknowledged = TRUE),
  age_18_confirmed BOOLEAN NOT NULL DEFAULT TRUE
    CHECK (age_18_confirmed = TRUE),
  business_authority_confirmed BOOLEAN NOT NULL DEFAULT FALSE,

  acceptance_text TEXT NOT NULL,
  acceptance_method TEXT NOT NULL DEFAULT 'clickwrap',
  source TEXT NOT NULL DEFAULT 'account_login',

  ip_address INET,
  user_agent TEXT,
  request_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT legal_acceptance_subject_shape CHECK (
    (
      subject_type = 'consumer_user'
      AND user_id IS NOT NULL
      AND business_id IS NULL
      AND business_authority_confirmed = FALSE
    )
    OR
    (
      subject_type = 'business_user'
      AND business_id IS NOT NULL
      AND user_id IS NULL
      AND business_authority_confirmed = TRUE
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_user
  ON legal_acceptances(user_id, accepted_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_business
  ON legal_acceptances(business_id, accepted_at DESC)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_email
  ON legal_acceptances(LOWER(accepted_by_email), accepted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptance_consumer_version
  ON legal_acceptances(user_id, terms_version, privacy_version)
  WHERE subject_type = 'consumer_user' AND user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_acceptance_business_rep_version
  ON legal_acceptances(business_id, LOWER(accepted_by_email), terms_version, privacy_version)
  WHERE subject_type = 'business_user' AND business_id IS NOT NULL;

UPDATE legal_policy_versions
SET is_current = FALSE
WHERE policy_type IN ('terms', 'privacy');

INSERT INTO legal_policy_versions (
  policy_type,
  version,
  effective_at,
  public_path,
  content_sha256,
  is_current
)
VALUES
  (
    'terms',
    '2026-08-08',
    '2026-08-08T00:00:00-05:00',
    '/terms',
    '46891318c20c68b09ea8b5ea964e486a83c6bb6c3fceb2f545fbb0811f239c99',
    TRUE
  ),
  (
    'privacy',
    '2026-08-08',
    '2026-08-08T00:00:00-05:00',
    '/privacy',
    'cd2104469c041b65cc81c90ea283d2cad8f736ffd660ce31c3f0333ee320ea1b',
    TRUE
  )
ON CONFLICT (policy_type, version)
DO UPDATE SET
  effective_at = EXCLUDED.effective_at,
  public_path = EXCLUDED.public_path,
  content_sha256 = EXCLUDED.content_sha256,
  is_current = EXCLUDED.is_current;