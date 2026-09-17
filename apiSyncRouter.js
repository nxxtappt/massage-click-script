const { getAdapter } = require("./crmProviders/registry");

function buildScrapeWindowPayload(target = {}, business = {}) {
  return {
    scrapeStartDate:
      target.scrapeStartDate ||
      business.scrapeStartDate ||
      "",

    scrapeEndDate:
      target.scrapeEndDate ||
      business.scrapeEndDate ||
      "",

    lookaheadHours:
      target.lookaheadHours ||
      business.lookaheadHours ||
      null,

    daysForward:
      target.daysForward ||
      business.daysForward ||
      null,

    scrapeWindowMode:
      target.scrapeWindowMode ||
      business.scrapeWindowMode ||
      ""
  };
}

async function syncBusinessViaApi(target = {}) {
  const business = target.business || target || {};

  const integrationType =
    business.integrationType ||
    target.integrationType ||
    "";

  const apiProvider =
    business.apiProvider ||
    target.apiProvider ||
    "";

  if (integrationType !== "api") {
    throw new Error(
      `Business is not configured for API integration: ${business.businessName || target.businessName}`
    );
  }

  const scrapeWindow =
    buildScrapeWindowPayload(
      target,
      business
    );

  console.log("[API SYNC ROUTER] Scrape window:", {
    businessName:
      business.businessName ||
      target.businessName,
    scrapeStartDate:
      scrapeWindow.scrapeStartDate,
    scrapeEndDate:
      scrapeWindow.scrapeEndDate,
    lookaheadHours:
      scrapeWindow.lookaheadHours,
    daysForward:
      scrapeWindow.daysForward,
    scrapeWindowMode:
      scrapeWindow.scrapeWindowMode
  });

  const adapter = getAdapter(apiProvider);
  if (typeof adapter.syncAppointments !== "function") {
    throw new Error(`No live appointment sync is implemented for ${apiProvider}.`);
  }

  return adapter.syncAppointments({
      credentialId:
        business.credentialId ||
        target.credentialId,

      businessIdentity:
        business.businessId ||
        target.businessId ||
        business.businessName ||
        target.businessName,

      businessName:
        business.businessName ||
        target.businessName,

      bookingUrl:
        business.bookingUrl ||
        target.bookingUrl,

      serviceType:
        target.serviceType ||
        business.serviceType,

      durationMinutes:
        target.durationMinutes ||
        business.durationMinutes,

      serviceName:
        target.serviceName ||
        business.serviceName ||
        "",

      platformServiceId:
        target.platformServiceId ||
        business.platformServiceId ||
        business.serviceId ||
        business.serviceButtonId ||
        "",

      sessionTypeId:
        target.sessionTypeId || business.sessionTypeId || "",

      ...scrapeWindow
    });
}

module.exports = {
  syncBusinessViaApi
};
