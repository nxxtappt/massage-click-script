const { buildSearchIntent } = require("./searchIntentEngine");
function decideSearchAction(query = {}) {
  const intent = buildSearchIntent(query);
  return {
    decision: "serve_postgres_inventory",
    intent,
    intentKey: intent.intentKey,
    serveDatabase: true,
    serveCache: false,
    queueRefresh: false,
    liveScrapeNow: false,
    targetsToScrape: [],
    freshCachedResults: [],
    reason: "Public on-demand scraping is disabled. Inventory is served from PostgreSQL."
  };
}
module.exports = { decideSearchAction, buildSearchIntent };