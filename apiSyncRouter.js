const {
  syncMindbodyBusiness
} = require("./syncMindbodyBusiness");

async function syncBusinessViaApi(target = {}) {
  const business = target.business || {};

  const integrationType =
    business.integrationType || "";

  const apiProvider =
    business.apiProvider || "";

  if (integrationType !== "api") {
    throw new Error(
      `Business is not configured for API integration: ${business.businessName}`
    );
  }

  if (apiProvider === "mindbody") {
    return syncMindbodyBusiness({
      credentialId:
        business.credentialId,

      businessName:
        business.businessName,

      bookingUrl:
        business.bookingUrl,

      serviceType:
        target.serviceType,

      durationMinutes:
        target.durationMinutes
    });
  }

  throw new Error(
    `Unsupported API provider: ${apiProvider}`
  );
}

module.exports = {
  syncBusinessViaApi
};