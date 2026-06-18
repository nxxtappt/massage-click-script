const { scrapeMangomintBusiness } = require("./scrapers/mangomint");

(async () => {
  try {
    const result = await scrapeMangomintBusiness({
      businessName: "Form and Function Massage",
      platform: "mangomint",

      bookingUrl:
        "https://booking.mangomint.com/formfunctionmassage1",

      companyId: "977962",
      locationId: "1",

      serviceId: 8,
      serviceName: "60 Minute Customized Massage",
      serviceType: "massage",
      durationMinutes: 60,

      scrapeStartDate: "2026-06-18",
      daysForward: 7
    });

    console.log("\n===== RESULT =====\n");

    console.log({
      status: result.status,
      totalAppointments: result.appointments.length,
      firstAvailableLocalDate:
        result.firstAvailableLocalDate
    });

    console.log("\n===== FIRST 10 APPOINTMENTS =====\n");

    console.log(
      result.appointments.slice(0, 10)
    );
  } catch (error) {
    console.error(error);
  }
})();