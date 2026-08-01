require("dotenv").config();

const db = require("../db");
const serviceCategoryRepository = require(
  "../database/serviceCategoryRepository"
);

async function expectSearchCategory(
  query,
  expectedSlug
) {
  const result =
    await serviceCategoryRepository
      .inferCategoryFromText(query);

  if (!result) {
    throw new Error(
      `No category inferred for: ${query}`
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
    category:
      result.categorySlug,
    matchedAlias:
      result.matchedAlias
  };
}

async function expectSqlClassification(
  serviceName,
  expectedSlug
) {
  const result = await db.query(
    `
      SELECT resolve_service_category_slug(
        NULL,
        $1,
        NULL,
        NULL,
        '{}'::jsonb,
        'massage'
      ) AS category_slug
    `,
    [serviceName]
  );

  const categorySlug =
    result.rows[0]?.category_slug;

  if (categorySlug !== expectedSlug) {
    throw new Error(
      `Expected ${expectedSlug} for service "${serviceName}", received ${categorySlug}.`
    );
  }

  return {
    serviceName,
    category:
      categorySlug
  };
}

async function verifyHairCategory() {
  const hair =
    await serviceCategoryRepository
      .getCategoryBySlug("hair");

  if (!hair) {
    throw new Error(
      "The Hair category is missing or disabled."
    );
  }

  if (
    hair.display_name !== "Hair"
  ) {
    throw new Error(
      `Unexpected Hair display name: ${hair.display_name}`
    );
  }

  if (
    !Array.isArray(
      hair.search_aliases
    ) ||
    !hair.search_aliases.includes(
      "haircut"
    )
  ) {
    throw new Error(
      "Hair search aliases are missing."
    );
  }

  const searchTests = [];

  searchTests.push(
    await expectSearchCategory(
      "haircut tomorrow afternoon",
      "hair"
    )
  );

  searchTests.push(
    await expectSearchCategory(
      "balayage appointment this week",
      "hair"
    )
  );

  searchTests.push(
    await expectSearchCategory(
      "find a barber today",
      "hair"
    )
  );

  searchTests.push(
    await expectSearchCategory(
      "silk press near me",
      "hair"
    )
  );

  const classificationTests = [];

  classificationTests.push(
    await expectSqlClassification(
      "Women's Haircut",
      "hair"
    )
  );

  classificationTests.push(
    await expectSqlClassification(
      "Balayage and Toner",
      "hair"
    )
  );

  classificationTests.push(
    await expectSqlClassification(
      "Brazilian Blowout",
      "hair"
    )
  );

  classificationTests.push(
    await expectSqlClassification(
      "Box Braids",
      "hair"
    )
  );

  classificationTests.push(
    await expectSqlClassification(
      "Scalp Massage",
      "massage"
    )
  );

  const counts =
    await serviceCategoryRepository
      .getCategoryBusinessCounts({
        metro: "Austin"
      });

  const hairCount =
    counts.find(
      (category) =>
        category.slug === "hair"
    );

  if (!hairCount) {
    throw new Error(
      "Hair is missing from Austin category counts."
    );
  }

  console.log(
    "\nHair category:"
  );

  console.table([
    {
      slug: hair.slug,
      displayName:
        hair.display_name,
      enabled:
        hair.enabled !== false,
      sortOrder:
        Number(
          hair.sort_order || 0
        ),
      businessCount:
        Number(
          hairCount.business_count || 0
        ),
      aliasCount:
        hair.search_aliases.length
    }
  ]);

  console.log(
    "\nNatural-language inference:"
  );

  console.table(searchTests);

  console.log(
    "\nAutomatic service classification:"
  );

  console.table(
    classificationTests
  );

  console.log(
    "\nHair category verification passed."
  );
}

verifyHairCategory()
  .catch((error) => {
    console.error(
      "\nHair category verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });