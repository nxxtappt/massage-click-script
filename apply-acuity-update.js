"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRAPE_FILE = path.join(ROOT, "scrape.js");
const DEFINITIONS_FILE = path.join(ROOT, "public", "platformDefinitions.js");
const ACUITY_SOURCE = path.join(__dirname, "acuity.js");
const ACUITY_DEST = path.join(ROOT, "scrapers", "acuity.js");

function fail(message) {
  throw new Error(message);
}

function read(file) {
  if (!fs.existsSync(file)) fail(`Missing file: ${file}`);
  return fs.readFileSync(file, "utf8");
}

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.pre-acuity-${stamp}`;
  fs.copyFileSync(file, dest);
  return dest;
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    fail(`Could not find patch anchor: ${label}`);
  }

  return source.replace(search, replacement);
}

function patchScrapeJs(source) {
  if (!source.includes('require("./scrapers/acuity")')) {
    source = replaceOnce(
      source,
      'const { scrapeJaneBusiness } = require("./scrapers/jane");',
      'const { scrapeJaneBusiness } = require("./scrapers/jane");\nconst { scrapeAcuityBusiness } = require("./scrapers/acuity");',
      "Acuity require"
    );
  }

  if (!source.includes('platform === "acuity"')) {
    source = replaceOnce(
      source,
      'platform === "austindeep"',
      'platform === "austindeep" ||\n    platform === "acuity"',
      "dedicated-browser platform list"
    );
  }

  if (!source.includes('scrapeTarget.platform === "acuity"')) {
    const acuityBranch = `
      if (scrapeTarget.platform === "acuity") {
        await closeScrapePage(page, context);

        const result = await scrapeAcuityBusiness(scrapeTarget);

        return {
          ...result,
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: "acuity",
          serviceName:
            scrapeTarget.serviceName || result.serviceName || result.service || "",
          service:
            scrapeTarget.serviceName || result.serviceName || result.service || "",
          serviceType: scrapeTarget.serviceType || result.serviceType || "",
          durationMinutes:
            scrapeTarget.durationMinutes || result.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId ||
            scrapeTarget.serviceId ||
            result.platformServiceId ||
            null,
          distanceMiles: scrapeTarget.distanceMiles || null,
          attemptNumber: attempt,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

`;

    source = replaceOnce(
      source,
      '      if (scrapeTarget.platform === "jane") {',
      acuityBranch + '      if (scrapeTarget.platform === "jane") {',
      "Acuity scrape branch"
    );
  }

  if (!source.match(/"acuity"\s*,\s*\n\s*"jane"/)) {
    source = replaceOnce(
      source,
      '    "square",\n    "jane",',
      '    "square",\n    "acuity",\n    "jane",',
      "supported platform list"
    );
  }

  return source;
}

function patchPlatformDefinitions(source) {
  if (source.includes('acuity: {\n      key: "acuity"')) {
    return source;
  }

  const definition = `
    acuity: {
      key: "acuity",
      label: "Acuity Scheduling",
      description:
        "Acuity / Squarespace Scheduling public availability endpoint. Uses one JSON request per configured appointment type.",
      capabilities: ["scrape"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("acuityOwnerId", "Acuity Owner ID", {
          storage: "config",
          aliases: ["ownerId", "owner"],
          help:
            "Optional for modern /schedule/{owner} URLs because it is parsed automatically. Configure this for custom .as.me links when automatic discovery is not possible."
        }),
        text("calendarId", "Acuity Calendar ID", {
          storage: "config",
          defaultValue: "any",
          help:
            "Use any to combine all calendars/providers for the service. Set a specific calendar ID for a location-specific business record."
        }),
        text("timezone", "Acuity Timezone", {
          storage: "config",
          defaultValue: "America/Chicago",
          help: "IANA timezone such as America/Chicago."
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Acuity Appointment Type ID", {
          required: true,
          storage: "service",
          aliases: ["appointmentTypeId", "appointmentTypeID", "serviceId", "serviceButtonId"],
          help:
            "The Acuity appointmentTypeId for this public service. This is stable and is the only required Acuity-specific service identifier."
        }),
        text("acuityCalendarId", "Calendar ID Override", {
          storage: "serviceConfig",
          aliases: ["calendarId", "calendarID"],
          help:
            "Optional per-service calendar override. Leave blank to use the integration Calendar ID or any."
        })
      ]
    },

`;

  return replaceOnce(source, "    axl3: {", definition + "    axl3: {", "Acuity platform definition");
}

function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!fs.existsSync(ACUITY_SOURCE)) {
    fail(`Place acuity.js beside this patch script first: ${ACUITY_SOURCE}`);
  }

  let scrapeSource = read(SCRAPE_FILE);
  let definitionsSource = read(DEFINITIONS_FILE);

  const patchedScrape = patchScrapeJs(scrapeSource);
  const patchedDefinitions = patchPlatformDefinitions(definitionsSource);

  if (dryRun) {
    console.log("Acuity patch anchors validated successfully. No files changed.");
    return;
  }

  fs.mkdirSync(path.dirname(ACUITY_DEST), { recursive: true });

  const backups = [];
  backups.push(backup(SCRAPE_FILE));
  backups.push(backup(DEFINITIONS_FILE));

  fs.copyFileSync(ACUITY_SOURCE, ACUITY_DEST);
  fs.writeFileSync(SCRAPE_FILE, patchedScrape);
  fs.writeFileSync(DEFINITIONS_FILE, patchedDefinitions);

  console.log("Acuity update applied.");
  console.log(`Created: ${ACUITY_DEST}`);
  console.log("Backups:");
  backups.forEach((file) => console.log(`  ${file}`));
  console.log("\nRun next:");
  console.log("  node --check scrapers/acuity.js");
  console.log("  node --check scrape.js");
  console.log("  node --check public/platformDefinitions.js");
}

main();