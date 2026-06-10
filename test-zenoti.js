const { scrapeZenoti } = require("./scrapers/zenoti");

async function run() {
  const result = await scrapeZenoti(
    {
      "businessName": "MILK AND HONEY 2ND STREET DISTRICT - AUSTIN",
    "platform": "zenoti",
    "bookingUrl": "https://milkandhoneyspas.zenoti.com/webstoreNew/services/70b94be2-7e2b-4d9e-a135-ac56350046a1",
    "categoryText": "MASSAGE",
    "parentServiceText": "60 min Signature Massage",
    "serviceName": "60 min Signature Massage",
    "providerText": "Any Service Provider",
    "daysForward": 21,
    
      serviceName: "60 min Signature Massage",
      daysAhead: 21
    }
  );

  console.log(JSON.stringify(result, null, 2));
}

run();