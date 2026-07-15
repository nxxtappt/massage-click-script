#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const target = path.resolve(process.cwd(), "database/BusinessRepository.js");

if (!fs.existsSync(target)) {
  console.error(`Missing file: ${target}`);
  process.exit(1);
}

const original = fs.readFileSync(target, "utf8");
let updated = original;

function replaceOnce(search, replacement, label) {
  const count = updated.split(search).length - 1;

  if (count !== 1) {
    throw new Error(
      `${label}: expected exactly one match, found ${count}. No changes were written.`
    );
  }

  updated = updated.replace(search, replacement);
}

replaceOnce(
`function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function toCleanRawJson`,
`function cleanObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeTextArray(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  return [...new Set(
    values
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function toCleanRawJson`,
"add normalizeTextArray"
);

replaceOnce(
`    inferServiceTypes: Array.isArray(input.inferServiceTypes)
      ? input.inferServiceTypes
      : Array.isArray(inference.inferServiceTypes)
        ? inference.inferServiceTypes
        : [],`,
`    inferServiceTypes: normalizeTextArray(
      input.inferServiceTypes !== undefined
        ? input.inferServiceTypes
        : inference.inferServiceTypes
    ),`,
"normalize inferServiceTypes"
);

replaceOnce(
`          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW()`,
`          $19,$20,$21,$22,$23,$24,$25::text[],$26,$27,$28,$29,NOW()`,
"cast infer_service_types as text[]"
);

if (updated === original) {
  console.log("No changes were necessary.");
  process.exit(0);
}

const backup = `${target}.before-infer-service-types-fix`;
fs.writeFileSync(backup, original, "utf8");
fs.writeFileSync(target, updated, "utf8");

console.log(`Updated: ${target}`);
console.log(`Backup:  ${backup}`);