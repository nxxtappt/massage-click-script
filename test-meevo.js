const {
  scrapeMeevoAvailability
} = require("./scrapers/meevo");

(async () => {
  try {
    const results =
      await scrapeMeevoAvailability({
        bookingUrl:
          "https://na2.meevo.com/CustomerPortal/onlinebooking/booking/guestinfo?tenantId=502059&locationId=502797",

        categoryName: "Swedish Massage",

        serviceName: "1 Hour Swedish Massage",

        daysForward: 7
      });

    console.log(
      JSON.stringify(results, null, 2)
    );
  } catch (error) {
    console.error(error);
  }
})();