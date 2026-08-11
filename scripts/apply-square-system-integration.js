"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function filePath(relativePath) {
  return path.join(ROOT, relativePath);
}

function read(relativePath) {
  const target = filePath(relativePath);
  if (!fs.existsSync(target)) {
    throw new Error(`Required file not found: ${relativePath}`);
  }
  return fs.readFileSync(target, "utf8");
}

function write(relativePath, content) {
  fs.writeFileSync(filePath(relativePath), content, "utf8");
}

function backup(relativePath) {
  const source = filePath(relativePath);
  const target = `${source}.pre-square-system`;
  if (!fs.existsSync(target)) {
    fs.copyFileSync(source, target);
    console.log(`[BACKUP] ${relativePath} -> ${path.basename(target)}`);
  }
}

function replaceRequired(source, find, replacement, label) {
  if (source.includes(replacement)) {
    return source;
  }
  if (!source.includes(find)) {
    throw new Error(`Could not find patch marker for ${label}.`);
  }
  return source.replace(find, replacement);
}

function patchScrapeJs() {
  const relativePath = "scrape.js";
  backup(relativePath);
  let source = read(relativePath);

  source = replaceRequired(
    source,
    'const { scrapeHandStoneBusiness } = require("./scrapers/hand-stone");',
    'const { scrapeHandStoneBusiness } = require("./scrapers/hand-stone");\nconst { scrapeSquareBusiness } = require("./scrapers/square");',
    "Square scraper import"
  );

  if (!source.includes('String(job.platform || "").toLowerCase() === "square"')) {
    const oldDedicated = `function usesDedicatedBrowser(job = {}) {\n  return (\n    String(job.integrationType || "").toLowerCase() === "api" ||\n    String(job.platform || "").toLowerCase() === "meevo"\n  );\n}`;
    const newDedicated = `function usesDedicatedBrowser(job = {}) {\n  const platform = String(job.platform || "").toLowerCase();\n\n  return (\n    String(job.integrationType || "").toLowerCase() === "api" ||\n    platform === "meevo" ||\n    platform === "square"\n  );\n}`;
    source = replaceRequired(source, oldDedicated, newDedicated, "Square dedicated browser handling");
  }

  if (!source.includes('if (scrapeTarget.platform === "square")')) {
    const marker = '      if (scrapeTarget.platform === "hand-stone") {';
    const squareBranch = `      if (scrapeTarget.platform === "square") {\n        await closeScrapePage(page, context);\n\n        const result = await scrapeSquareBusiness(scrapeTarget);\n\n        return {\n          ...result,\n          businessName: scrapeTarget.businessName,\n          bookingUrl: result.bookingUrl || scrapeTarget.bookingUrl,\n          platform: "square",\n          service: result.service || result.serviceName || scrapeTarget.serviceName,\n          serviceName: result.serviceName || result.service || scrapeTarget.serviceName,\n          serviceType: result.serviceType || scrapeTarget.serviceType || "",\n          durationMinutes:\n            result.durationMinutes || scrapeTarget.durationMinutes || null,\n          platformServiceId:\n            scrapeTarget.platformServiceId ||\n            scrapeTarget.serviceId ||\n            result.platformServiceId ||\n            null,\n          provider:\n            result.provider ||\n            scrapeTarget.providerText ||\n            "Any available staff",\n          distanceMiles: scrapeTarget.distanceMiles || null,\n          attemptNumber: attempt,\n          scrapeDurationMs:\n            result.scrapeDurationMs || Date.now() - startedAt,\n          lastChecked:\n            result.lastChecked || new Date().toISOString(),\n          ...buildScrapeWindowPayload(scrapeTarget)\n        };\n      }\n\n\n`;
    if (!source.includes(marker)) {
      throw new Error("Could not find Hand & Stone dispatch marker in scrape.js.");
    }
    source = source.replace(marker, squareBranch + marker);
  }

  if (!/\"square\"\s*,?\s*\n\s*\"vagaro\"/.test(source)) {
    const oldList = '    "hand-stone",\n    "vagaro"';
    const newList = '    "hand-stone",\n    "square",\n    "vagaro"';
    source = replaceRequired(source, oldList, newList, "Square supported platform list");
  }

  write(relativePath, source);
  console.log("[PATCHED] scrape.js");
}

function patchPlatformDefinitions() {
  const relativePath = "public/platformDefinitions.js";
  backup(relativePath);
  let source = read(relativePath);

  if (!source.includes('square: {\n      key: "square"')) {
    const marker = '    "hand-stone": {';
    if (!source.includes(marker)) {
      throw new Error("Could not find Hand & Stone platform definition marker.");
    }

    const squareDefinition = `    square: {\n      key: "square",\n      label: "Square Appointments",\n      description: "Square Appointments public booking availability and Square Online service discovery.",\n      capabilities: ["scrape", "service_discovery", "provider_selection"],\n      integrationTypes: ["scrape"],\n      integrationFields: [\n        bookingUrl,\n        url("squareSiteUrl", "Square Site URL", {\n          required: true,\n          storage: "config",\n          aliases: ["squareWebsiteUrl"],\n          help: "The business Square Online site, for example https://business.square.site/."\n        }),\n        text("squarePublishedUserId", "Square Published User ID", {\n          required: true,\n          storage: "config",\n          aliases: ["publishedUserId"],\n          help: "Numeric published user ID used by the public Square sync endpoints."\n        }),\n        text("squareSiteId", "Square Site ID", {\n          required: true,\n          storage: "config",\n          aliases: ["siteId"],\n          help: "Numeric Square Online site ID used by the public Square sync endpoints."\n        }),\n        text("squareLocationId", "Square Location ID", {\n          required: true,\n          storage: "config",\n          aliases: ["locationId", "unitToken"],\n          help: "Square booking location token, for example 89AQ7C8CEM2SM."\n        })\n      ],\n      serviceFields: [\n        ...commonServiceFields,\n        serviceIdField({\n          label: "Square Service Item / Variation ID",\n          help: "Store either the Square catalog ITEM ID or exact ITEM_VARIATION ID. The scraper resolves the bookable variation before checking availability."\n        }),\n        text("providerText", "Provider Text", {\n          storage: "serviceConfig",\n          defaultValue: "Any available staff"\n        })\n      ]\n    },\n\n`;

    source = source.replace(marker, squareDefinition + marker);
  }

  write(relativePath, source);
  console.log("[PATCHED] public/platformDefinitions.js");
}

