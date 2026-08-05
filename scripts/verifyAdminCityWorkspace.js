require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");
const businessManager = require(
  "../businessManager"
);
const inventoryRepository = require(
  "../database/inventoryRepository"
);
const runtimeStateRepository = require(
  "../database/runtimeStateRepository"
);
const schedulerRepository = require(
  "../database/schedulerRepository"
);
const {
  listMarketplaceMetros,
  getMarketplaceMetro
} = require(
  "../marketplaceMetros"
);

function requireSourceMarker(
  relativePath,
  marker
) {
  const source =
    fs.readFileSync(
      path.join(
        process.cwd(),
        relativePath
      ),
      "utf8"
    );

  if (
    !source.includes(marker)
  ) {
    throw new Error(
      `${relativePath} is missing: ${marker}`
    );
  }
}

async function verifyAdminCityWorkspace() {
  requireSourceMarker(
    "public/admin.html",
    'id="adminMetroFilter"'
  );

  requireSourceMarker(
    "public/admin.js",
    "function cloneServiceForAdmin"
  );

  requireSourceMarker(
    "public/admin.js",
    "function filterSchedulerStateForAdminMetro"
  );

  requireSourceMarker(
    "public/admin.css",
    "/* NEXTAPPT ADMIN CITY WORKSPACE + COMPACT SERVICES START */"
  );

  requireSourceMarker(
    "adminRoutes.js",
    'router.get("/marketplace-metros"'
  );

  requireSourceMarker(
    "database/inventoryRepository.js",
    "business_match.metro"
  );

  requireSourceMarker(
    "database/runtimeStateRepository.js",
    "options = {}"
  );

  requireSourceMarker(
    "database/schedulerRepository.js",
    "getMarketplaceMetroSearchTerms"
  );

  const metros =
    listMarketplaceMetros();

  const expectedMetros = [
    "austin",
    "miami",
    "san-antonio",
    "dallas-fort-worth",
    "houston"
  ];

  for (
    const metroSlug
    of expectedMetros
  ) {
    if (
      !metros.some(
        (metro) =>
          metro.slug === metroSlug
      )
    ) {
      throw new Error(
        `Missing marketplace metro: ${metroSlug}`
      );
    }
  }

  const austin =
    getMarketplaceMetro(
      "austin"
    );

  const businessSearch =
    await businessManager
      .searchBusinesses({
        metro:
          austin.slug,
        metroTerms:
          austin.searchTerms,
        page: 1,
        limit: 5
      });

  if (
    !Array.isArray(
      businessSearch.businesses
    )
  ) {
    throw new Error(
      "Metro-aware business search did not return an array."
    );
  }

  const subscriptionSearch =
    await businessManager
      .searchBusinessSubscriptions({
        metro:
          austin.slug,
        metroTerms:
          austin.searchTerms,
        page: 1,
        limit: 5
      });

  if (
    !Array.isArray(
      subscriptionSearch.subscriptions
    )
  ) {
    throw new Error(
      "Metro-aware subscription search did not return an array."
    );
  }

  const inventorySearch =
    await inventoryRepository
      .searchInventory({
        metroTerms:
          austin.searchTerms,
        includeInactive: true,
        showPast: true,
        page: 1,
        limit: 5
      });

  if (
    !Array.isArray(
      inventorySearch.results
    )
  ) {
    throw new Error(
      "Metro-aware inventory search did not return an array."
    );
  }

  const errors =
    await runtimeStateRepository
      .getScrapeErrors(
        5,
        {
          metroTerms:
            austin.searchTerms
        }
      );

  if (!Array.isArray(errors)) {
    throw new Error(
      "Metro-aware error search did not return an array."
    );
  }

  const groups =
    await schedulerRepository
      .listGroups();

  if (!Array.isArray(groups)) {
    throw new Error(
      "Scheduler groups did not return an array."
    );
  }

  console.log(
    "\nAdmin city workspace:"
  );

  console.table(
    metros.map(
      (metro) => ({
        slug: metro.slug,
        name: metro.name,
        timezone:
          metro.timezone,
        searchTerms:
          metro.searchTerms.length
      })
    )
  );

  console.log(
    "\nAustin-scoped data:"
  );

  console.table([
    {
      businesses:
        businessSearch.total,
      subscriptions:
        subscriptionSearch.total,
      inventory:
        inventorySearch.total,
      recentErrors:
        errors.length,
      scrapeGroups:
        groups.length
    }
  ]);

  console.log(
    "\nAdmin city workspace verification passed."
  );
}

verifyAdminCityWorkspace()
  .catch((error) => {
    console.error(
      "\nAdmin city workspace verification failed."
    );
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end();
  });