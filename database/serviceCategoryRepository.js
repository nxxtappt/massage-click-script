const db = require("../db");

function normalizeCategorySlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function toPositiveInteger(value, fallback, maximum = 1000) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

function normalizeSearchText(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMetroQuery(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function listCategories(options = {}) {
  const includeDisabled = options.includeDisabled === true;

  const result = await db.query(
    `
      SELECT
        slug,
        display_name,
        description,
        search_aliases,
        enabled,
        sort_order,
        created_at,
        updated_at
      FROM service_categories
      WHERE ($1::boolean = TRUE OR enabled IS NOT FALSE)
      ORDER BY sort_order ASC, display_name ASC
    `,
    [includeDisabled]
  );

  return result.rows;
}

async function getCategoryBySlug(slug, options = {}) {
  const normalizedSlug = normalizeCategorySlug(slug);

  if (!normalizedSlug) {
    return null;
  }

  const includeDisabled = options.includeDisabled === true;

  const result = await db.query(
    `
      SELECT
        slug,
        display_name,
        description,
        search_aliases,
        enabled,
        sort_order,
        created_at,
        updated_at
      FROM service_categories
      WHERE slug = $1
        AND ($2::boolean = TRUE OR enabled IS NOT FALSE)
      LIMIT 1
    `,
    [normalizedSlug, includeDisabled]
  );

  return result.rows[0] || null;
}

async function inferCategoryFromText(
  searchText = "",
  options = {}
) {
  const normalizedText =
    normalizeSearchText(searchText);

  if (!normalizedText) {
    return null;
  }

  const categories = await listCategories({
    includeDisabled:
      options.includeDisabled === true
  });

  const paddedText =
    ` ${normalizedText} `;

  const candidates = [];

  for (const category of categories) {
    const aliases = [
      category.slug,
      category.display_name,
      ...(
        Array.isArray(category.search_aliases)
          ? category.search_aliases
          : []
      )
    ];

    for (const alias of aliases) {
      const normalizedAlias =
        normalizeSearchText(alias);

      if (!normalizedAlias) {
        continue;
      }

      candidates.push({
        category,
        alias: String(alias),
        normalizedAlias
      });
    }
  }

  candidates.sort(
    (left, right) =>
      right.normalizedAlias.length -
      left.normalizedAlias.length
  );

  const match = candidates.find(
    (candidate) =>
      paddedText.includes(
        ` ${candidate.normalizedAlias} `
      )
  );

  if (!match) {
    return null;
  }

  return {
    category: match.category,
    categorySlug:
      match.category.slug,
    matchedAlias:
      match.alias,
    normalizedAlias:
      match.normalizedAlias
  };
}

async function requireCategory(slug, options = {}) {
  const category = await getCategoryBySlug(slug, options);

  if (!category) {
    throw new Error(
      `Unknown or disabled service category: ${normalizeCategorySlug(slug) || slug}`
    );
  }

  return category;
}

async function isEnabledCategory(slug) {
  return Boolean(await getCategoryBySlug(slug));
}

async function getBusinessCategories(idOrBusinessName) {
  const value = String(idOrBusinessName || "").trim();

  if (!value) {
    return [];
  }

  const result = await db.query(
    `
      SELECT
        bsc.category_slug AS slug,
        bsc.category_display_name AS display_name,
        bsc.category_sort_order AS sort_order
      FROM business_service_categories bsc
      WHERE bsc.business_numeric_id::text = $1
         OR LOWER(bsc.business_id) = LOWER($1)
         OR LOWER(bsc.business_name) = LOWER($1)
      ORDER BY
        bsc.category_sort_order ASC,
        bsc.category_display_name ASC
    `,
    [value]
  );

  return result.rows;
}

async function getCategoryBusinessCounts(options = {}) {
  const metro = normalizeMetroQuery(options.metro);

  const result = await db.query(
    `
      SELECT
        sc.slug,
        sc.display_name,
        sc.sort_order,
        COUNT(DISTINCT b.id) FILTER (
          WHERE
            $1 = ''
            OR BTRIM(
              REGEXP_REPLACE(
                LOWER(
                  CONCAT_WS(
                    ' ',
                    COALESCE(b.raw_json->>'metro', ''),
                    COALESCE(bl.city, ''),
                    COALESCE(bl.address, '')
                  )
                ),
                '[^a-z0-9]+',
                ' ',
                'g'
              )
            ) ~ ('(^| )' || $1 || '( |$)')
        )::int AS business_count
      FROM service_categories sc
      LEFT JOIN business_services bs
        ON bs.category_slug = sc.slug
        AND bs.enabled IS NOT FALSE
      LEFT JOIN businesses b
        ON b.id = bs.business_id
        AND b.enabled IS NOT FALSE
      LEFT JOIN LATERAL (
        SELECT city, address
        FROM business_locations
        WHERE business_id = b.id
        ORDER BY id ASC
        LIMIT 1
      ) bl ON TRUE
      WHERE sc.enabled IS NOT FALSE
      GROUP BY sc.slug, sc.display_name, sc.sort_order
      ORDER BY sc.sort_order ASC, sc.display_name ASC
    `,
    [metro]
  );

  return result.rows;
}

async function getBusinessServicesByCategory(
  idOrBusinessName,
  categorySlug = "",
  options = {}
) {
  const businessValue = String(idOrBusinessName || "").trim();

  if (!businessValue) {
    return [];
  }

  const normalizedCategory = normalizeCategorySlug(categorySlug);
  const includeDisabledServices = options.includeDisabledServices === true;

  if (normalizedCategory) {
    await requireCategory(normalizedCategory, {
      includeDisabled: options.includeDisabledCategory === true
    });
  }

  const result = await db.query(
    `
      WITH selected_business AS (
        SELECT id
        FROM businesses
        WHERE id::text = $1
           OR LOWER(business_id) = LOWER($1)
           OR LOWER(business_name) = LOWER($1)
           OR LOWER(COALESCE(display_name, '')) = LOWER($1)
        LIMIT 1
      )
      SELECT
        bs.*,
        sc.display_name AS category_display_name,
        sc.sort_order AS category_sort_order
      FROM business_services bs
      INNER JOIN selected_business sb
        ON sb.id = bs.business_id
      INNER JOIN service_categories sc
        ON sc.slug = bs.category_slug
      WHERE ($2 = '' OR bs.category_slug = $2)
        AND ($3::boolean = TRUE OR bs.enabled IS NOT FALSE)
      ORDER BY
        sc.sort_order ASC,
        bs.service_name ASC,
        bs.duration_minutes ASC NULLS LAST,
        bs.id ASC
    `,
    [
      businessValue,
      normalizedCategory,
      includeDisabledServices
    ]
  );

  return result.rows;
}

async function getBusinessesByCategory(categorySlug, options = {}) {
  const category = await requireCategory(categorySlug, {
    includeDisabled: options.includeDisabledCategory === true
  });

  const metro = normalizeMetroQuery(options.metro);
  const includeDisabledBusinesses =
    options.includeDisabledBusinesses === true;
  const limit = toPositiveInteger(options.limit, 100, 1000);

  const result = await db.query(
    `
      SELECT
        b.id,
        b.business_id,
        b.business_name,
        b.display_name,
        b.business_category,
        b.platform,
        b.booking_url,
        b.website,
        b.phone,
        b.email,
        b.verification_status,
        b.claimed,
        b.enabled,
        b.priority,
        b.discovery_status,
        b.logo_url,
        b.logo_alt,
        b.raw_json,
        b.updated_at,

        bl.address,
        bl.city,
        bl.state,
        bl.postal_code,
        bl.latitude,
        bl.longitude,
        bl.timezone,

        (
          SELECT COUNT(*)::int
          FROM business_services service_count
          WHERE service_count.business_id = b.id
            AND service_count.enabled IS NOT FALSE
        ) AS service_count,

        (
          SELECT COALESCE(
            JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'slug', category_rows.category_slug,
                'displayName', category_rows.category_display_name,
                'sortOrder', category_rows.category_sort_order
              )
              ORDER BY
                category_rows.category_sort_order ASC,
                category_rows.category_display_name ASC
            ),
            '[]'::jsonb
          )
          FROM business_service_categories category_rows
          WHERE category_rows.business_numeric_id = b.id
        ) AS categories

      FROM businesses b
      INNER JOIN business_service_categories requested_category
        ON requested_category.business_numeric_id = b.id
       AND requested_category.category_slug = $1

      LEFT JOIN LATERAL (
        SELECT
          address,
          city,
          state,
          postal_code,
          latitude,
          longitude,
          timezone
        FROM business_locations
        WHERE business_id = b.id
        ORDER BY id ASC
        LIMIT 1
      ) bl ON TRUE

      WHERE ($2::boolean = TRUE OR b.enabled IS NOT FALSE)
        AND (
          $3 = ''
          OR BTRIM(
            REGEXP_REPLACE(
              LOWER(
                CONCAT_WS(
                  ' ',
                  COALESCE(b.raw_json->>'metro', ''),
                  COALESCE(bl.city, ''),
                  COALESCE(bl.address, '')
                )
              ),
              '[^a-z0-9]+',
              ' ',
              'g'
            )
          ) ~ ('(^| )' || $3 || '( |$)')
        )

      ORDER BY
        CASE LOWER(COALESCE(b.priority, ''))
          WHEN 'high' THEN 0
          WHEN 'medium' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
          ELSE 4
        END,
        b.business_name ASC

      LIMIT $4
    `,
    [
      category.slug,
      includeDisabledBusinesses,
      metro,
      limit
    ]
  );

  return result.rows;
}

async function assignBusinessServiceCategory(
  businessServiceId,
  categorySlug,
  options = {}
) {
  const serviceId = Number(businessServiceId);

  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    throw new Error("A valid business service ID is required.");
  }

  const category = await requireCategory(categorySlug, {
    includeDisabled: options.includeDisabledCategory === true
  });

  const result = await db.query(
    `
      UPDATE business_services
      SET
        category_slug = $2,
        raw_json = JSONB_SET(
          COALESCE(raw_json, '{}'::jsonb),
          '{categorySlug}',
          TO_JSONB($2::text),
          TRUE
        ),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [serviceId, category.slug]
  );

  if (!result.rows[0]) {
    throw new Error(`Business service not found: ${serviceId}`);
  }

  return result.rows[0];
}

async function assignBusinessServicesCategory(
  businessServiceIds,
  categorySlug,
  options = {}
) {
  const serviceIds = [
    ...new Set(
      (Array.isArray(businessServiceIds) ? businessServiceIds : [])
        .map(Number)
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  ];

  if (!serviceIds.length) {
    return [];
  }

  const category = await requireCategory(categorySlug, {
    includeDisabled: options.includeDisabledCategory === true
  });

  const result = await db.query(
    `
      UPDATE business_services
      SET
        category_slug = $2,
        raw_json = JSONB_SET(
          COALESCE(raw_json, '{}'::jsonb),
          '{categorySlug}',
          TO_JSONB($2::text),
          TRUE
        ),
        updated_at = NOW()
      WHERE id = ANY($1::bigint[])
      RETURNING *
    `,
    [serviceIds, category.slug]
  );

  return result.rows;
}

module.exports = {
  normalizeCategorySlug,
  normalizeSearchText,
  normalizeMetroQuery,
  listCategories,
  inferCategoryFromText,
  getCategoryBySlug,
  requireCategory,
  isEnabledCategory,
  getBusinessCategories,
  getCategoryBusinessCounts,
  getBusinessServicesByCategory,
  getBusinessesByCategory,
  assignBusinessServiceCategory,
  assignBusinessServicesCategory
};