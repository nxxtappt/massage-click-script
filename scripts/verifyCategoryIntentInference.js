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
      `${relativePath} is missing required Step 7 marker: ${marker}`
    );
  }
}

async function expectCategory(
  query,
  expectedSlug
) {
  const result =
    await serviceCategoryRepository
      .inferCategoryFromText(query);

  if (!result) {
    throw new Error(
      `No category was inferred for: ${query}`
    );
  }

  if (
    result.categorySlug !==
    expectedSlug
  ) {
    throw new Error(
      `Expected ${expectedSlug} for "${query}", received ${result.categorySlug}.`
    );
  }

  return {
    query,
    categorySlug:
      result.categorySlug,
    matchedAlias:
      result.matchedAlias
  };
}

async function verifyCategoryIntentInference() {
  requireSourceMarker(
    "database/serviceCategoryRepository.js",
    "async function inferCategoryFromText"
  );

  requireSourceMarker(
    "server.js",
    'source: "inferred"'
  );

  requireSourceMarker(
    "server.js",
    "categoryMatchedAlias"
  );

  requireSourceMarker(
    "public/app.js",
    "applyResolvedSearchCategory"
  );

  requireSourceMarker(
    "api/aiSearchRoutes.js",
    "categoryMatch"
  );

  requireSourceMarker(
    "api/aiSearchRoutes.js",
    'params.set(\n      "category",'
  );

  const columnCheck = await db.query(`
    SELECT
      column_name,
      data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_categories'
      AND column_name = 'search_aliases'
  `);

  if (!columnCheck.rows.length) {
    throw new Error(
      "service_categories.search_aliases is missing. Run migration 010."
    );
  }

  const categoryRows =
    await serviceCategoryRepository
      .listCategories();

  const categoriesMissingAliases =
    categoryRows.filter(
      (category) =>
        !Array.isArray(
          category.search_aliases
        ) ||
        category.search_aliases.length === 0
    );

  if (
    categoriesMissingAliases.length
  ) {
    throw new Error(
      `Categories missing aliases: ${categoriesMissingAliases.map((category) => category.slug).join(", ")}`
    );
  }

  const tests = [];

  tests.push(
    await expectCategory(
      "I need a deep tissue massage tomorrow",
      "massage"
    )
  );

  tests.push(
    await expectCategory(
      "Find a chiropractor tomorrow afternoon",
      "chiropractic"
    )
  );

  tests.push(
    await expectCategory(
      "Acupuncture after 4 pm",
      "acupuncture"
    )
  );

  tests.push(
    await expectCategory(
      "Infrared sauna available today",
      "recovery"
    )
  );

  tests.push(
    await expectCategory(
      "I need a facial this afternoon",
      "skin"
    )
  );

  const generic =
    await serviceCategoryRepository
      .inferCategoryFromText(
        "I need an appointment tomorrow"
      );

  if (generic) {
    throw new Error(
      `Generic appointment query unexpectedly inferred ${generic.categorySlug}.`
    );
  }

  console.log(
    "\nCategory intent inference:"
  );

  console.table(tests);

  console.log(
    "\nCategory alias coverage:"
  );

  console.table(
    categoryRows.map(
      (category) => ({
        slug: category.slug,
        displayName:
          category.display_name,
        aliasCount:
          category.search_aliases.length,
        aliases:
          category.search_aliases.join(", ")
      })
    )
  );

  console.log(
    "\nCategory intent inference verification passed."
  );
}

verifyCategoryIntentInference()
  .catch((error) => {
    console.error(
      "\nCategory intent inference verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });