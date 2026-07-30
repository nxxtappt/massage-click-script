"use strict";

require("dotenv").config();

const businessManager = require("../businessManager");
const { getEnabledServicesForBusiness } = require("../jobBuilder");
const {
  resolveEnabledIntegration,
  validateIntegration,
  applyIntegrationToJob
} = require("../platformIntegrationRegistry");

async function run() {
  const businesses = await businessManager.getAllBusinesses({
    includeDisabled: true
  });

  let invalidBusinessCount = 0;
  let invalidServiceCount = 0;

  for (const business of businesses) {
    const integration = resolveEnabledIntegration(business, {
      platform: business.platform
    });

    if (!integration) {
      invalidBusinessCount += 1;
      console.log(`\n[INVALID BUSINESS] ${business.businessName}`);
      console.log("- No enabled integration could be resolved.");
      continue;
    }

    const integrationValidation = validateIntegration(integration, business);

    if (!integrationValidation.valid) {
      invalidBusinessCount += 1;
      console.log(`\n[INVALID INTEGRATION] ${business.businessName}`);
      integrationValidation.errors.forEach((error) => console.log(`- ${error}`));
    }

    const services = getEnabledServicesForBusiness(business);

    for (const service of services) {
      if (service.scrapeDirectly === false || service.inferenceRole === "inferred") {
        continue;
      }

      const job = applyIntegrationToJob(
        {
          ...business,
          serviceName: service.serviceName,
          serviceType: service.serviceType,
          durationMinutes: service.durationMinutes,
          platformServiceId: service.platformServiceId,
          serviceButtonId: service.serviceButtonId,
          serviceId: service.serviceId,
          categoryText: service.categoryText,
          categoryName: service.categoryName,
          parentServiceText: service.parentServiceText,
          providerText: service.providerText,
          skipProvider: service.skipProvider,
          businessServiceId:
            service.businessServiceId || service.id || null,
          integrationValidation
        },
        integration
      );

      if (!job.integrationValidation.valid) {
        invalidServiceCount += 1;
        console.log(
          `\n[INVALID SERVICE] ${business.businessName} | ${service.serviceName}`
        );
        job.integrationValidation.errors.forEach((error) =>
          console.log(`- ${error}`)
        );
      }
    }
  }

  console.log("\n===== PLATFORM CONFIGURATION AUDIT =====");
  console.log(`Businesses checked: ${businesses.length}`);
  console.log(`Businesses with integration errors: ${invalidBusinessCount}`);
  console.log(`Direct-scrape services with configuration errors: ${invalidServiceCount}`);

  process.exitCode = invalidBusinessCount || invalidServiceCount ? 1 : 0;
}

run().catch((error) => {
  console.error("Platform configuration audit failed:", error);
  process.exit(1);
});