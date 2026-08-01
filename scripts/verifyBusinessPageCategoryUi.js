require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
const businessManager = require(
  "../businessManager"
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
  const source =
    readSource(relativePath);

  if (!source.includes(marker)) {
    throw new Error(
      `${relativePath} is missing required Step 9 marker: ${marker}`
    );
  }
}

async function verifyBusinessPageCategoryUi() {
  requireSourceMarker(
    "public/business-page.js",
    "function renderServiceCatalog"
  );

  requireSourceMarker(
    "public/business-page.js",
    "function groupAppointmentsByCategory"
  );

  requireSourceMarker(
    "public/business-page.js",
    '${renderServiceCatalog(page)}'
  );

  requireSourceMarker(
    "public/business-page.js",
    'class="inventory-category"'
  );

  requireSourceMarker(
    "public/business-page.css",
    "/* NEXTAPPT BUSINESS CATEGORY UI START */"
  );

  requireSourceMarker(
    "public/business-page.css",
    ".business-category-section"
  );

  requireSourceMarker(
    "public/business-page.css",
    ".inventory-category-header"
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

  const groups =
    Array.isArray(
      page.servicesByCategory
    )
      ? page.servicesByCategory
      : [];

  const massage =
    groups.find(
      (group) =>
        group.slug === "massage"
    );

  const recovery =
    groups.find(
      (group) =>
        group.slug === "recovery"
    );

  if (!massage) {
    throw new Error(
      "Massage group is missing from the business-page data."
    );
  }

  if (!recovery) {
    throw new Error(
      "Recovery group is missing from the business-page data."
    );
  }

  const sauna =
    recovery.services.find(
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
      "Infrared Sauna is not available to the Recovery UI group."
    );
  }

  console.log(
    "\nBusiness-page UI groups:"
  );

  console.table(
    groups.map((group) => ({
      slug: group.slug,
      displayName:
        group.displayName,
      serviceCount:
        group.services.length,
      services:
        group.services
          .map(
            (service) =>
              service.serviceName
          )
          .join(", ")
    }))
  );

  console.log(
    "\nBusiness-page category UI verification passed."
  );
}

verifyBusinessPageCategoryUi()
  .catch((error) => {
    console.error(
      "\nBusiness-page category UI verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });