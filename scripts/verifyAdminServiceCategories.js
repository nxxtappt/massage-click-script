require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
const BusinessRepository = require(
  "../database/BusinessRepository"
);
const businessManager = require(
  "../businessManager"
);
const serviceCategoryRepository = require(
  "../database/serviceCategoryRepository"
);

function readSource(relativePath) {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      relativePath
    ),
    "utf8"
  );
}

function requireSourceMarker(
  relativePath,
  marker
) {
  const source = readSource(relativePath);

  if (!source.includes(marker)) {
    throw new Error(
      `${relativePath} is missing required Step 6 marker: ${marker}`
    );
  }
}

async function verifyAdminServiceCategories() {
  requireSourceMarker(
    "public/admin.js",
    '"Marketplace Category"'
  );

  requireSourceMarker(
    "public/admin.js",
    '"/api/admin/service-categories"'
  );

  requireSourceMarker(
    "adminRoutes.js",
    'router.get("/service-categories"'
  );

  requireSourceMarker(
    "adminRoutes.js",
    "validateAdminBusinessCategories"
  );

  requireSourceMarker(
    "database/BusinessRepository.js",
    "category_slug = EXCLUDED.category_slug"
  );

  requireSourceMarker(
    "businessManager.js",
    "marketplaceCategory:"
  );

  const categories =
    await serviceCategoryRepository
      .listCategories();

  const expectedCategories = [
    "massage",
    "chiropractic",
    "acupuncture",
    "recovery",
    "skin"
  ];

  const categorySlugs =
    new Set(
      categories.map(
        (category) => category.slug
      )
    );

  const missingCategories =
    expectedCategories.filter(
      (slug) => !categorySlugs.has(slug)
    );

  if (missingCategories.length) {
    throw new Error(
      `Missing categories: ${missingCategories.join(", ")}`
    );
  }

  const dimensions =
    await BusinessRepository
      .getBusinessByName(
        "Dimensions Massage Therapy"
      );

  if (!dimensions) {
    throw new Error(
      "Dimensions Massage Therapy was not found."
    );
  }

  const rawServices =
    await BusinessRepository
      .getServices(dimensions.id);

  const rawSauna = rawServices.find(
    (service) =>
      String(
        service.service_name || ""
      )
        .toLowerCase()
        .includes("infrared sauna")
  );

  if (!rawSauna) {
    throw new Error(
      "Dimensions Infrared Sauna service was not found."
    );
  }

  if (rawSauna.category_slug !== "recovery") {
    throw new Error(
      `Expected raw Infrared Sauna category recovery, received ${rawSauna.category_slug || "(blank)"}.`
    );
  }

  const businessDetails =
    await businessManager
      .getBusinessDetails(
        dimensions.business_id
      );

  const normalizedSauna =
    businessDetails?.services?.find(
      (service) =>
        String(
          service.serviceName || ""
        )
          .toLowerCase()
          .includes("infrared sauna")
    );

  if (!normalizedSauna) {
    throw new Error(
      "Normalized Infrared Sauna service was not found."
    );
  }

  if (
    normalizedSauna.categorySlug !==
    "recovery"
  ) {
    throw new Error(
      `Expected normalized Infrared Sauna category recovery, received ${normalizedSauna.categorySlug || "(blank)"}.`
    );
  }

  console.log(
    "\nAdmin service categories:"
  );

  console.table(
    categories.map((category) => ({
      slug: category.slug,
      displayName:
        category.display_name,
      enabled:
        category.enabled !== false
    }))
  );

  console.log(
    "\nCategory persistence sample:"
  );

  console.table([
    {
      business:
        dimensions.business_name,
      service:
        rawSauna.service_name,
      databaseCategory:
        rawSauna.category_slug,
      adminCategory:
        normalizedSauna.categorySlug
    }
  ]);

  console.log(
    "\nAdmin service category verification passed."
  );
}

verifyAdminServiceCategories()
  .catch((error) => {
    console.error(
      "\nAdmin service category verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });