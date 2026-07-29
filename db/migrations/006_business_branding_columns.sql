BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS logo_alt TEXT;

-- One-time recovery of legacy logo values into dedicated PostgreSQL columns.
-- Runtime reads and writes use logo_url and logo_alt after this migration.
UPDATE businesses
SET
  logo_url = COALESCE(
    NULLIF(logo_url, ''),
    NULLIF(raw_json ->> 'logoUrl', ''),
    NULLIF(raw_json ->> 'logo_url', '')
  ),
  logo_alt = COALESCE(
    NULLIF(logo_alt, ''),
    NULLIF(raw_json ->> 'logoAlt', ''),
    NULLIF(raw_json ->> 'logo_alt', ''),
    CASE
      WHEN COALESCE(
        NULLIF(logo_url, ''),
        NULLIF(raw_json ->> 'logoUrl', ''),
        NULLIF(raw_json ->> 'logo_url', '')
      ) IS NOT NULL
      THEN business_name || ' logo'
      ELSE NULL
    END
  )
WHERE
  logo_url IS NULL
  OR logo_url = ''
  OR logo_alt IS NULL
  OR logo_alt = '';

COMMIT;