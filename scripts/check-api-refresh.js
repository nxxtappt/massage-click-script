"use strict";
require("dotenv").config();
const db = require("../db");
const businessManager = require("../businessManager");
const { buildScrapeJobs } = require("../jobBuilder");
const { readCredential } = require("../database/crmCredentialRepository");
const { getAdapter } = require("../crmProviders/registry");

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Usage: node scripts/check-api-refresh.js "Business name"');
  const businesses = await businessManager.getAllBusinesses({ includeDisabled: false });
  const matches = businesses.filter((b) => [b.businessName, b.businessId]
    .some((value) => String(value || "").toLowerCase() === name.toLowerCase()));
  if (matches.length !== 1) throw new Error("Expected exactly one enabled business matching this name or ID.");
  const jobs = buildScrapeJobs(matches, {
    manual: true, integrationType: "api", ignoreServiceRules: true,
    daysForward: 1, allowInvalidJobs: true
  });
  if (!jobs.length) throw new Error("No enabled API services resolved. Check the business integration and enabled services.");
  const checked = new Set();
  for (const job of jobs) {
    if (!job.jobValidation.valid) throw new Error(job.jobValidation.errors.join(" "));
    const adapter = getAdapter(job.apiProvider);
    if (typeof adapter.syncAppointments !== "function") throw new Error("No availability sync adapter installed.");
    if (!checked.has(job.credentialId)) {
      const credential = await readCredential(job.credentialId, job.businessId || job.businessName);
      if (credential.provider !== job.apiProvider) throw new Error("Credential provider mismatch.");
      checked.add(job.credentialId);
    }
  }
  console.log(JSON.stringify({ business: matches[0].businessName, vaultDecryption: "PASS",
    mode: "api", scope: "Enabled services; priority rules ignored for this diagnostic only",
    services: jobs.map((j) => ({ name: j.serviceName, provider: j.apiProvider,
      sessionTypeId: j.sessionTypeId || j.platformServiceId || j.serviceId })) }, null, 2));
  console.log("Read-only configuration check. No provider calls or inventory writes performed. No keys printed.");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.pool?.end());
