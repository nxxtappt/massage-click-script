BEGIN;

ALTER TABLE business_services
  ADD COLUMN IF NOT EXISTS parent_service_text TEXT,
  ADD COLUMN IF NOT EXISTS session_type_id TEXT;

UPDATE business_services
SET
  parent_service_text = COALESCE(parent_service_text, raw_json->>'parentServiceText'),
  session_type_id = COALESCE(session_type_id, raw_json->>'sessionTypeId'),
  discovery_status = COALESCE(discovery_status, raw_json->>'discoveryStatus'),
  service_type = COALESCE(NULLIF(service_type, ''), raw_json->>'serviceType'),
  duration_minutes = COALESCE(duration_minutes, NULLIF(raw_json->>'durationMinutes', '')::integer),
  platform_service_id = COALESCE(NULLIF(platform_service_id, ''), raw_json->>'platformServiceId'),
  service_button_id = COALESCE(NULLIF(service_button_id, ''), raw_json->>'serviceButtonId'),
  service_id = COALESCE(NULLIF(service_id, ''), raw_json->>'serviceId'),
  category_text = COALESCE(NULLIF(category_text, ''), raw_json->>'categoryText'),
  provider_text = COALESCE(NULLIF(provider_text, ''), raw_json->>'providerText')
WHERE raw_json IS NOT NULL;

UPDATE business_services
SET canonical_key = CONCAT_WS(
  '|',
  LOWER(COALESCE(NULLIF(platform_service_id, ''), NULLIF(service_id, ''), NULLIF(service_button_id, ''), '')),
  LOWER(TRIM(COALESCE(service_name, ''))),
  LOWER(TRIM(COALESCE(service_type, ''))),
  COALESCE(duration_minutes::text, '')
);

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY business_id, canonical_key
           ORDER BY enabled DESC, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
         ) AS rn
  FROM business_services
)
DELETE FROM business_services bs
USING ranked r
WHERE bs.id = r.id AND r.rn > 1;

DROP INDEX IF EXISTS business_services_business_canonical_uidx;
CREATE UNIQUE INDEX business_services_business_canonical_uidx
  ON business_services (business_id, canonical_key);

COMMIT;
