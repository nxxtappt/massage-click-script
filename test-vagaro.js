// test-vagaro.js

const scrapeVagaroMarketplace = require("./scrapers/vagaroMarketplace");

async function main() {
  const results = await scrapeVagaroMarketplace({
    city: "austin",
    state: "tx",
    service: "Swedish Massage - 60 Minute",
    limit: 5,
    inspectBusinessPages: true
  });

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});