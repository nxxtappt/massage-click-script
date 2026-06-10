const fs = require("fs");
const { chromium } = require("playwright");

const {
  scrapeMassageEnvyBusiness
} = require("../scrapers/massage-envy");

function loadBusiness() {
  const businesses = JSON.parse(
    fs.readFileSync("businesses.json", "utf8")
  );

  const business = businesses.find(
    (item) =>
      item.businessName === "Massage Envy - Circle C"
  );

  if (!business) {
    throw new Error(
      "Massage Envy - Circle C not found in businesses.json"
    );
  }

  const service =
    Array.isArray(business.services) &&
    business.services.length
      ? business.services[0]
      : {};

  return {
    ...business,
    serviceName:
      service.serviceName ||
      business.serviceName,
    serviceType:
      service.serviceType ||
      business.serviceType,
    durationMinutes:
      service.durationMinutes ||
      business.durationMinutes,
    platformServiceId:
      service.platformServiceId ||
      business.platformServiceId
  };
}

async function run() {
  const business = loadBusiness();

  console.log("\n===== TESTING MASSAGE ENVY SCRAPER =====");
  console.log(JSON.stringify(business, null, 2));

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const result = await scrapeMassageEnvyBusiness(
      browser,
      business
    );

    console.log("\n===== SCRAPER RESULT =====");
    console.log(JSON.stringify(result, null, 2));

    fs.writeFileSync(
      "inspectors/massage-envy-scraper-result.json",
      JSON.stringify(result, null, 2)
    );

    console.log(
      "\nSaved result to inspectors/massage-envy-scraper-result.json"
    );
  } finally {
    await browser.close().catch(() => null);
  }
}

run().catch((error) => {
  console.error("\nTEST FAILED:");
  console.error(error);
  process.exit(1);
});