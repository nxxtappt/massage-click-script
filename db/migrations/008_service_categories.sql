-- NextAppt service category foundation
-- Migration 008
-- Purpose:
--   1. Add database-driven top-level service categories.
--   2. Assign existing business services and appointment inventory to a category.
--   3. Preserve existing service_type and service_category values for modality-level search.
-- Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS service_categories (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT service_categories_slug_format_check
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

INSERT INTO service_categories (
  slug,
  display_name,
  description,
  enabled,
  sort_order
)
VALUES
  (
    'massage',
    'Massage',
    'Massage therapy appointments, including individual massage modalities and durations.',
    TRUE,
    10
  ),
  (
    'chiropractic',
    'Chiropractic',
    'Chiropractic appointments and related chiropractic services.',
    TRUE,
    20
  ),
  (
    'acupuncture',
    'Acupuncture',
    'Acupuncture appointments and related traditional medicine services.',
    TRUE,
    30
  ),
  (
    'recovery',
    'Recovery',
    'Recovery services such as infrared sauna, red light therapy, compression, and similar appointments.',
    TRUE,
    40
  ),
  (
    'skin',
    'Skin',
    'Facials, skincare treatments, and related esthetic services.',
    TRUE,
    50
  )
ON CONFLICT (slug)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

ALTER TABLE business_services
  ADD COLUMN IF NOT EXISTS category_slug TEXT;

ALTER TABLE scrape_runs
  ADD COLUMN IF NOT EXISTS category_slug TEXT;

ALTER TABLE raw_scrape_results
  ADD COLUMN IF NOT EXISTS category_slug TEXT;

ALTER TABLE confirmed_appointments
  ADD COLUMN IF NOT EXISTS category_slug TEXT;

ALTER TABLE inferred_appointments
  ADD COLUMN IF NOT EXISTS category_slug TEXT;

ALTER TABLE appointment_inventory
  ADD COLUMN IF NOT EXISTS category_slug TEXT;

-- Current data contains massage services plus one infrared sauna test service.
-- Keep service_type and service_category unchanged; category_slug is the new
-- broad URL-level category.
UPDATE business_services
SET category_slug = CASE
  WHEN LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name, ''),
      COALESCE(service_type, ''),
      COALESCE(category_text, '')
    )
  ) ~ '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
    THEN 'recovery'
  ELSE 'massage'
END
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE scrape_runs
SET category_slug = CASE
  WHEN LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name, ''),
      COALESCE(service_type, '')
    )
  ) ~ '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
    THEN 'recovery'
  ELSE 'massage'
END
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE raw_scrape_results
SET category_slug = CASE
  WHEN LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name, ''),
      COALESCE(service_type, '')
    )
  ) ~ '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
    THEN 'recovery'
  ELSE 'massage'
END
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE confirmed_appointments
SET category_slug = CASE
  WHEN LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name, ''),
      COALESCE(service_category, '')
    )
  ) ~ '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
    THEN 'recovery'
  ELSE 'massage'
END
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE inferred_appointments
SET category_slug = CASE
  WHEN LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name, ''),
      COALESCE(service_category, '')
    )
  ) ~ '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
    THEN 'recovery'
  ELSE 'massage'
END
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

UPDATE appointment_inventory
SET category_slug = CASE
  WHEN LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name, ''),
      COALESCE(service_category, '')
    )
  ) ~ '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
    THEN 'recovery'
  ELSE 'massage'
END
WHERE category_slug IS NULL
   OR BTRIM(category_slug) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_services_category_slug_fkey'
  ) THEN
    ALTER TABLE business_services
      ADD CONSTRAINT business_services_category_slug_fkey
      FOREIGN KEY (category_slug)
      REFERENCES service_categories(slug)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scrape_runs_category_slug_fkey'
  ) THEN
    ALTER TABLE scrape_runs
      ADD CONSTRAINT scrape_runs_category_slug_fkey
      FOREIGN KEY (category_slug)
      REFERENCES service_categories(slug)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'raw_scrape_results_category_slug_fkey'
  ) THEN
    ALTER TABLE raw_scrape_results
      ADD CONSTRAINT raw_scrape_results_category_slug_fkey
      FOREIGN KEY (category_slug)
      REFERENCES service_categories(slug)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'confirmed_appointments_category_slug_fkey'
  ) THEN
    ALTER TABLE confirmed_appointments
      ADD CONSTRAINT confirmed_appointments_category_slug_fkey
      FOREIGN KEY (category_slug)
      REFERENCES service_categories(slug)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inferred_appointments_category_slug_fkey'
  ) THEN
    ALTER TABLE inferred_appointments
      ADD CONSTRAINT inferred_appointments_category_slug_fkey
      FOREIGN KEY (category_slug)
      REFERENCES service_categories(slug)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointment_inventory_category_slug_fkey'
  ) THEN
    ALTER TABLE appointment_inventory
      ADD CONSTRAINT appointment_inventory_category_slug_fkey
      FOREIGN KEY (category_slug)
      REFERENCES service_categories(slug)
      ON UPDATE CASCADE
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_service_categories_enabled_sort
  ON service_categories(enabled, sort_order, display_name);

CREATE INDEX IF NOT EXISTS idx_business_services_category_slug
  ON business_services(category_slug, business_id)
  WHERE enabled IS NOT FALSE;

CREATE INDEX IF NOT EXISTS idx_scrape_runs_category_slug
  ON scrape_runs(category_slug, run_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_scrape_results_category_slug
  ON raw_scrape_results(category_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_confirmed_appointments_category_slug
  ON confirmed_appointments(category_slug, local_date, local_time);

CREATE INDEX IF NOT EXISTS idx_inferred_appointments_category_slug
  ON inferred_appointments(category_slug, local_date, local_time);

CREATE INDEX IF NOT EXISTS idx_appointment_inventory_category_slug
  ON appointment_inventory(category_slug, searchable, local_date, local_time);

-- A business automatically belongs to every enabled category represented by
-- at least one enabled configured service. This avoids a second, duplicate
-- business-category assignment system.
CREATE OR REPLACE VIEW business_service_categories AS
SELECT DISTINCT
  b.id AS business_numeric_id,
  b.business_id,
  b.business_name,
  sc.slug AS category_slug,
  sc.display_name AS category_display_name,
  sc.sort_order AS category_sort_order
FROM businesses b
INNER JOIN business_services bs
  ON bs.business_id = b.id
INNER JOIN service_categories sc
  ON sc.slug = bs.category_slug
WHERE b.enabled IS NOT FALSE
  AND bs.enabled IS NOT FALSE
  AND sc.enabled IS NOT FALSE;

COMMIT;