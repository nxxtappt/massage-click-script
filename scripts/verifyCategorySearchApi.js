require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
const inventoryManager = require("../inventoryManager");
const inventoryRepository = require(
  "../database/inventoryRepository"
);
const serviceCategoryRepository = require(
  "../database/serviceCategoryRepository"
);

function requireSourceMarker(relativePath, marker) {
  const absolutePath = path.join(
    process.cwd(),
    relativePath
  );

  const source = fs.readFileSync(absolutePath, "utf8");

  if (!source.includes(marker)) {
    throw new Error(
      `${relativePath} is missing required Step 3 marker: ${marker}`
    );
  }
}

function assertRowsUseCategory(
  rows,
  expectedCategory,
  fieldNames
) {
  for (const row of rows) {
    const actual = fieldNames
      .map((fieldName) => row[fieldName])
      .find((value) => value !== undefined && value !== null);

    if (
      String(actual || "").toLowerCase() !==
      expectedCategory.toLowerCase()
    ) {
      throw new Error(
        `Expected category ${expectedCategory}, received ${actual || "(blank)"}.`
      );
    }
  }
}

async function verifyCategorySearchApi() {
  requireSourceMarker(
    "server.js",
    'app.get("/api/service-categories"'
  );
  requireSourceMarker(
    "server.js",
    "categorySlug: categorySelection.categorySlug"
  );
  requireSourceMarker(
    "inventoryManager.js",
    "marketplaceCategory: categorySlug"
  );
  requireSourceMarker(
    "database/inventoryRepository.js",
    'LOWER(category_slug) = LOWER(?)'
  );

  const configuredCategories =
    await serviceCategoryRepository.listCategories();

  const categorySlugs = configuredCategories.map(
    (category) => category.slug
  );

  const rawMassageInventory =
    await inventoryRepository.getInventory({
      categorySlug: "massage",
      showPast: true,
      includeInactive: true,
      includeConfirmed: true,
      includeInferred: true,
      limit: 50
    });

  if (!rawMassageInventory.length) {
    throw new Error(
      "No Massage inventory rows were returned for the category filter test."
    );
  }

  assertRowsUseCategory(
    rawMassageInventory,
    "massage",
    ["category_slug", "categorySlug"]
  );

  const normalizedMassageInventory =
    await inventoryManager.getInventory({
      categorySlug: "massage",
      showPast: true,
      includeInactive: true,
      includeConfirmed: true,
      includeInferred: true,
      limit: 50
    });

  if (!normalizedMassageInventory.length) {
    throw new Error(
      "InventoryManager returned no Massage rows for the category filter test."
    );
  }

  assertRowsUseCategory(
    normalizedMassageInventory,
    "massage",
    ["categorySlug", "category_slug"]
  );

  const recoveryBusinesses =
    await serviceCategoryRepository.getBusinessesByCategory(
      "recovery",
      {
        includeDisabledBusinesses: true,
        limit: 1000
      }
    );

  const dimensionsRecoveryBusiness =
    recoveryBusinesses.find(
      (business) =>
        business.business_name ===
        "Dimensions Massage Therapy"
    );

  if (!dimensionsRecoveryBusiness) {
    throw new Error(
      "Dimensions Massage Therapy was not returned by the Recovery business query."
    );
  }

  const invalidCategory =
    await serviceCategoryRepository.getCategoryBySlug(
      "not-a-real-category"
    );

  if (invalidCategory) {
    throw new Error(
      "An invalid service category unexpectedly resolved."
    );
  }

  const inventoryCounts = await db.query(`
    SELECT
      category_slug,
      COUNT(*)::int AS appointment_count
    FROM appointment_inventory
    GROUP BY category_slug
    ORDER BY category_slug
  `);

  console.log("\nEnabled categories:");
  console.table(
    configuredCategories.map((category) => ({
      slug: category.slug,
      displayName: category.display_name,
      enabled: category.enabled
    }))
  );

  console.log("\nInventory rows by category:");
  console.table(inventoryCounts.rows);

  console.log("\nStep 3 query checks:");
  console.table([
    {
      check: "Configured categories",
      result: categorySlugs.join(", ")
    },
    {
      check: "Raw Massage inventory sample",
      result: rawMassageInventory.length
    },
    {
      check: "Normalized Massage inventory sample",
      result: normalizedMassageInventory.length
    },
    {
      check: "Recovery businesses",
      result: recoveryBusinesses.length
    },
    {
      check: "Dimensions in Recovery",
      result: "yes"
    },
    {
      check: "Invalid category rejected",
      result: "yes"
    }
  ]);

  console.log(
    "\nCategory search API verification passed."
  );
}

verifyCategorySearchApi()
  .catch((error) => {
    console.error(
      "\nCategory search API verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });