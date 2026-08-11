"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function checkSyntax(relativePath) {
  execFileSync(process.execPath, ["--check", path.join(ROOT, relativePath)], {
    stdio: "pipe"
  });
  console.log(`[OK] syntax ${relativePath}`);
}

function getSquareConfig() {
  return {
    squareSiteUrl: "https://example.square.site/",
    squarePublishedUserId: "123456789",
    squareSiteId: "987654321",
    squareLocationId: "LOC123"
  };
}

function getSampleService() {
  return {
    serviceName: "Test Service",
    serviceType: "hair",
    durationMinutes: 60,
    platformServiceId: "ITEMORVARIATION123"
  };
}

function assertSquareConfig(config = {}, expected = {}) {
  assert(
    config.squareSiteUrl === expected.squareSiteUrl,
    "squareSiteUrl did not enter integration config."
  );
  assert(
    config.squarePublishedUserId === expected.squarePublishedUserId,
    "squarePublishedUserId did not enter integration config."
  );
  assert(
    config.squareSiteId === expected.squareSiteId,
    "squareSiteId did not enter integration config."
  );
  assert(
    config.squareLocationId === expected.squareLocationId,
    "squareLocationId did not enter integration config."
  );
}

function main() {
  [
    "scrapers/square.js",
    "scrape.js",
    "public/platformDefinitions.js",
    "public/admin.js"
  ].forEach(checkSyntax);

  const square = require(path.join(ROOT, "scrapers/square"));
  assert(
    square.NEXTAPPT_SQUARE_SCRAPER_VERSION === "4.0.0",
    "Square scraper v4.0.0 is not installed."
  );
  assert(
    typeof square.scrapeSquareBusiness === "function",
    "scrapeSquareBusiness export is missing."
  );
  console.log("[OK] Square scraper v4.0.0 exports");

  const definitions = require(path.join(ROOT, "public/platformDefinitions"));
  assert(definitions.square, "Square platform definition is missing.");
  assert(
    definitions.square.integrationTypes.includes("scrape"),
    "Square scrape integration type is missing."
  );

  const configKeys = new Set(
    (definitions.square.integrationFields || [])
      .filter((field) => field.storage === "config")
      .map((field) => field.key)
  );

  [
    "squareSiteUrl",
    "squarePublishedUserId",
    "squareSiteId",
    "squareLocationId"
  ].forEach((key) => {
    assert(configKeys.has(key), `Square platform config field missing: ${key}`);
  });

  console.log("[OK] Square platform definition");

  const registry = require(path.join(ROOT, "platformIntegrationRegistry"));
  const squareConfig = getSquareConfig();
  const sampleService = getSampleService();

  // This is the shape produced by the admin editor before businessManager
  // persists the integration through business_integrations.config JSONB.
  const adminBusiness = {
    businessId: "square-verification-admin",
    businessName: "Square Verification Admin",
    platform: "square",
    integrationType: "scrape",
    bookingUrl:
      "https://book.squareup.com/appointments/example/location/LOC123",
    integrationConfig: {
      ...squareConfig
    },
    services: [sampleService]
  };

  const adminIntegrations =
    registry.normalizeBusinessIntegrations(adminBusiness);

  assert(
    adminIntegrations.length === 1,
    "Square admin business did not normalize to one integration."
  );

  const adminValidation =
    registry.validateIntegration(adminIntegrations[0], adminBusiness);

  assert(
    adminValidation.valid,
    `Square admin integration validation failed: ${adminValidation.errors.join(" ")}`
  );

  assertSquareConfig(adminIntegrations[0].config, squareConfig);
  console.log("[OK] Admin integrationConfig -> normalized Square integration");

  // This mirrors a hydrated PostgreSQL business_integrations row.
  const persistedBusiness = {
    businessId: "square-verification-db",
    businessName: "Square Verification DB",
    platform: "square",
    services: [sampleService],
    integrations: [
      {
        id: 999999,
        name: "Square Appointments",
        platform: "square",
        integrationType: "scrape",
        bookingUrl:
          "https://book.squareup.com/appointments/example/location/LOC123",
        status: "active",
        enabled: true,
        isDefault: true,
        config: {
          ...squareConfig
        }
      }
    ]
  };

  const persistedIntegrations =
    registry.normalizeBusinessIntegrations(persistedBusiness);

  assert(
    persistedIntegrations.length === 1,
    "Persisted Square integration did not normalize."
  );

  const persistedValidation =
    registry.validateIntegration(
      persistedIntegrations[0],
      persistedBusiness
    );

  assert(
    persistedValidation.valid,
    `Persisted Square integration validation failed: ${persistedValidation.errors.join(" ")}`
  );

  assertSquareConfig(persistedIntegrations[0].config, squareConfig);
  console.log("[OK] PostgreSQL integration config -> normalized Square integration");

  const job = registry.applyIntegrationToJob(
    {
      ...sampleService,
      businessName: persistedBusiness.businessName,
      platform: "square"
    },
    persistedIntegrations[0]
  );

  assert(
    job.squareSiteUrl === squareConfig.squareSiteUrl,
    "Square site URL did not flow into scrape job."
  );
  assert(
    job.squarePublishedUserId === squareConfig.squarePublishedUserId,
    "Square published user ID did not flow into scrape job."
  );
  assert(
    job.squareSiteId === squareConfig.squareSiteId,
    "Square site ID did not flow into scrape job."
  );
  assert(
    job.squareLocationId === squareConfig.squareLocationId,
    "Square location ID did not flow into scrape job."
  );
  assert(
    job.platformServiceId === sampleService.platformServiceId,
    "Square service ID did not remain on scrape job."
  );

  console.log("[OK] Square integration config -> scrape job flow");

  const scrapeSource = text("scrape.js");
  assert(
    scrapeSource.includes('require("./scrapers/square")'),
    "Square import missing from scrape.js."
  );
  assert(
    scrapeSource.includes('scrapeTarget.platform === "square"'),
    "Square dispatch branch missing from scrape.js."
  );
  assert(
    scrapeSource.includes('"square"'),
    "Square missing from supported platform list."
  );

  console.log("[OK] scrape.js dispatch");

  const adminSource = text("public/admin.js");

  [
    "renderSquareIntegrationFields",
    "setSquareIntegrationConfigValue",
    "attachSquareIntegrationInputListeners",
    "squareSiteUrl",
    "squarePublishedUserId",
    "squareSiteId",
    "squareLocationId",
    "Square Service Item / Variation ID"
  ].forEach((needle) => {
    assert(
      adminSource.includes(needle),
      `Admin Square integration marker missing: ${needle}`
    );
  });

  console.log("[OK] Admin Square onboarding fields");

  console.log(
    "\nAll Square system integration checks passed."
  );
}

try {
  main();
} catch (error) {
  console.error("\n[VERIFY FAILED]", error.message);
  process.exitCode = 1;
}