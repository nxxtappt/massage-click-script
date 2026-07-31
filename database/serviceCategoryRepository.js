const db = require("../db");

function normalizeCategorySlug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function listCategories(options = {}) {
  const includeDisabled = options.includeDisabled === true;

  const result = await db.query(
    `
      SELECT
        slug,
        display_name,
        description,
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
  const metro = String(options.metro || "").trim();

  const result = await db.query(
    `
      SELECT
        sc.slug,
        sc.display_name,
        sc.sort_order,
        COUNT(DISTINCT b.id) FILTER (
          WHERE
            $1 = ''
            OR LOWER(
              COALESCE(NULLIF(b.raw_json->>'metro', ''), bl.city, '')
            ) = LOWER($1)
        )::int AS business_count
      FROM service_categories sc
      LEFT JOIN business_services bs
        ON bs.category_slug = sc.slug
        AND bs.enabled IS NOT FALSE
      LEFT JOIN businesses b
        ON b.id = bs.business_id
        AND b.enabled IS NOT FALSE
      LEFT JOIN LATERAL (
        SELECT city
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

module.exports = {
  normalizeCategorySlug,
  listCategories,
  getCategoryBySlug,
  isEnabledCategory,
  getBusinessCategories,
  getCategoryBusinessCounts
};