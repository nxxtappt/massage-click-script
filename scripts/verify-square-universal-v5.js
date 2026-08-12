"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();

function ok(message) {
  console.log(`[OK] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function syntax(rel) {
  execFileSync(process.execPath, ["--check", path.join(root, rel)], {
    stdio: "pipe"
  });
  ok(`syntax ${rel}`);
}

(async () => {
  syntax("scrapers/square.js");
  syntax("public/platformDefinitions.js");
  syntax("public/admin.js");

  const square = require(path.join(root, "scrapers", "square.js"));
  const defs = require(path.join(root, "public", "platformDefinitions.js"));

  if (square.NEXTAPPT_SQUARE_SCRAPER_VERSION !== "5.0.0") {
    fail(
      `Expected Square v5.0.0; got ${square.NEXTAPPT_SQUARE_SCRAPER_VERSION}`
    );
  }
  ok("Square scraper v5.0.0");

  if (typeof square.parseSquareBookingUrl !== "function") {
    fail("parseSquareBookingUrl export missing.");
  }

  const direct = square.parseSquareBookingUrl(
    "https://book.squareup.com/appointments/s4hhr5q8oh2ok8/location/LEQJ0XZDY3KXG/services"
  );

  if (!direct.isDirectBooking) fail("Direct Square booking URL not recognized.");
  if (direct.bookingBusinessId !== "s4hhr5q8oh2ok8") {
    fail(`Wrong booking business ID: ${direct.bookingBusinessId}`);
  }
  if (direct.locationId !== "LEQJ0XZDY3KXG") {
    fail(`Wrong location ID: ${direct.locationId}`);
  }
  ok("Direct book.squareup.com ID parsing");

  const legacy = square.parseSquareBookingUrl(
    "https://square.site/book/LEQJ0XZDY3KXG/zen-well-austin-tx"
  );

  if (!legacy.isDirectBooking || legacy.locationId !== "LEQJ0XZDY3KXG") {
    fail("Legacy square.site/book location parsing failed.");
  }
  ok("Legacy square.site/book location parsing");

  const normalized = square.normalizeSquareTarget({
    platform: "square",
    bookingUrl:
      "https://book.squareup.com/appointments/s4hhr5q8oh2ok8/location/LEQJ0XZDY3KXG/services"
  });

  if (normalized.squareBookingBusinessId !== "s4hhr5q8oh2ok8") {
    fail("normalizeSquareTarget did not infer squareBookingBusinessId.");
  }

  if (normalized.squareLocationId !== "LEQJ0XZDY3KXG") {
    fail("normalizeSquareTarget did not infer squareLocationId.");
  }
  ok("Square target automatically infers direct-booking IDs");

  const context = await square.discoverSquareContext({
    platform: "square",
    bookingUrl:
      "https://book.squareup.com/appointments/s4hhr5q8oh2ok8/location/LEQJ0XZDY3KXG/services"
  });

  if (context.discoveryMethod !== "direct_booking") {
    fail(`Expected direct_booking; got ${context.discoveryMethod}`);
  }

  if (context.bookingBusinessId !== "s4hhr5q8oh2ok8") {
    fail("Direct context bookingBusinessId missing.");
  }

  if (context.locationId !== "LEQJ0XZDY3KXG") {
    fail("Direct context locationId missing.");
  }
  ok("Direct booking discovery requires no square-sync IDs");

  const squareDef = defs.square;
  if (!squareDef) fail("Square platform definition missing.");

  const integrationFields = squareDef.integrationFields || [];
  const byKey = new Map(integrationFields.map((field) => [field.key, field]));

  for (const key of [
    "bookingUrl",
    "squareBookingBusinessId",
    "squareLocationId",
    "squareSiteUrl",
    "squarePublishedUserId",
    "squareSiteId"
  ]) {
    if (!byKey.has(key)) fail(`Square platform field missing: ${key}`);
  }

  for (const key of [
    "squareBookingBusinessId",
    "squareLocationId",
    "squareSiteUrl",
    "squarePublishedUserId",
    "squareSiteId"
  ]) {
    const field = byKey.get(key);
    if (
      field.required === true ||
      (Array.isArray(field.requiredFor) && field.requiredFor.includes("scrape"))
    ) {
      fail(`${key} should be optional in universal Square mode.`);
    }
  }
  ok("Square admin configuration supports optional discovery IDs");

  const bookingField = byKey.get("bookingUrl");
  if (
    !bookingField ||
    !Array.isArray(bookingField.requiredFor) ||
    !bookingField.requiredFor.includes("scrape")
  ) {
    fail("Square Booking URL must remain required.");
  }
  ok("Square Booking URL remains required");

  const adminSource = fs.readFileSync(
    path.join(root, "public", "admin.js"),
    "utf8"
  );

  for (const marker of [
    "Square Booking Business ID",
    'data-square-config-key="squareBookingBusinessId"',
    "squareLocationId"
  ]) {
    if (!adminSource.includes(marker)) {
      fail(`Admin Square v5 marker missing: ${marker}`);
    }
  }
  ok("Admin exposes direct-booking configuration");

  const scrapeSource = fs.readFileSync(
    path.join(root, "scrape.js"),
    "utf8"
  );

  if (!scrapeSource.includes("scrapeSquareBusiness(scrapeTarget)")) {
    fail("scrape.js does not use the corrected Square v4/v5 dispatch.");
  }
  ok("scrape.js dispatch remains compatible");

  console.log("\nAll universal Square v5 static/configuration checks passed.");
  console.log(
    "Next test: save Zen Well with its direct booking URL, service ID, and run the real scrape pipeline."
  );
})().catch((error) => {
  console.error("\n[VERIFY FAILED]", error.message);
  process.exitCode = 1;
});