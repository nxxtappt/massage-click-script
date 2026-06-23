// test-schedulista.js

const { chromium } = require("playwright");
const { scrapeSchedulistaBusiness } = require("./scrapers/schedulista");

const testBusiness = {
  businessName: "Indigo Moon",
  platform: "schedulista",
  bookingUrl: "https://www.indigomoonmassage.com/#schedule",
  serviceName: "60 Minute Deep Tissue Massage",
  serviceId: "1074317466",
  chooseTimeUrl:
    "https://www.indigomoonmassage.com/#schedule",
  providerPreference: "no_preference"
};

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const result = await scrapeSchedulistaBusiness(
    browser,
    testBusiness
  );

  console.log("\n==============================");
  console.log("SCHEDULISTA TEST RESULT");
  console.log("==============================");
  console.log(JSON.stringify(result, null, 2));

  await browser.close();
})();