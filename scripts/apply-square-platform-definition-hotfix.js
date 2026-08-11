"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "public", "platformDefinitions.js");
const BACKUP = `${TARGET}.pre-square-definition-hotfix`;

function findObjectBlock(source, key) {
  const marker = `    ${key}: {`;
  const start = source.indexOf(marker);

  if (start < 0) {
    throw new Error(`Could not find ${key} platform definition.`);
  }

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = braceStart; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        let end = i + 1;

        if (source[end] === ",") {
          end += 1;
        }

        return { start, end };
      }
    }
  }

  throw new Error(`Could not determine end of ${key} platform definition.`);
}

const squareDefinition = `    square: {
      key: "square",
      label: "Square Appointments",
      description:
        "Square public booking pages with public service/staff discovery and buyer availability capture.",
      capabilities: [
        "scrape",
        "service_discovery",
        "provider_selection"
      ],
      integrationTypes: ["scrape"],
      integrationFields: [
        bookingUrl,

        url("squareSiteUrl", "Square Site URL", {
          requiredFor: ["scrape"],
          storage: "config",
          aliases: [
            "squareWebsiteUrl",
            "square_site_url"
          ],
          help:
            "The business public *.square.site URL used for Square service, staff, and location discovery."
        }),

        text("squarePublishedUserId", "Square Published User ID", {
          requiredFor: ["scrape"],
          storage: "config",
          aliases: [
            "publishedUserId",
            "square_published_user_id"
          ],
          help:
            "The numeric published user ID from the public Square square-sync booking endpoints."
        }),

        text("squareSiteId", "Square Site ID", {
          requiredFor: ["scrape"],
          storage: "config",
          aliases: [
            "siteId",
            "square_site_id"
          ],
          help:
            "The numeric Square Online site ID used by the public square-sync booking endpoints."
        }),

        text("squareLocationId", "Square Location ID", {
          requiredFor: ["scrape"],
          storage: "config",
          aliases: [
            "locationId",
            "unitToken",
            "square_location_id"
          ],
          help:
            "Square location/unit token used for service discovery and availability."
        }),

        text("businessLocationId", "Square Business Location UUID", {
          storage: "config",
          aliases: [
            "squareBusinessLocationId",
            "business_location_id"
          ],
          help:
            "Optional Square booking business-location UUID when known."
        }),

        text("squareBusinessId", "Square Booking Business UUID", {
          storage: "config",
          aliases: [
            "businessId",
            "square_business_id"
          ],
          help:
            "Optional Square booking business UUID when known."
        }),

        text("squareClientId", "Square Booking Client ID", {
          storage: "config",
          aliases: [
            "clientId",
            "square_client_id"
          ],
          help:
            "Optional public Square booking client/application ID."
        })
      ],
      serviceFields: [
        ...commonServiceFields,

        text("platformServiceId", "Square Service Item / Variation ID", {
          required: true,
          storage: "service",
          aliases: [
            "serviceId",
            "serviceButtonId",
            "itemId",
            "serviceVariationId",
            "squareServiceVariationId"
          ],
          help:
            "Square Catalog ITEM ID or ITEM_VARIATION ID. The Square scraper resolves ITEM IDs to a bookable variation."
        }),

        text("staffId", "Square Staff ID", {
          storage: "serviceConfig",
          aliases: ["squareStaffId"]
        }),

        text("providerText", "Provider Text", {
          storage: "serviceConfig",
          defaultValue: "Any available staff"
        })
      ]
    },`;

function main() {
  if (!fs.existsSync(TARGET)) {
    throw new Error("public/platformDefinitions.js not found.");
  }

  const source = fs.readFileSync(TARGET, "utf8");
  const block = findObjectBlock(source, "square");

  if (!fs.existsSync(BACKUP)) {
    fs.writeFileSync(BACKUP, source);
    console.log(
      `[BACKUP] ${path.relative(ROOT, TARGET)} -> ${path.basename(BACKUP)}`
    );
  }

  const updated =
    source.slice(0, block.start) +
    squareDefinition +
    source.slice(block.end);

  fs.writeFileSync(TARGET, updated);

  console.log("[PATCHED] public/platformDefinitions.js");
  console.log("[OK] Square platform definition now includes:");
  console.log("     squareSiteUrl");
  console.log("     squarePublishedUserId");
  console.log("     squareSiteId");
  console.log("     squareLocationId");
  console.log("     + existing optional Square IDs");
  console.log("     + Square Service Item / Variation ID");
}

try {
  main();
} catch (error) {
  console.error("[SQUARE DEFINITION HOTFIX FAILED]", error.message);
  process.exitCode = 1;
}