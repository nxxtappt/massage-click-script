-- NextAppt migration: convert business_services.infer_service_types to TEXT[]
-- Uses a temporary column because PostgreSQL does not allow a subquery
-- inside ALTER COLUMN ... TYPE ... USING.

BEGIN;

ALTER TABLE business_services
  ADD COLUMN IF NOT EXISTS infer_service_types_text TEXT[];

UPDATE business_services
SET infer_service_types_text =
  CASE
    WHEN infer_service_types IS NULL THEN ARRAY[]::TEXT[]

    WHEN jsonb_typeof(infer_service_types::jsonb) = 'array' THEN
      ARRAY(
        SELECT jsonb_array_elements_text(infer_service_types::jsonb)
      )

    WHEN jsonb_typeof(infer_service_types::jsonb) = 'string' THEN
      ARRAY[
        trim(both '"' from infer_service_types::jsonb::text)
      ]::TEXT[]

    ELSE ARRAY[]::TEXT[]
  END;

ALTER TABLE business_services
  DROP COLUMN infer_service_types;

ALTER TABLE business_services
  RENAME COLUMN infer_service_types_text TO infer_service_types;

ALTER TABLE business_services
  ALTER COLUMN infer_service_types SET DEFAULT ARRAY[]::TEXT[];

UPDATE business_services
SET infer_service_types = ARRAY[]::TEXT[]
WHERE infer_service_types IS NULL;

COMMIT;