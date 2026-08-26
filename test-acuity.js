"use strict";

const { scrapeAcuityBusiness } = require("./acuity");

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    out[key] = rest.join("=");
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv);

  const bookingUrl = args.bookingUrl || "";
  const appointmentTypeId = args.appointmentTypeId || args.platformServiceId || "";

  if (!bookingUrl || !appointmentTypeId) {
    console.error(
      "Usage: node test-acuity.js --bookingUrl=https://app.acuityscheduling.com/schedule/OWNER --appointmentTypeId=12345678 [--calendarId=any] [--timezone=America/Chicago] [--daysForward=7] [--owner=OWNER]"
    );
    process.exit(1);
  }

  try {
    const result = await scrapeAcuityBusiness({
      businessName: args.businessName || "Acuity Test",
      bookingUrl,
      platform: "acuity",
      serviceName: args.serviceName || "Acuity Test Service",
      serviceType: args.serviceType || "massage",
      durationMinutes: args.durationMinutes ? Number(args.durationMinutes) : null,
      platformServiceId: appointmentTypeId,
      appointmentTypeId,
      acuityOwnerId: args.owner || args.acuityOwnerId || "",
      calendarId: args.calendarId || "any",
      timezone: args.timezone || "America/Chicago",
      daysForward: args.daysForward ? Number(args.daysForward) : 7,
      scrapeStartDate: args.startDate || ""
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("ACUITY TEST FAILED:");
    console.error(error.stack || error.message);
    process.exit(1);
  }
})();