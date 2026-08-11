const { scrapeSquareBusiness, NEXTAPPT_SQUARE_SCRAPER_VERSION } = require("../scrapers/square");

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function numberEnv(name, fallback = null) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

(async () => {
  const target = {
    businessName: env("SQUARE_BUSINESS_NAME", "Square Test Business"),
    platform: "square",
    bookingUrl: env("SQUARE_BOOKING_URL"),
    squareSiteUrl: env("SQUARE_SITE_URL"),
    squarePublishedUserId: env("SQUARE_PUBLISHED_USER_ID"),
    squareSiteId: env("SQUARE_SITE_ID"),
    squareLocationId: env("SQUARE_LOCATION_ID"),
    serviceName: env("SQUARE_SERVICE_NAME"),
    serviceType: env("SQUARE_SERVICE_TYPE", "other"),
    durationMinutes: numberEnv("SQUARE_DURATION_MINUTES", null),
    platformServiceId: env("SQUARE_SERVICE_ID"),
    squareServiceVariationId: env("SQUARE_SERVICE_VARIATION_ID"),
    providerText: env("SQUARE_PROVIDER_TEXT", "Any available staff"),
    timezone: env("SQUARE_TIMEZONE", "America/Chicago"),
    daysForward: numberEnv("SQUARE_DAYS_FORWARD", 7)
  };

  console.log(`Testing NextAppt Square scraper v${NEXTAPPT_SQUARE_SCRAPER_VERSION}`);
  console.log(JSON.stringify(target, null, 2));

  try {
    const result = await scrapeSquareBusiness(target);

    console.log("\nSTATUS:", result.status);
    console.log("APPOINTMENTS:", result.appointments?.length || 0);
    console.log("TRANSPORT:", result.squareMeta?.availabilityTransport || "unknown");
    console.log("VARIATION:", result.squareMeta?.serviceVariationId || "");

    console.table(
      (result.appointments || []).map((appointment) => ({
        date: appointment.date,
        time: appointment.time,
        start: appointment.startTime,
        service: appointment.serviceName,
        duration: appointment.durationMinutes,
        price: appointment.price,
        staffIds: (appointment.squareBookingStaffIds || []).join(", ")
      }))
    );
  } catch (error) {
    console.error("\nSQUARE TEST FAILED:");
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
})();