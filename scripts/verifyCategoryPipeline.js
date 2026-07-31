require("dotenv").config();

const db = require("../db");
const categoryRepository = require(
  "../database/serviceCategoryRepository"
);

const EXPECTED_TRIGGERS = [
  "trg_business_services_category_sync",
  "trg_scrape_runs_category_sync",
  "trg_raw_scrape_results_category_sync",
  "trg_confirmed_appointments_category_sync",
  "trg_inferred_appointments_category_sync",
  "trg_appointment_inventory_category_sync"
];

const CATEGORY_TABLES = [
  "business_services",
  "scrape_runs",
  "raw_scrape_results",
  "confirmed_appointments",
  "inferred_appointments",
  "appointment_inventory"
];

async function verifyCategoryPipeline() {
  const triggers = await db.query(
    `
      SELECT DISTINCT
        event_object_table AS table_name,
        trigger_name
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
        AND trigger_name = ANY($1::text[])
      ORDER BY event_object_table, trigger_name
    `,
    [EXPECTED_TRIGGERS]
  );

  const triggerNames = new Set(
    triggers.rows.map((row) => row.trigger_name)
  );
  const missingTriggers = EXPECTED_TRIGGERS.filter(
    (name) => !triggerNames.has(name)
  );

  const uncategorizedCounts = [];

  for (const tableName of CATEGORY_TABLES) {
    const result = await db.query(
      `
        SELECT COUNT(*)::int AS missing_count
        FROM ${tableName}
        WHERE category_slug IS NULL
           OR BTRIM(category_slug) = ''
      `
    );

    uncategorizedCounts.push({
      tableName,
      missingCount: Number(result.rows[0]?.missing_count || 0)
    });
  }

  const mismatchedInventory = await db.query(`
    SELECT COUNT(*)::int AS mismatch_count
    FROM appointment_inventory inventory
    INNER JOIN business_services service
      ON service.id = inventory.business_service_id
    WHERE inventory.category_slug IS DISTINCT FROM service.category_slug
  `);

  const categoryCounts =
    await categoryRepository.getCategoryBusinessCounts({
      metro: "Austin"
    });

  const massageBusinesses =
    await categoryRepository.getBusinessesByCategory(
      "massage",
      {
        metro: "Austin",
        limit: 1000
      }
    );

  const recoveryBusinesses =
    await categoryRepository.getBusinessesByCategory(
      "recovery",
      {
        metro: "Austin",
        limit: 1000
      }
    );

  const dimensionsRecoveryServices =
    await categoryRepository.getBusinessServicesByCategory(
      "Dimensions Massage Therapy",
      "recovery"
    );

  const dimensionsLocation = await db.query(`
    SELECT
      b.business_name,
      b.raw_json->>'metro' AS stored_metro,
      bl.city AS stored_city,
      bl.address
    FROM businesses b
    LEFT JOIN LATERAL (
      SELECT city, address
      FROM business_locations
      WHERE business_id = b.id
      ORDER BY id ASC
      LIMIT 1
    ) bl ON TRUE
    WHERE LOWER(b.business_name) = LOWER('Dimensions Massage Therapy')
    LIMIT 1
  `);

  console.log("\nCategory synchronization triggers:");
  console.table(triggers.rows);

  console.log("\nUncategorized rows:");
  console.table(uncategorizedCounts);

  console.log("\nAustin category business counts:");
  console.table(categoryCounts);

  console.log("\nDimensions stored metro/location:");
  console.table(dimensionsLocation.rows);

  console.log("\nCategory query summary:");
  console.table([
    {
      category: "massage",
      businessesReturned: massageBusinesses.length
    },
    {
      category: "recovery",
      businessesReturned: recoveryBusinesses.length
    }
  ]);

  console.log("\nDimensions Recovery services:");
  console.table(
    dimensionsRecoveryServices.map((service) => ({
      id: service.id,
      serviceName: service.service_name,
      serviceType: service.service_type,
      categorySlug: service.category_slug
    }))
  );

  if (missingTriggers.length) {
    throw new Error(
      `Missing category synchronization trigger(s): ${missingTriggers.join(", ")}`
    );
  }

  const tablesWithMissingCategories = uncategorizedCounts.filter(
    (row) => row.missingCount > 0
  );

  if (tablesWithMissingCategories.length) {
    throw new Error(
      `Uncategorized rows remain in: ${tablesWithMissingCategories
        .map((row) => row.tableName)
        .join(", ")}`
    );
  }

  const mismatchCount = Number(
    mismatchedInventory.rows[0]?.mismatch_count || 0
  );

  if (mismatchCount > 0) {
    throw new Error(
      `${mismatchCount} inventory row(s) disagree with their business service category.`
    );
  }

  const categoryCountBySlug = new Map(
    categoryCounts.map((category) => [
      category.slug,
      Number(category.business_count || 0)
    ])
  );

  if ((categoryCountBySlug.get("recovery") || 0) < 1) {
    throw new Error(
      "Austin Recovery business count did not include Dimensions from its address."
    );
  }

  const recoveryNames = new Set(
    recoveryBusinesses.map((business) => business.business_name)
  );

  if (!recoveryNames.has("Dimensions Massage Therapy")) {
    throw new Error(
      "Dimensions Massage Therapy was not returned by the Recovery business query."
    );
  }

  if (
    !dimensionsRecoveryServices.some((service) =>
      String(service.service_name || "")
        .toLowerCase()
        .includes("infrared sauna")
    )
  ) {
    throw new Error(
      "Dimensions Infrared Sauna was not returned as a Recovery service."
    );
  }

  console.log("\nCategory pipeline verification passed.");
}

verifyCategoryPipeline()
  .catch((error) => {
    console.error("\nCategory pipeline verification failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });