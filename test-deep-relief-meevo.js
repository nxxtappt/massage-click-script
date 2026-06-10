const { scrapeMeevoAvailability } = require("./scrapers/meevo");

async function runDeepReliefTest() {
  const business = {
    businessName: "Deep Relief",
    platform: "meevo",
    bookingUrl:
      "https://na2.meevo.com/CustomerPortal/onlinebooking/booking/guestinfo?tenantId=500970&locationId=501258",
    categoryName: "Signature Relaxation Massage",
    serviceName: "50 Min Relaxation Massage",
    daysForward: 7
  };

  console.log("Testing Meevo business:");
  console.log(JSON.stringify(business, null, 2));

  try {
    const result = await scrapeMeevoAvailability(business);

    console.log("\n===== DEEP RELIEF MEEVO RESULT =====");
    console.log(JSON.stringify(result, null, 2));

    const openings = result?.openings || result?.appointments || [];

    if (Array.isArray(openings) && openings.length > 0) {
      console.log(`\nSUCCESS: Found ${openings.length} opening(s).`);
    } else {
      console.log("\nNO OPENINGS RETURNED.");
      console.log(
        "This may mean the scraper worked but found no appointments, or the category/service/employee step needs adjustment."
      );
    }
  } catch (error) {
    console.error("\n===== DEEP RELIEF MEEVO ERROR =====");
    console.error(error);
  }
}

runDeepReliefTest();