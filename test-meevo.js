const {
  scrapeMeevoAvailability
} = require("./scrapers/meevo");

(async () => {
  try {
    const results =
      await scrapeMeevoAvailability({
        bookingUrl: "https://na2.meevo.com/CustomerPortal/onlinebooking/booking/guestinfo?tenantId=500970&locationId=501258",

        appointmentType: "Individual Appointment",
        categoryName: "Massage Therapy",
        serviceName: "50 Min Relaxation Massage",
        providerText: "Any employee",

        daysForward: 7,
        debug: true
      });

    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error(error);
  }
})();