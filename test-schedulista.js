// test-schedulista.js

const { chromium } = require("playwright");
const { scrapeSchedulistaBusiness } = require("./scrapers/schedulista");

const testBusiness = {
  businessName: "Mantis Massage South Congress",
  platform: "schedulista",
  bookingUrl: "https://mantismassage1.schedulista.com/",
  serviceName: "60 Minute Massage",
  serviceId: "1074317466",
  chooseTimeUrl:
    "https://www.schedulista.com/schedule/mantismassage1/choose_time?service_id=1074317466",
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