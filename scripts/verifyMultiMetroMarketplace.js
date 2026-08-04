require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
const {
  listMarketplaceMetros,
  getMarketplaceMetro,
  matchesMarketplaceMetro
} = require("../marketplaceMetros");
const serviceCategoryRepository = require(
  "../database/serviceCategoryRepository"
);

function requireSourceMarker(
  relativePath,
  marker
) {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      relativePath
    ),
    "utf8"
  );

  if (!source.includes(marker)) {
    throw new Error(
      `${relativePath} is missing: ${marker}`
    );
  }
}

function expectMetroMatch(
  record,
  metroSlug,
  expected
) {
  const actual =
    matchesMarketplaceMetro(
      record,
      metroSlug
    );

  if (actual !== expected) {
    throw new Error(
      `Expected ${metroSlug} match=${expected}, received ${actual} for ${JSON.stringify(record)}.`
    );
  }
}

async function verifyMultiMetroMarketplace() {
  requireSourceMarker(
    "austinSearchRoutes.js",
    "buildMarketplacePageContext"
  );

  requireSourceMarker(
    "server.js",
    'app.get("/api/marketplace-metros"'
  );

  requireSourceMarker(
    "server.js",
    "matchesMarketplaceMetro"
  );

  requireSourceMarker(
    "public/app.js",
    "function renderMetroNavigation"
  );

  requireSourceMarker(
    "public/app.js",
    'params.set(\n      "metro"'
  );

  requireSourceMarker(
    "public/index.html",
    'id="metroNavigation"'
  );

  requireSourceMarker(
    "public/styles.css",
    "/* NEXTAPPT METRO NAVIGATION START */"
  );

  requireSourceMarker(
    "seoRoutes.js",
    "listMarketplaceMetros"
  );

  const metros =
    listMarketplaceMetros();

  const expectedSlugs = [
    "austin",
    "miami",
    "san-antonio",
    "dallas-fort-worth",
    "houston"
  ];

  const actualSlugs =
    metros.map(
      (metro) =>
        metro.slug
    );

  for (
    const expectedSlug
    of expectedSlugs
  ) {
    if (
      !actualSlugs.includes(
        expectedSlug
      )
    ) {
      throw new Error(
        `Missing marketplace metro: ${expectedSlug}`
      );
    }
  }

  expectMetroMatch(
    {
      city: "Miami",
      state: "FL"
    },
    "miami",
    true
  );

  expectMetroMatch(
    {
      city: "Fort Worth",
      state: "TX"
    },
    "dallas-fort-worth",
    true
  );

  expectMetroMatch(
    {
      address:
        "123 Main Street, San Antonio, TX"
    },
    "san-antonio",
    true
  );

  expectMetroMatch(
    {
      city: "Houston",
      state: "TX"
    },
    "austin",
    false
  );

  const categoryRows =
    await serviceCategoryRepository
      .listCategories();

  const categorySlugs =
    new Set(
      categoryRows.map(
        (category) =>
          category.slug
      )
    );

  if (
    !categorySlugs.has(
      "hair"
    )
  ) {
    throw new Error(
      "Hair is missing. Run migration 011 before verifying multi-metro routes."
    );
  }

  const summary = [];

  for (const metro of metros) {
    const counts =
      await serviceCategoryRepository
        .getCategoryBusinessCounts({
          metroTerms:
            metro.searchTerms
        });

    const populatedCategories =
      counts.filter(
        (category) =>
          Number(
            category.business_count ||
            0
          ) > 0
      );

    summary.push({
      route:
        `/${metro.slug}`,
      metro:
        metro.name,
      timezone:
        metro.timezone,
      categoryRoutes:
        categoryRows.length,
      populatedCategories:
        populatedCategories.length,
      populatedSlugs:
        populatedCategories
          .map(
            (category) =>
              category.slug
          )
          .join(", ") ||
        "(none yet)"
    });
  }

  console.log(
    "\nMarketplace metros:"
  );

  console.table(summary);

  console.log(
    "\nEvery enabled category is a valid route under every listed metro. Empty metro/category combinations remain valid and noindex until businesses are added."
  );

  console.log(
    "\nMulti-metro marketplace verification passed."
  );
}

verifyMultiMetroMarketplace()
  .catch((error) => {
    console.error(
      "\nMulti-metro marketplace verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });