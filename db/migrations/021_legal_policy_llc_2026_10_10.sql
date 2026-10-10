-- NextAppt. LLC legal policy version update
-- Policy version: 2026-10-10
-- This makes the new LLC-era Terms and Privacy Policy current.
-- Existing business representatives must accept this version once.
-- Future logins skip acceptance until another policy version becomes current.

BEGIN;

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
    '2026-10-10',
    '2026-10-10T00:00:00-05:00',
    '/terms',
    '0eb9ee21a5644387c347674ddf823397046f16a9610155d51c617c1521a6ca2e',
    TRUE
  ),
  (
    'privacy',
    '2026-10-10',
    '2026-10-10T00:00:00-05:00',
    '/privacy',
    'cd0bebfe9afc533d1aee846e7085e51e4e0333e1b98ea353f4091f5c89137052',
    TRUE
  )
ON CONFLICT (policy_type, version)
DO UPDATE SET
  effective_at = EXCLUDED.effective_at,
  public_path = EXCLUDED.public_path,
  content_sha256 = EXCLUDED.content_sha256,
  is_current = EXCLUDED.is_current;

COMMIT;
