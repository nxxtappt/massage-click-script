require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
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
      `${relativePath} is missing required Step 5 marker: ${marker}`
    );
  }
}

async function verifyCategoryNavigation() {
  requireSourceMarker(
    "public/index.html",
    'id="categoryNavigation"'
  );

  requireSourceMarker(
    "public/index.html",
    'id="categoryNavigationStatus"'
  );

  requireSourceMarker(
    "public/app.js",
    "async function loadCategoryNavigation()"
  );

  requireSourceMarker(
    "public/app.js",
    "getCategoryEmptyStateCopy()"
  );

  requireSourceMarker(
    "public/app.js",
    "/api/service-categories?metro="
  );

  requireSourceMarker(
    "public/styles.css",
    "/* NEXTAPPT CATEGORY NAVIGATION START */"
  );

  requireSourceMarker(
    "public/styles.css",
    ".category-nav-link.is-active"
  );

  const categoryCounts =
    await serviceCategoryRepository
      .getCategoryBusinessCounts({
        metro: "Austin"
      });

  const expectedCategories = [
    "massage",
    "chiropractic",
    "acupuncture",
    "recovery",
    "skin"
  ];

  const categoryBySlug = new Map(
    categoryCounts.map((category) => [
      category.slug,
      category
    ])
  );

  const missingCategories =
    expectedCategories.filter(
      (slug) => !categoryBySlug.has(slug)
    );

  if (missingCategories.length) {
    throw new Error(
      `Missing configured categories: ${missingCategories.join(", ")}`
    );
  }

  if (
    Number(
      categoryBySlug.get("massage")
        ?.business_count || 0
    ) <= 0
  ) {
    throw new Error(
      "Massage should display as an available Austin category."
    );
  }

  if (
    Number(
      categoryBySlug.get("recovery")
        ?.business_count || 0
    ) <= 0
  ) {
    throw new Error(
      "Recovery should display as an available Austin category."
    );
  }

  console.log(
    "\nAustin category navigation data:"
  );

  console.table(
    categoryCounts.map((category) => ({
      slug: category.slug,
      displayName:
        category.display_name,
      businessCount:
        Number(
          category.business_count || 0
        ),
      navigationLabel:
        Number(
          category.business_count || 0
        ) > 0
          ? "Available"
          : "Coming soon"
    }))
  );

  console.log(
    "\nCategory navigation verification passed."
  );
}

verifyCategoryNavigation()
  .catch((error) => {
    console.error(
      "\nCategory navigation verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });