-- NextAppt category pipeline synchronization
-- Migration 009
-- Purpose:
--   1. Keep business service categories stable during existing save operations.
--   2. Automatically copy category_slug into scrape and inventory records.
--   3. Preserve specific service_type/service_category values for modality search.
-- Safe to run more than once.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.service_categories') IS NULL
     OR to_regclass('public.business_services') IS NULL
     OR to_regclass('public.appointment_inventory') IS NULL THEN
    RAISE EXCEPTION
      'Service category foundation is missing. Run 008_service_categories.sql first.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION normalize_service_category_slug(value TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $function$
  SELECT NULLIF(
    TRIM(
      BOTH '-'
      FROM REGEXP_REPLACE(
        LOWER(BTRIM(COALESCE(value, ''))),
        '[^a-z0-9]+',
        '-',
        'g'
      )
    ),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION resolve_service_category_slug(
  explicit_slug TEXT,
  service_name_value TEXT,
  service_type_value TEXT,
  category_text_value TEXT,
  raw_json_value JSONB DEFAULT '{}'::jsonb,
  fallback_slug TEXT DEFAULT 'massage'
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  candidate_slug TEXT;
  normalized_fallback TEXT;
  searchable_text TEXT;
BEGIN
  candidate_slug := normalize_service_category_slug(
    COALESCE(
      NULLIF(BTRIM(explicit_slug), ''),
      NULLIF(BTRIM(raw_json_value->>'categorySlug'), ''),
      NULLIF(BTRIM(raw_json_value->>'category_slug'), ''),
      NULLIF(BTRIM(raw_json_value->>'marketplaceCategory'), ''),
      NULLIF(BTRIM(raw_json_value->>'marketplace_category'), '')
    )
  );

  IF candidate_slug IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM service_categories
      WHERE slug = candidate_slug
    ) THEN
      RETURN candidate_slug;
    END IF;

    RAISE EXCEPTION 'Unknown service category slug: %', candidate_slug;
  END IF;

  searchable_text := LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name_value, ''),
      COALESCE(service_type_value, ''),
      COALESCE(category_text_value, '')
    )
  );

  IF searchable_text ~ '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
     OR searchable_text ~ 'red[ -]?light therapy'
     OR searchable_text ~ 'cryotherapy'
     OR searchable_text ~ 'compression therapy'
     OR searchable_text ~ 'cold plunge' THEN
    candidate_slug := 'recovery';
  ELSIF searchable_text ~ 'chiropract|chiro adjustment|spinal adjustment|spinal decompression' THEN
    candidate_slug := 'chiropractic';
  ELSIF searchable_text ~ 'acupuncture|electroacupuncture' THEN
    candidate_slug := 'acupuncture';
  ELSIF searchable_text ~ 'hydrafacial|facial|dermaplan|microdermabrasion|chemical peel|microneedl' THEN
    candidate_slug := 'skin';
  END IF;

  IF candidate_slug IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM service_categories
       WHERE slug = candidate_slug
     ) THEN
    RETURN candidate_slug;
  END IF;

  normalized_fallback := normalize_service_category_slug(fallback_slug);

  IF normalized_fallback IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM service_categories
       WHERE slug = normalized_fallback
     ) THEN
    RETURN normalized_fallback;
  END IF;

  SELECT slug
  INTO candidate_slug
  FROM service_categories
  ORDER BY sort_order ASC, display_name ASC
  LIMIT 1;

  IF candidate_slug IS NULL THEN
    RAISE EXCEPTION 'No service categories are configured.';
  END IF;

  RETURN candidate_slug;
END;
$function$;

CREATE OR REPLACE FUNCTION sync_business_service_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  preserved_slug TEXT;
BEGIN
  preserved_slug := CASE
    WHEN TG_OP = 'UPDATE'
      AND (NEW.category_slug IS NULL OR BTRIM(NEW.category_slug) = '')
      THEN OLD.category_slug
    ELSE NEW.category_slug
  END;

  NEW.category_slug := resolve_service_category_slug(
    preserved_slug,
    NEW.service_name,
    NEW.service_type,
    NEW.category_text,
    COALESCE(NEW.raw_json, '{}'::jsonb),
    'massage'
  );

  NEW.raw_json := JSONB_SET(
    COALESCE(NEW.raw_json, '{}'::jsonb),
    '{categorySlug}',
    TO_JSONB(NEW.category_slug),
    TRUE
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_business_services_category_sync
  ON business_services;

CREATE TRIGGER trg_business_services_category_sync
BEFORE INSERT OR UPDATE OF
  category_slug,
  service_name,
  service_type,
  category_text,
  raw_json
ON business_services
FOR EACH ROW
EXECUTE FUNCTION sync_business_service_category();

CREATE OR REPLACE FUNCTION sync_appointment_category()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
  row_data JSONB;
  resolved_slug TEXT;
  business_service_value TEXT;
  business_name_value TEXT;
  service_name_value TEXT;
  service_type_value TEXT;
BEGIN
  row_data := TO_JSONB(NEW);

  business_service_value := NULLIF(
    BTRIM(row_data->>'business_service_id'),
    ''
  );
  business_name_value := NULLIF(
    BTRIM(row_data->>'business_name'),
    ''
  );
  service_name_value := NULLIF(
    BTRIM(row_data->>'service_name'),
    ''
  );
  service_type_value := COALESCE(
    NULLIF(BTRIM(row_data->>'service_type'), ''),
    NULLIF(BTRIM(row_data->>'service_category'), '')
  );

  resolved_slug := normalize_service_category_slug(
    row_data->>'category_slug'
  );

  IF resolved_slug IS NULL
     AND business_service_value ~ '^[0-9]+$' THEN
    SELECT category_slug
    INTO resolved_slug
    FROM business_services
    WHERE id = business_service_value::BIGINT
    LIMIT 1;
  END IF;

  IF resolved_slug IS NULL
     AND business_name_value IS NOT NULL THEN
    SELECT bs.category_slug
    INTO resolved_slug
    FROM business_services bs
    INNER JOIN businesses b
      ON b.id = bs.business_id
    WHERE LOWER(b.business_name) = LOWER(business_name_value)
      AND bs.enabled IS NOT FALSE
      AND (
        (
          service_name_value IS NOT NULL
          AND LOWER(bs.service_name) = LOWER(service_name_value)
        )
        OR (
          service_type_value IS NOT NULL
          AND LOWER(COALESCE(bs.service_type, ''))
              = LOWER(service_type_value)
        )
      )
    ORDER BY
      CASE
        WHEN service_name_value IS NOT NULL
         AND LOWER(bs.service_name) = LOWER(service_name_value)
          THEN 0
        ELSE 1
      END,
      bs.id ASC
    LIMIT 1;
  END IF;

  NEW.category_slug := resolve_service_category_slug(
    resolved_slug,
    service_name_value,
    service_type_value,
    NULL,
    '{}'::jsonb,
    'massage'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_scrape_runs_category_sync
  ON scrape_runs;

CREATE TRIGGER trg_scrape_runs_category_sync
BEFORE INSERT OR UPDATE OF
  category_slug,
  business_name,
  service_name,
  service_type
ON scrape_runs
FOR EACH ROW
EXECUTE FUNCTION sync_appointment_category();

DROP TRIGGER IF EXISTS trg_raw_scrape_results_category_sync
  ON raw_scrape_results;

CREATE TRIGGER trg_raw_scrape_results_category_sync
BEFORE INSERT OR UPDATE OF
  category_slug,
  business_name,
  service_name,
  service_type
ON raw_scrape_results
FOR EACH ROW
EXECUTE FUNCTION sync_appointment_category();

DROP TRIGGER IF EXISTS trg_confirmed_appointments_category_sync
  ON confirmed_appointments;

CREATE TRIGGER trg_confirmed_appointments_category_sync
BEFORE INSERT OR UPDATE OF
  category_slug,
  business_service_id,
  business_name,
  service_name,
  service_category
ON confirmed_appointments
FOR EACH ROW
EXECUTE FUNCTION sync_appointment_category();

DROP TRIGGER IF EXISTS trg_inferred_appointments_category_sync
  ON inferred_appointments;

CREATE TRIGGER trg_inferred_appointments_category_sync
BEFORE INSERT OR UPDATE OF
  category_slug,
  business_service_id,
  business_name,
  service_name,
  service_category
ON inferred_appointments
FOR EACH ROW
EXECUTE FUNCTION sync_appointment_category();

DROP TRIGGER IF EXISTS trg_appointment_inventory_category_sync
  ON appointment_inventory;

CREATE TRIGGER trg_appointment_inventory_category_sync
BEFORE INSERT OR UPDATE OF
  category_slug,
  business_service_id,
  business_name,
  service_name,
  service_category
ON appointment_inventory
FOR EACH ROW
EXECUTE FUNCTION sync_appointment_category();

-- Repair any rows inserted between migrations 008 and 009.
UPDATE business_services
SET category_slug = NULL
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE scrape_runs
SET category_slug = NULL
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE raw_scrape_results
SET category_slug = NULL
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE confirmed_appointments
SET category_slug = NULL
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE inferred_appointments
SET category_slug = NULL
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE appointment_inventory
SET category_slug = NULL
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

COMMIT;