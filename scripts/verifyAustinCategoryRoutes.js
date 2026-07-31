require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
const serviceCategoryRepository = require(
  "../database/serviceCategoryRepository"
);
const {
  buildAustinPageContext,
  renderAustinSearchHtml,
  getAustinCategoryBusinessCount
} = require("../austinSearchRoutes");

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
      `${relativePath} is missing: ${marker}`
    );
  }
}

function assertIncludes(
  value,
  expected,
  message
) {
  if (!String(value).includes(expected)) {
    throw new Error(
      `${message} Missing: ${expected}`
    );
  }
}

async function verifyAustinCategoryRoutes() {
  requireSourceMarker(
    "server.js",
    'app.use(austinSearchRoutes);'
  );

  requireSourceMarker(
    "public/app.js",
    'params.set(\n      "category",'
  );

  requireSourceMarker(
    "seoRoutes.js",
    "Number(category.business_count || 0) <= 0"
  );

  const templateHtml =
    readSource("public/index.html");

  const massage =
    await serviceCategoryRepository
      .getCategoryBySlug("massage");

  const acupuncture =
    await serviceCategoryRepository
      .getCategoryBySlug("acupuncture");

  if (!massage || !acupuncture) {
    throw new Error(
      "Required configured categories were not found."
    );
  }

  const massageCount =
    await getAustinCategoryBusinessCount(
      "massage"
    );

  const acupunctureCount =
    await getAustinCategoryBusinessCount(
      "acupuncture"
    );

  if (massageCount <= 0) {
    throw new Error(
      "Massage should have at least one Austin business."
    );
  }

  if (acupunctureCount !== 0) {
    throw new Error(
      "This verification expects Acupuncture to remain empty for the noindex test."
    );
  }

  const genericContext =
    buildAustinPageContext();

  const massageContext =
    buildAustinPageContext(
      massage,
      massageCount
    );

  const emptyContext =
    buildAustinPageContext(
      acupuncture,
      acupunctureCount
    );

  const genericHtml =
    renderAustinSearchHtml(
      templateHtml,
      genericContext
    );

  const massageHtml =
    renderAustinSearchHtml(
      templateHtml,
      massageContext
    );

  const emptyHtml =
    renderAustinSearchHtml(
      templateHtml,
      emptyContext
    );

  assertIncludes(
    genericHtml,
    'href="https://nextappt.ai/austin"',
    "Generic Austin canonical URL is incorrect."
  );

  assertIncludes(
    massageHtml,
    'data-category-slug="massage"',
    "Massage body context is incorrect."
  );

  assertIncludes(
    massageHtml,
    "Available Massage Appointments in Austin",
    "Massage hero title is incorrect."
  );

  assertIncludes(
    massageHtml,
    'content="index,follow"',
    "Populated Massage page must be indexable."
  );

  assertIncludes(
    emptyHtml,
    'data-category-slug="acupuncture"',
    "Acupuncture body context is incorrect."
  );

  assertIncludes(
    emptyHtml,
    'content="noindex,follow"',
    "Empty Acupuncture page must be noindex."
  );

  assertIncludes(
    emptyHtml,
    'href="https://nextappt.ai/austin/acupuncture"',
    "Acupuncture canonical URL is incorrect."
  );

  console.log(
    "\nAustin route verification:"
  );

  console.table([
    {
      route: "/austin",
      category: "all",
      businessCount: "-",
      robots: genericContext.robots
    },
    {
      route: "/austin/massage",
      category: "massage",
      businessCount: massageCount,
      robots: massageContext.robots
    },
    {
      route: "/austin/acupuncture",
      category: "acupuncture",
      businessCount: acupunctureCount,
      robots: emptyContext.robots
    }
  ]);

  console.log(
    "\nShared Austin category route verification passed."
  );
}

verifyAustinCategoryRoutes()
  .catch((error) => {
    console.error(
      "\nShared Austin category route verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });