-- NextAppt inference pipeline hardening
-- Safe to run more than once.

ALTER TABLE business_services
  ADD COLUMN IF NOT EXISTS canonical_key TEXT,
  ADD COLUMN IF NOT EXISTS parent_service_text TEXT,
  ADD COLUMN IF NOT EXISTS session_type_id TEXT,
  ADD COLUMN IF NOT EXISTS scrape_directly BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS inference_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inference_role TEXT,
  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS anchor_service_key TEXT,
  ADD COLUMN IF NOT EXISTS infer_shorter_durations BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS infer_service_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS infer_start_interval_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS inference_confidence NUMERIC(4,3),
  ADD COLUMN IF NOT EXISTS booking_interval_minutes INTEGER;

UPDATE business_services
SET canonical_key = CONCAT(
  COALESCE(
    NULLIF(LOWER(platform_service_id), ''),
    NULLIF(LOWER(service_id), ''),
    ''
  ),
  '|',
  LOWER(COALESCE(service_name, '')),
  '|',
  LOWER(COALESCE(service_type, '')),
  '|',
  COALESCE(duration_minutes::TEXT, ''),
  '|',
  id::TEXT
)
WHERE canonical_key IS NULL OR canonical_key = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_services_business_canonical
  ON business_services(business_id, canonical_key);

ALTER TABLE confirmed_appointments
  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS raw_json JSONB;

ALTER TABLE inferred_appointments
  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS local_date DATE,
  ADD COLUMN IF NOT EXISTS local_time TIME,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'inferred',
  ADD COLUMN IF NOT EXISTS raw_json JSONB;

ALTER TABLE inferred_appointments
  ALTER COLUMN inference_type SET DEFAULT 'service_anchor';

UPDATE inferred_appointments
SET inference_type = 'service_anchor'
WHERE inference_type IS NULL OR inference_type = '';

ALTER TABLE appointment_inventory
  ADD COLUMN IF NOT EXISTS business_service_id BIGINT,
  ADD COLUMN IF NOT EXISTS anchor_service_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_business_services_inference_anchor
  ON business_services(
    business_id,
    inference_role,
    inference_enabled
  )
  WHERE enabled IS NOT FALSE;

CREATE INDEX IF NOT EXISTS idx_inventory_anchor_service
  ON appointment_inventory(
    anchor_service_id,
    local_date,
    local_time
  );

CREATE INDEX IF NOT EXISTS idx_inventory_business_service
  ON appointment_inventory(
    business_service_id,
    local_date,
    local_time
  );
  
