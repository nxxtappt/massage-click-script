require("dotenv").config();

const db = require("../db");
const categoryRepository = require("../database/serviceCategoryRepository");

const REQUIRED_CATEGORIES = [
  "massage",
  "chiropractic",
  "acupuncture",
  "recovery",
  "skin"
];

async function verifyServiceCategories() {
  const categories = await categoryRepository.listCategories({
    includeDisabled: true
  });

  const categorySlugs = new Set(categories.map((category) => category.slug));
  const missingCategories = REQUIRED_CATEGORIES.filter(
    (slug) => !categorySlugs.has(slug)
  );

  const serviceCounts = await db.query(`
    SELECT
      category_slug,
      COUNT(*)::int AS service_count,
      COUNT(DISTINCT business_id)::int AS business_count
    FROM business_services
    GROUP BY category_slug
    ORDER BY category_slug NULLS LAST
  `);

  const uncategorizedServices = await db.query(`
    SELECT
      id,
      business_id,
      service_name,
      service_type,
      category_text
    FROM business_services
    WHERE category_slug IS NULL
       OR BTRIM(category_slug) = ''
    ORDER BY id
  `);

  const inventoryCounts = await db.query(`
    SELECT
      category_slug,
      COUNT(*)::int AS appointment_count
    FROM appointment_inventory
    GROUP BY category_slug
    ORDER BY category_slug NULLS LAST
  `);

  const dimensionsCategories =
    await categoryRepository.getBusinessCategories(
      "Dimensions Massage Therapy"
    );

  console.log("\nService categories:");
  console.table(
    categories.map((category) => ({
      slug: category.slug,
      displayName: category.display_name,
      enabled: category.enabled,
      sortOrder: category.sort_order
    }))
  );

  console.log("\nConfigured business services by category:");
  console.table(serviceCounts.rows);

  console.log("\nAppointment inventory by category:");
  console.table(inventoryCounts.rows);

  console.log("\nDimensions Massage Therapy categories:");
  console.table(dimensionsCategories);

  if (missingCategories.length) {
    throw new Error(
      `Missing required categories: ${missingCategories.join(", ")}`
    );
  }

  if (uncategorizedServices.rows.length) {
    console.error("\nUncategorized business services:");
    console.table(uncategorizedServices.rows);

    throw new Error(
      `${uncategorizedServices.rows.length} business service(s) are missing category_slug.`
    );
  }

  const dimensionsSlugs = new Set(
    dimensionsCategories.map((category) => category.slug)
  );

  if (!dimensionsSlugs.has("massage")) {
    throw new Error(
      "Dimensions Massage Therapy was not assigned to the Massage category."
    );
  }

  if (!dimensionsSlugs.has("recovery")) {
    throw new Error(
      "Dimensions Massage Therapy was not assigned to the Recovery category."
    );
  }

  console.log("\nService category foundation verification passed.");
}

verifyServiceCategories()
  .catch((error) => {
    console.error("\nService category verification failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });