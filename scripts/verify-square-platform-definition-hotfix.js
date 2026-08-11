"use strict";

const defs = require("../public/platformDefinitions");
const registry = require("../platformIntegrationRegistry");

const requiredKeys = [
  "squareSiteUrl",
  "squarePublishedUserId",
  "squareSiteId",
  "squareLocationId"
];

const square = defs.square;

if (!square) {
  throw new Error("Square definition missing.");
}

const configFields = new Set(
  (square.integrationFields || [])
    .filter((field) => field.storage === "config")
    .map((field) => field.key)
);

for (const key of requiredKeys) {
  if (!configFields.has(key)) {
    throw new Error(`Missing Square config field: ${key}`);
  }
}

const business = {
  businessName: "Square Definition Test",
  platform: "square",
  integrationType: "scrape",
  bookingUrl: "https://book.squareup.com/test",
  integrationConfig: {
    squareSiteUrl: "https://example.square.site/",
    squarePublishedUserId: "123",
    squareSiteId: "456",
    squareLocationId: "LOC123"
  }
};

const [integration] = registry.normalizeBusinessIntegrations(business);
const validation = registry.validateIntegration(integration, business);

if (!validation.valid) {
  throw new Error(validation.errors.join(" "));
}

for (const key of requiredKeys) {
  if (integration.config[key] !== business.integrationConfig[key]) {
    throw new Error(`${key} did not survive normalization.`);
  }
}

console.log("[OK] Square platform definition fields");
console.log("[OK] Square integration validation");
console.log("[OK] Square config normalization");
console.log("Square platform definition hotfix verified.");