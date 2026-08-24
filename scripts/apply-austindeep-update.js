"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRAPE_FILE = path.join(ROOT, "scrape.js");
const PLATFORM_FILE = path.join(ROOT, "public", "platformDefinitions.js");
const SCRAPER_FILE = path.join(ROOT, "scrapers", "austindeep.js");

function fail(message) {
  throw new Error(`[AUSTINDEEP PATCH] ${message}`);
}

function backup(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.pre-austindeep-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`[AUSTINDEEP PATCH] Backup: ${backupPath}`);
}

function replaceOnce(source, searchValue, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(searchValue)) fail(`Could not find anchor for ${label}.`);
  return source.replace(searchValue, replacement);
}

function installScraper() {
  const sourcePath = path.join(__dirname, "..", "austindeep.js");
  const alternateSourcePath = path.join(ROOT, "austindeep.js");
  const resolvedSource = fs.existsSync(sourcePath) ? sourcePath : alternateSourcePath;

  if (!fs.existsSync(resolvedSource)) {
    fail(
      "austindeep.js was not found. Put austindeep.js in the repository root before running this patch."
    );
  }

  fs.mkdirSync(path.dirname(SCRAPER_FILE), { recursive: true });
  fs.copyFileSync(resolvedSource, SCRAPER_FILE);
  console.log("[AUSTINDEEP PATCH] Installed scrapers/austindeep.js");
}

function patchScrapeJs() {
  if (!fs.existsSync(SCRAPE_FILE)) fail("scrape.js not found.");
  backup(SCRAPE_FILE);

  let source = fs.readFileSync(SCRAPE_FILE, "utf8");

  source = replaceOnce(
    source,
    'const { scrapeAxl3Business } = require("./scrapers/axl3");',
    'const { scrapeAxl3Business } = require("./scrapers/axl3");\nconst { scrapeAustinDeepBusiness } = require("./scrapers/austindeep");',
    "Austin Deep scraper import"
  );

  if (!source.includes('platform === "austindeep"')) {
    source = source.replace(
      /platform === "meevo"\s*\|\|\s*platform === "square"/,
      'platform === "meevo" ||\n    platform === "square" ||\n    platform === "austindeep"'
    );

    if (!source.includes('platform === "austindeep"')) {
      fail("Could not patch usesDedicatedBrowser for Austin Deep.");
    }
  }

  if (!source.includes('scrapeTarget.platform === "austindeep"')) {
    const dispatchAnchor = '      if (scrapeTarget.platform === "axl3") {';

    const dispatchBlock = `      if (scrapeTarget.platform === "austindeep") {
        const result = await scrapeAustinDeepBusiness(scrapeTarget);
        await closeScrapePage(page, context);

        return {
          ...result,
          businessName: scrapeTarget.businessName,
          bookingUrl: scrapeTarget.bookingUrl,
          platform: "austindeep",
          serviceName:
            scrapeTarget.serviceName || result.serviceName || result.service || "",
          service:
            scrapeTarget.serviceName || result.serviceName || result.service || "",
          serviceType:
            scrapeTarget.serviceType || result.serviceType || "deep_tissue",
          durationMinutes:
            scrapeTarget.durationMinutes || result.durationMinutes || null,
          platformServiceId:
            scrapeTarget.platformServiceId ||
            scrapeTarget.sessionTypeId ||
            scrapeTarget.serviceId ||
            result.platformServiceId ||
            null,
          provider: result.provider || "Any Available Therapist",
          distanceMiles: scrapeTarget.distanceMiles || null,
          attemptNumber: attempt,
          ...buildScrapeWindowPayload(scrapeTarget)
        };
      }

`;

    if (!source.includes(dispatchAnchor)) fail("Could not find AXL3 dispatch anchor.");
    source = source.replace(dispatchAnchor, dispatchBlock + dispatchAnchor);
  }

  const supportedStart = source.indexOf("const supportedPlatforms = [");
  if (supportedStart === -1) fail("Could not find supportedPlatforms array.");

  const supportedEnd = source.indexOf("];", supportedStart);
  if (supportedEnd === -1) fail("Could not find end of supportedPlatforms array.");

  let supportedBlock = source.slice(supportedStart, supportedEnd + 2);

  if (!supportedBlock.includes('"austindeep"')) {
    if (supportedBlock.includes('    "axl3",')) {
      supportedBlock = supportedBlock.replace(
        '    "axl3",',
        '    "axl3",\n    "austindeep",'
      );
    } else {
      fail("Could not find axl3 entry inside supportedPlatforms.");
    }

    source =
      source.slice(0, supportedStart) +
      supportedBlock +
      source.slice(supportedEnd + 2);
  }

  fs.writeFileSync(SCRAPE_FILE, source);
  console.log("[AUSTINDEEP PATCH] Patched scrape.js");
}

function patchPlatformDefinitions() {
  if (!fs.existsSync(PLATFORM_FILE)) fail("public/platformDefinitions.js not found.");
  backup(PLATFORM_FILE);

  let source = fs.readFileSync(PLATFORM_FILE, "utf8");

  if (!source.includes("austindeep: {")) {
    const anchor = "    booker: {";

    const definition = `    austindeep: {
      key: "austindeep",
      label: "Austin Deep Custom",
      description: "Austin Deep custom availability API backed by Mindbody.",
      capabilities: ["scrape", "provider_selection"],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,
        text("site", "Austin Deep Site Slug", {
          required: true,
          storage: "config",
          help: "Examples: barton-creek or lake-austin. This selects the Austin Deep/Mindbody site."
        }),
        text("locationId", "API Location ID", {
          required: true,
          storage: "config",
          defaultValue: "1",
          help: "Mindbody/API locationId for this site. Barton Creek and Lake Austin currently use 1."
        })
      ],
      serviceFields: [
        ...commonServiceFields,
        text("platformServiceId", "Mindbody Session Type ID", {
          required: true,
          storage: "service",
          aliases: ["serviceId", "sessionTypeId", "serviceButtonId"],
          help: "Austin Deep Mindbody session type ID, e.g. 136 for THE DEEP 30min."
        }),
        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "Any Available Therapist"
        })
      ]
    },

`;

    if (!source.includes(anchor)) fail("Could not find Booker definition anchor.");
    source = source.replace(anchor, definition + anchor);
  }

  fs.writeFileSync(PLATFORM_FILE, source);
  console.log("[AUSTINDEEP PATCH] Patched public/platformDefinitions.js");
}

function verify() {
  const scrape = fs.readFileSync(SCRAPE_FILE, "utf8");
  const platforms = fs.readFileSync(PLATFORM_FILE, "utf8");

  const checks = [
    [fs.existsSync(SCRAPER_FILE), "scrapers/austindeep.js exists"],
    [scrape.includes('require("./scrapers/austindeep")'), "scrape.js imports Austin Deep"],
    [scrape.includes('scrapeTarget.platform === "austindeep"'), "scrape.js dispatches Austin Deep"],
    [scrape.includes('platform === "austindeep"'), "Austin Deep does not require shared Playwright"],
    [platforms.includes("austindeep: {"), "platform definition exists"]
  ];

  let failed = false;

  for (const [ok, label] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
    if (!ok) failed = true;
  }

  if (failed) process.exitCode = 1;
}

installScraper();
patchScrapeJs();
patchPlatformDefinitions();
verify();