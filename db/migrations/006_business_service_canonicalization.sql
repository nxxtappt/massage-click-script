BEGIN;

ALTER TABLE business_services
  ADD COLUMN IF NOT EXISTS canonical_key TEXT,
  ADD COLUMN IF NOT EXISTS scrape_directly BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inference_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inference_role TEXT,
  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS anchor_service_key TEXT,
  ADD COLUMN IF NOT EXISTS infer_shorter_durations BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS infer_service_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS infer_start_interval_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS inference_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS booking_interval_minutes INTEGER;

UPDATE business_services
SET canonical_key = CONCAT_WS(
  '|',
  LOWER(COALESCE(NULLIF(platform_service_id, ''), NULLIF(service_id, ''), '')),
  LOWER(TRIM(COALESCE(service_name, ''))),
  LOWER(TRIM(COALESCE(service_type, ''))),
  COALESCE(duration_minutes::text, '')
)
WHERE canonical_key IS NULL OR canonical_key = '';

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY business_id, canonical_key
      ORDER BY enabled DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS row_number
  FROM business_services
)
DELETE FROM business_services bs
USING ranked r
WHERE bs.id = r.id
  AND r.row_number > 1;

ALTER TABLE business_services
  ALTER COLUMN canonical_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS business_services_business_canonical_uidx
  ON business_services (business_id, canonical_key);

CREATE INDEX IF NOT EXISTS business_services_inference_role_idx
  ON business_services (business_id, inference_enabled, inference_role);

CREATE INDEX IF NOT EXISTS business_services_anchor_idx
  ON business_services (anchor_service_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_services_inference_role_check'
  ) THEN
    ALTER TABLE business_services
      ADD CONSTRAINT business_services_inference_role_check
      CHECK (inference_role IS NULL OR inference_role IN ('anchor', 'inferred'));
  END IF;
END $$;

ALTER TABLE confirmed_appointments
  ADD COLUMN IF NOT EXISTS business_service_id BIGINT;

ALTER TABLE inferred_appointments
  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT;

ALTER TABLE appointment_inventory
  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT;

CREATE INDEX IF NOT EXISTS confirmed_appointments_business_service_idx
  ON confirmed_appointments (business_service_id);

CREATE INDEX IF NOT EXISTS inferred_appointments_business_service_idx
  ON inferred_appointments (business_service_id, anchor_service_id);

CREATE INDEX IF NOT EXISTS appointment_inventory_business_service_idx
  ON appointment_inventory (business_service_id, anchor_service_id);

COMMIT;
