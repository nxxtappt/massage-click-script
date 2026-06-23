const { scrapeMangomintBusiness } = require("./scrapers/mangomint");

(async () => {
  try {
    const result = await scrapeMangomintBusiness({
      businessName: "Cherry Blossoms Massage - Bastrop",
      platform: "mangomint",
      bookingUrl: "https://booking.mangomint.com/cherryblossomsmassage",
      companyId: "548076",
      locationId: "1",
      address: "Bastrop, TX",
      latitude: null,
      longitude: null,
      serviceName: "Restorative Massage 60 minutes",
      serviceType: "massage",
      durationMinutes: 60,
      serviceId: 193,
      priority: "high",
      discoveryStatus: "manual",
      scrapeStartDate: "2026-06-18",
      daysForward: 7
    });

    console.log("\n===== RESULT =====\n");

    console.log({
      businessName: result.businessName,
      status: result.status,
      totalAppointments: result.appointments.length,
      firstAvailableLocalDate: result.firstAvailableLocalDate
    });

    console.log("\n===== FIRST 10 APPOINTMENTS =====\n");
    console.log(result.appointments.slice(0, 10));
  } catch (error) {
    console.error("Mangomint test failed:", error);
  }
})();