"use strict";

// A dry run of scheduling, normalization, and inference without credentials or DB.
const assert = require("node:assert/strict");
const Module = require("node:module");
const load = Module._load;
Module._load = function (name, parent, main) {
  if (name === "pg") return { Pool: class {} };
  return load.call(this, name, parent, main);
};

const { buildScrapeJobs } = require("../jobBuilder");
const { mergeConfirmedAndInferredAppointments } = require("../availabilityInferenceEngine");
const { normalizeMindbodyAppointment } = require("../syncMindbodyBusiness");

function studio(name, credentialId) {
  return {
    businessName: name, platform: "mindbody", integrationType: "api",
    credentialId, apiProvider: "mindbody", bookingUrl: "https://example.test",
    services: [
      { id: 101, serviceName: "Massage 90", serviceType: "massage",
        durationMinutes: 90, sessionTypeId: 901, inferenceRole: "anchor",
        inferShorterDurations: true, priority: "high", discoveryStatus: "approved" },
      { id: 102, serviceName: "Massage 60", serviceType: "massage",
        durationMinutes: 60, sessionTypeId: 902, inferenceRole: "inferred",
        anchorServiceId: 101, priority: "high", discoveryStatus: "approved" }
    ]
  };
}

for (const business of [studio("Studio A", "credential-a"), studio("Studio B", "credential-b")]) {
  const jobs = buildScrapeJobs([business], { manual: true, ignoreServiceRules: true });
  assert.deepEqual(jobs.map((job) => job.serviceName), ["Massage 90", "Massage 60"]);
  assert.equal(jobs[0].credentialId, business.credentialId);

  const economical = structuredClone(business);
  economical.apiInferenceSkipMappedTargets = true;
  const anchorOnly = buildScrapeJobs([economical], { manual: true, ignoreServiceRules: true });
  assert.deepEqual(anchorOnly.map((job) => job.serviceName), ["Massage 90"]);

  const direct = buildScrapeJobs([business], { manual: true, serviceName: "Massage 60" });
  assert.deepEqual(direct.map((job) => job.serviceName), ["Massage 60"]);

  const normalized = normalizeMindbodyAppointment({
    businessName: business.businessName, bookingUrl: business.bookingUrl,
    service: business.services[0], timeZone: "America/Los_Angeles",
    appointment: { StartDateTime: "2026-10-01T02:00:00Z", Staff: { Id: 200, Name: "Provider A" } }
  });
  assert.equal(normalized.localDateKey, "2026-09-30");
  assert.equal(normalized.localTimeKey, "19:00");
  assert.equal(normalized.platform, "mindbody");

  const merged = mergeConfirmedAndInferredAppointments(
    [{ ...normalized, businessServiceId: 101 }], business,
    { inferenceMode: "api_pipeline" }
  );
  assert(merged.some((item) => item.sourceType === "inferred" &&
    item.businessServiceId === 102 && item.timezone === "America/Los_Angeles"));
  assert(merged.filter((item) => item.sourceType === "inferred")
    .every((item) => item.inferenceMode === "api_pipeline"));

  const withoutAnchor = structuredClone(economical);
  withoutAnchor.services[0].enabled = false;
  const fallback = buildScrapeJobs([withoutAnchor], { manual: true, ignoreServiceRules: true });
  assert.deepEqual(fallback.map((job) => job.serviceName), ["Massage 60"]);
}

console.log("API inference dry run passed for two separate studios, direct queries, fallback and local time.");