function patchAdminJs() {
  const relativePath = "public/admin.js";
  backup(relativePath);
  let source = read(relativePath);

  if (!source.includes("function renderSquareIntegrationFields")) {
    const marker = "function renderBusinessCard(business, index) {";
    if (!source.includes(marker)) {
      throw new Error("Could not find renderBusinessCard() in public/admin.js.");
    }

    const helpers = `function getSquareIntegrationConfigValue(business = {}, key = "") {\n  const integrations = Array.isArray(business.integrations)\n    ? business.integrations\n    : [];\n\n  const primaryIntegration =\n    integrations.find((item) => item?.isDefault === true) ||\n    integrations.find((item) => String(item?.platform || "").toLowerCase() === "square") ||\n    business.primaryIntegration ||\n    null;\n\n  return (\n    business.integrationConfig?.[key] ??\n    primaryIntegration?.config?.[key] ??\n    business[key] ??\n    ""\n  );\n}\n\nfunction setSquareIntegrationConfigValue(business = {}, key = "", value = "") {\n  if (!business || !key) return;\n\n  business.integrationConfig = {\n    ...(business.integrationConfig || {}),\n    [key]: value\n  };\n\n  // Keep a top-level copy for legacy integration normalization and easy admin inspection.\n  business[key] = value;\n\n  const integrations = Array.isArray(business.integrations)\n    ? business.integrations\n    : [];\n\n  const primaryIntegration =\n    integrations.find((item) => item?.isDefault === true) ||\n    integrations.find((item) => String(item?.platform || "").toLowerCase() === "square") ||\n    integrations[0] ||\n    null;\n\n  if (primaryIntegration) {\n    primaryIntegration.platform = business.platform || primaryIntegration.platform || "square";\n    primaryIntegration.config = {\n      ...(primaryIntegration.config || {}),\n      [key]: value\n    };\n  }\n}\n\nfunction syncSquarePrimaryIntegrationCoreField(business = {}, field = "", value = "") {\n  if (!business || !field) return;\n\n  const platform = String(\n    field === "platform" ? value : business.platform || ""\n  ).trim().toLowerCase();\n\n  if (platform !== "square") return;\n\n  const integrations = Array.isArray(business.integrations)\n    ? business.integrations\n    : [];\n\n  const primaryIntegration =\n    integrations.find((item) => item?.isDefault === true) ||\n    integrations.find((item) => String(item?.platform || "").toLowerCase() === "square") ||\n    integrations[0] ||\n    null;\n\n  if (!primaryIntegration) return;\n\n  if (field === "platform") primaryIntegration.platform = value;\n  if (field === "bookingUrl") primaryIntegration.bookingUrl = value;\n  if (field === "integrationType") primaryIntegration.integrationType = value;\n}\n\nfunction renderSquareIntegrationFields(business = {}, index) {\n  const platform = String(business.platform || "").trim().toLowerCase();\n  const keys = [\n    "squareSiteUrl",\n    "squarePublishedUserId",\n    "squareSiteId",\n    "squareLocationId"\n  ];\n\n  const hasSquareConfig = keys.some((key) =>\n    Boolean(getSquareIntegrationConfigValue(business, key))\n  );\n\n  return \`\n    <details class="services-section square-integration-section" \${platform === "square" || hasSquareConfig ? "open" : ""}>\n      <summary class="services-summary">\n        <span>Square Integration</span>\n        <small>Only used when Platform is square</small>\n      </summary>\n\n      <div class="services-inner">\n        <p class="admin-muted">\n          Enter the Square Online identifiers used by the universal Square scraper.\n          The service-level Square item or variation ID is entered under Services below.\n        </p>\n\n        <div class="business-edit-grid">\n          <label class="admin-field">\n            <span>Square Site URL</span>\n            <input\n              type="url"\n              data-square-business-index="\${index}"\n              data-square-config-key="squareSiteUrl"\n              value="\${escapeHtml(getSquareIntegrationConfigValue(business, "squareSiteUrl"))}"\n              placeholder="https://business.square.site/"\n            />\n          </label>\n\n          <label class="admin-field">\n            <span>Square Published User ID</span>\n            <input\n              type="text"\n              data-square-business-index="\${index}"\n              data-square-config-key="squarePublishedUserId"\n              value="\${escapeHtml(getSquareIntegrationConfigValue(business, "squarePublishedUserId"))}"\n            />\n          </label>\n\n          <label class="admin-field">\n            <span>Square Site ID</span>\n            <input\n              type="text"\n              data-square-business-index="\${index}"\n              data-square-config-key="squareSiteId"\n              value="\${escapeHtml(getSquareIntegrationConfigValue(business, "squareSiteId"))}"\n            />\n          </label>\n\n          <label class="admin-field">\n            <span>Square Location ID</span>\n            <input\n              type="text"\n              data-square-business-index="\${index}"\n              data-square-config-key="squareLocationId"\n              value="\${escapeHtml(getSquareIntegrationConfigValue(business, "squareLocationId"))}"\n              placeholder="89AQ7C8CEM2SM"\n            />\n          </label>\n        </div>\n      </div>\n    </details>\n  \`;\n}\n\nfunction getPlatformServiceIdLabel(businessIndex) {\n  const platform = String(\n    businessesCache?.[businessIndex]?.platform || ""\n  ).trim().toLowerCase();\n\n  return platform === "square"\n    ? "Square Service Item / Variation ID"\n    : "Platform Service ID";\n}\n\nfunction attachSquareIntegrationInputListeners() {\n  content\n    .querySelectorAll("[data-square-business-index][data-square-config-key]")\n    .forEach((fieldElement) => {\n      const update = () => {\n        const businessIndex = Number(fieldElement.dataset.squareBusinessIndex);\n        const key = fieldElement.dataset.squareConfigKey;\n        const business = businessesCache[businessIndex];\n\n        if (!business || !key) return;\n\n        setSquareIntegrationConfigValue(business, key, fieldElement.value);\n        setStatus("Unsaved Square integration changes.", "info");\n      };\n\n      fieldElement.addEventListener("input", update);\n      fieldElement.addEventListener("change", update);\n    });\n\n  content\n    .querySelectorAll(\n      '[data-index][data-field="platform"], ' +\n      '[data-index][data-field="bookingUrl"], ' +\n      '[data-index][data-field="integrationType"]'\n    )\n    .forEach((fieldElement) => {\n      const update = () => {\n        const businessIndex = Number(fieldElement.dataset.index);\n        const field = fieldElement.dataset.field;\n        const business = businessesCache[businessIndex];\n        if (!business) return;\n\n        syncSquarePrimaryIntegrationCoreField(\n          business,\n          field,\n          fieldElement.value\n        );\n      };\n\n      fieldElement.addEventListener("input", update);\n      fieldElement.addEventListener("change", update);\n    });\n}\n\n`;

    source = source.replace(marker, helpers + marker);
  }

  if (!source.includes("${renderSquareIntegrationFields(business, index)}")) {
    const marker = '${renderInput("Credential ID", "credentialId", business.credentialId, index)}';
    if (!source.includes(marker)) {
      throw new Error("Could not find Credential ID field in business editor.");
    }
    source = source.replace(
      marker,
      `${marker}\n          \${renderSquareIntegrationFields(business, index)}`
    );
  }

  if (!source.includes('getPlatformServiceIdLabel(businessIndex),\n            "platformServiceId"')) {
    const oldServiceLabel = '            "Platform Service ID",\n            "platformServiceId",';
    const newServiceLabel = '            getPlatformServiceIdLabel(businessIndex),\n            "platformServiceId",';
    source = replaceRequired(
      source,
      oldServiceLabel,
      newServiceLabel,
      "Square service ID label"
    );
  }

  if (!source.includes("attachSquareIntegrationInputListeners();")) {
    source = source.replace(
      /attachBusinessInputListeners\(\);/g,
      'attachBusinessInputListeners();\n  attachSquareIntegrationInputListeners();'
    );
  }

  write(relativePath, source);
  console.log("[PATCHED] public/admin.js");
}

function main() {
  console.log("Applying NextAppt Square system integration...");
  patchScrapeJs();
  patchPlatformDefinitions();
  patchAdminJs();
  console.log("\nSquare integration patches applied successfully.");
  console.log("Run: node scripts/verify-square-system-integration.js");
}

try {
  main();
} catch (error) {
  console.error("\n[Square integration patch failed]", error.message);
  process.exitCode = 1;
}