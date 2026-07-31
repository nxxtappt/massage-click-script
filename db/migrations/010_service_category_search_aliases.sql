-- NextAppt service category search aliases
-- Migration 010
-- Purpose:
--   1. Keep broad marketplace category recognition data-driven.
--   2. Allow /api/search and /api/ai/search to infer a category from free text.
--   3. Preserve detailed service_type filtering separately from marketplace category.
-- Safe to run more than once.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.service_categories') IS NULL THEN
    RAISE EXCEPTION
      'service_categories is missing. Run 008_service_categories.sql first.';
  END IF;
END
$$;

ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS search_aliases TEXT[]
  NOT NULL
  DEFAULT ARRAY[]::TEXT[];

UPDATE service_categories
SET
  search_aliases = ARRAY[
    'massage',
    'massages',
    'massage therapy',
    'massage therapist',
    'massage therapists',
    'bodywork'
  ]::TEXT[],
  updated_at = NOW()
WHERE slug = 'massage';

UPDATE service_categories
SET
  search_aliases = ARRAY[
    'chiropractic',
    'chiropractor',
    'chiropractors',
    'chiro',
    'chiropractic adjustment',
    'spinal adjustment',
    'spinal decompression'
  ]::TEXT[],
  updated_at = NOW()
WHERE slug = 'chiropractic';

UPDATE service_categories
SET
  search_aliases = ARRAY[
    'acupuncture',
    'acupuncturist',
    'acupuncturists',
    'electroacupuncture',
    'electro acupuncture'
  ]::TEXT[],
  updated_at = NOW()
WHERE slug = 'acupuncture';

UPDATE service_categories
SET
  search_aliases = ARRAY[
    'recovery',
    'infrared sauna',
    'sauna',
    'cold plunge',
    'cryotherapy',
    'compression therapy',
    'red light therapy',
    'stretch therapy',
    'assisted stretching'
  ]::TEXT[],
  updated_at = NOW()
WHERE slug = 'recovery';

UPDATE service_categories
SET
  search_aliases = ARRAY[
    'skin',
    'skin care',
    'skincare',
    'facial',
    'facials',
    'esthetician',
    'estheticians',
    'esthetics',
    'hydrafacial',
    'dermaplaning',
    'microdermabrasion',
    'chemical peel',
    'microneedling'
  ]::TEXT[],
  updated_at = NOW()
WHERE slug = 'skin';

CREATE INDEX IF NOT EXISTS idx_service_categories_search_aliases
  ON service_categories
  USING GIN (search_aliases);

COMMIT;