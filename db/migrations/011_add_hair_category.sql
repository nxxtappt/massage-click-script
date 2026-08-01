-- NextAppt Hair marketplace category
-- Migration 011
--
-- Adds Hair as a first-class marketplace category and updates automatic
-- service classification so salon services are categorized as Hair.
--
-- Safe to run more than once.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.service_categories') IS NULL THEN
    RAISE EXCEPTION
      'service_categories is missing. Run migration 008 first.';
  END IF;

  IF to_regclass('public.business_services') IS NULL THEN
    RAISE EXCEPTION
      'business_services is missing. Run the business schema migrations first.';
  END IF;
END
$$;

ALTER TABLE service_categories
  ADD COLUMN IF NOT EXISTS search_aliases TEXT[]
  NOT NULL
  DEFAULT ARRAY[]::TEXT[];

INSERT INTO service_categories (
  slug,
  display_name,
  description,
  enabled,
  sort_order,
  search_aliases,
  created_at,
  updated_at
)
VALUES (
  'hair',
  'Hair',
  'Haircuts, styling, color, treatments, barbering, and salon services.',
  TRUE,
  60,
  ARRAY[
    'hair',
    'hair salon',
    'salon',
    'hairstylist',
    'hair stylist',
    'haircut',
    'hair cut',
    'barber',
    'barbershop',
    'blowout',
    'blow dry',
    'balayage',
    'hair color',
    'hair coloring',
    'highlights',
    'root touch up',
    'silk press',
    'braids',
    'locs',
    'hair extensions',
    'keratin treatment',
    'updo'
  ]::TEXT[],
  NOW(),
  NOW()
)
ON CONFLICT (slug)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  enabled = TRUE,
  sort_order = EXCLUDED.sort_order,
  search_aliases = EXCLUDED.search_aliases,
  updated_at = NOW();

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

    RAISE EXCEPTION
      'Unknown service category slug: %',
      candidate_slug;
  END IF;

  searchable_text := LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name_value, ''),
      COALESCE(service_type_value, ''),
      COALESCE(category_text_value, '')
    )
  );

  IF searchable_text ~
       '(infrared|far infrared).*sauna|sauna.*(infrared|far infrared)'
     OR searchable_text ~ 'red[ -]?light therapy'
     OR searchable_text ~ 'cryotherapy'
     OR searchable_text ~ 'compression therapy'
     OR searchable_text ~ 'cold plunge' THEN
    candidate_slug := 'recovery';

  ELSIF searchable_text ~
    'chiropract|chiro adjustment|spinal adjustment|spinal decompression' THEN
    candidate_slug := 'chiropractic';

  ELSIF searchable_text ~
    'acupuncture|electroacupuncture' THEN
    candidate_slug := 'acupuncture';

  ELSIF searchable_text ~
    'hair[ -]?cut|women.?s cut|men.?s cut|kid.?s cut|children.?s cut|bang trim|beard trim|barber|blow[ -]?out|blow[ -]?dry|balayage|ombr[eé]|highlights?|lowlights?|hair colo(u)?r|hair coloring|color retouch|root touch[ -]?up|all over color|hair gloss|hair toner|keratin|brazilian blowout|hair extensions?|braids?|box braids|locs?|dreadlocks?|silk press|updo|shampoo and style|wash and style|hair treatment|scalp treatment' THEN
    candidate_slug := 'hair';

  ELSIF searchable_text ~
    'hydrafacial|facial|dermaplan|microdermabrasion|chemical peel|microneedl' THEN
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

  normalized_fallback :=
    normalize_service_category_slug(
      fallback_slug
    );

  IF normalized_fallback IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM service_categories
       WHERE slug = normalized_fallback
     ) THEN
    RETURN normalized_fallback;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM service_categories
    WHERE slug = 'massage'
  ) THEN
    RETURN 'massage';
  END IF;

  SELECT slug
  INTO candidate_slug
  FROM service_categories
  WHERE enabled IS NOT FALSE
  ORDER BY sort_order ASC, slug ASC
  LIMIT 1;

  RETURN candidate_slug;
END;
$function$;

-- Reclassify existing likely salon services that inherited the historical
-- Massage fallback. Explicitly categorized services are not changed.
UPDATE business_services
SET
  category_slug = 'hair',
  raw_json = JSONB_SET(
    COALESCE(raw_json, '{}'::jsonb),
    '{categorySlug}',
    TO_JSONB('hair'::TEXT),
    TRUE
  ),
  updated_at = NOW()
WHERE
  COALESCE(category_slug, 'massage') = 'massage'
  AND COALESCE(
    NULLIF(BTRIM(raw_json->>'categorySlug'), ''),
    NULLIF(BTRIM(raw_json->>'category_slug'), ''),
    NULLIF(BTRIM(raw_json->>'marketplaceCategory'), ''),
    NULLIF(BTRIM(raw_json->>'marketplace_category'), '')
  ) IS NULL
  AND LOWER(
    CONCAT_WS(
      ' ',
      COALESCE(service_name, ''),
      COALESCE(service_type, ''),
      COALESCE(category_text, '')
    )
  ) ~
    'hair[ -]?cut|women.?s cut|men.?s cut|kid.?s cut|children.?s cut|bang trim|beard trim|barber|blow[ -]?out|blow[ -]?dry|balayage|ombr[eé]|highlights?|lowlights?|hair colo(u)?r|hair coloring|color retouch|root touch[ -]?up|all over color|hair gloss|hair toner|keratin|brazilian blowout|hair extensions?|braids?|box braids|locs?|dreadlocks?|silk press|updo|shampoo and style|wash and style|hair treatment|scalp treatment';

COMMIT;