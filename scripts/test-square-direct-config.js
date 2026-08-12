"use strict";

const square = require("../scrapers/square");

const bookingUrl =
  process.env.SQUARE_BOOKING_URL ||
  "https://book.squareup.com/appointments/s4hhr5q8oh2ok8/location/LEQJ0XZDY3KXG/services";

(async () => {
  const parsed = square.parseSquareBookingUrl(bookingUrl);
  const normalized = square.normalizeSquareTarget({
    businessName: "Zen Well",
    platform: "square",
    bookingUrl,
    serviceName: "Thai Massage",
    serviceType: "massage",
    durationMinutes: 60,
    platformServiceId: "P6IZIH4NRNO6KGSTDG4MR2L4",
    timezone: "America/Chicago",
    daysForward: 3
  });
  const context = await square.discoverSquareContext(normalized);

  console.log("Square version:", square.NEXTAPPT_SQUARE_SCRAPER_VERSION);
  console.log("Parsed booking URL:");
  console.dir(parsed, { depth: 10 });
  console.log("\nNormalized target:");
  console.dir(
    {
      bookingUrl: normalized.bookingUrl,
      squareBookingBusinessId: normalized.squareBookingBusinessId,
      squareLocationId: normalized.squareLocationId,
      squarePublishedUserId: normalized.squarePublishedUserId,
      squareSiteId: normalized.squareSiteId
    },
    { depth: 10 }
  );
  console.log("\nDiscovery context:");
  console.dir(context, { depth: 10 });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});