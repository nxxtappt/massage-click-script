require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
const businessManager = require(
  "../businessManager"
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

async function verifyBusinessPageCategoryData() {
  requireSourceMarker(
    "businessManager.js",
    "function groupBusinessPageServices"
  );

  requireSourceMarker(
    "businessManager.js",
    "servicesByCategory:"
  );

  const page =
    await businessManager
      .getBusinessPageData(
        "dimensions-massage-therapy"
      );

  if (!page) {
    throw new Error(
      "Dimensions business page was not found."
    );
  }

  if (!Array.isArray(page.categories)) {
    throw new Error(
      "Business page categories are missing."
    );
  }

  if (
    !Array.isArray(
      page.servicesByCategory
    )
  ) {
    throw new Error(
      "servicesByCategory is missing."
    );
  }

  const categorySlugs =
    new Set(
      page.categories.map(
        (category) =>
          category.slug
      )
    );

  if (!categorySlugs.has("massage")) {
    throw new Error(
      "Dimensions business page is missing Massage."
    );
  }

  if (!categorySlugs.has("recovery")) {
    throw new Error(
      "Dimensions business page is missing Recovery."
    );
  }

  const recoveryGroup =
    page.servicesByCategory.find(
      (group) =>
        group.slug === "recovery"
    );

  if (!recoveryGroup) {
    throw new Error(
      "Recovery service group is missing."
    );
  }

  const sauna =
    recoveryGroup.services.find(
      (service) =>
        String(
          service.serviceName || ""
        )
          .toLowerCase()
          .includes(
            "infrared sauna"
          )
    );

  if (!sauna) {
    throw new Error(
      "Infrared Sauna is not grouped under Recovery."
    );
  }

  if (
    sauna.categorySlug !==
    "recovery"
  ) {
    throw new Error(
      "Infrared Sauna categorySlug is incorrect."
    );
  }

  console.log(
    "\nBusiness page categories:"
  );

  console.table(
    page.categories.map(
      (category) => ({
        slug: category.slug,
        displayName:
          category.displayName,
        serviceCount:
          category.serviceCount,
        sortOrder:
          category.sortOrder
      })
    )
  );

  console.log(
    "\nServices grouped by category:"
  );

  console.table(
    page.servicesByCategory
      .flatMap((group) =>
        group.services.map(
          (service) => ({
            category:
              group.displayName,
            service:
              service.serviceName,
            duration:
              service.durationMinutes,
            categorySlug:
              service.categorySlug
          })
        )
      )
  );

  console.log(
    "\nBusiness-page category data verification passed."
  );
}

verifyBusinessPageCategoryData()
  .catch((error) => {
    console.error(
      "\nBusiness-page category data verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });