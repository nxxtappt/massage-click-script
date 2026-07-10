async function executeSearch(query = {}) {
  return {
    success: true,
    skippedScrape: true,
    databaseOnly: true,
    reason: "Public searches read PostgreSQL inventory and never launch scrapers.",
    query
  };
}
module.exports = { executeSearch };