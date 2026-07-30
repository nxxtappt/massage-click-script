#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(process.cwd());

const checks = [
  {
    file: "database/BusinessRepository.js",
    required: [
      "function buildLocationsForSave(business = {})",
      "const locations = buildLocationsForSave(business);"
    ]
  },
  {
    file: "businessManager.js",
    required: [
      "function clearInventoryBusinessMetadataCache()",
      "clearInventoryBusinessMetadataCache();\n  return businessCache;"
    ]
  },
  {
    file: "inventoryManager.js",
    required: [
      "function clearBusinessMetadataCache()",
      "const hasBusinessMetadata = Boolean(metadata.businessName);",
      "const latitude = hasBusinessMetadata",
      "address: hasBusinessMetadata",
      "clearBusinessMetadataCache\n};"
    ]
  },
  {
    file: "public/app.js",
    required: [
      "function parseMapCoordinate(value, minimum, maximum)",
      "function getAppointmentMapCoordinates(appointment = {})",
      "const coordinates = getAppointmentMapCoordinates(firstAppointment || {});",
      ".filter(Boolean);"
    ]
  }
];

let failures = 0;

for (const check of checks) {
  const absolutePath = path.join(root, check.file);

  if (!fs.existsSync(absolutePath)) {
    console.error(`MISSING: ${check.file}`);
    failures += 1;
    continue;
  }

  const source = fs.readFileSync(absolutePath, "utf8");

  for (const required of check.required) {
    if (!source.includes(required)) {
      console.error(`FAILED: ${check.file} is missing ${JSON.stringify(required)}`);
      failures += 1;
    }
  }

  try {
    execFileSync(process.execPath, ["--check", absolutePath], { stdio: "pipe" });
    console.log(`PASS: ${check.file}`);
  } catch (error) {
    console.error(`SYNTAX FAILED: ${check.file}`);
    console.error(String(error.stderr || error.message));
    failures += 1;
  }
}

if (failures) {
  console.error(`\nVerification failed with ${failures} problem(s).`);
  process.exitCode = 1;
} else {
  console.log("\nAll location fixes are present and all updated files pass node --check.");
}