const { scrapeHandStoneBusiness } = require("./scrapers/hand-stone");

(async () => {
  try {
    const result = await scrapeHandStoneBusiness({
      businessName: "Hand & Stone Massage and Facial Spa - Austin South",
      platform: "hand-stone",
      bookingUrl:
        "https://handandstone.com/locations/austin-south/booking/?center_id=730cad3d-f8a4-4f87-b22a-fd224f1d97ee&step=category",

      centerId: "730cad3d-f8a4-4f87-b22a-fd224f1d97ee",

      serviceName: "Classic Massage",
      serviceType: "massage",
      durationMinutes: 60,
      serviceId: "c203c5b8-9080-45e1-afeb-498c72c946fa",

      scrapeStartDate: "2026-06-22",
      daysForward: 1
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("TEST FAILED:", error);
    process.exit(1);
  }
})();