// test-axl3.js

const { chromium } = require("playwright");
const { scrapeAxl3Business } = require("./scrapers/axl3");

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const business = {
  "businessName": "AustinDEEP Barton Creek",
  "platform": "axl3",
  "bookingUrl": "https://booking.austindeep.com/tx/barton-creek/appointments/",
  "serviceName": "THE DEEP™60MIN"
}

  try {
    const result = await scrapeAxl3Business(browser, business);
    console.log("\n===== AXL3 TEST RESULT =====");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})();