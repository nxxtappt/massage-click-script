"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "scrape.js");
const BACKUP = `${TARGET}.pre-square-dispatch-hotfix`;
const OLD = 'const result = await scrapeSquareBusiness(page, scrapeTarget, attempt);';
const NEW = 'const result = await scrapeSquareBusiness(scrapeTarget);';

try {
  if (!fs.existsSync(TARGET)) throw new Error("scrape.js not found.");
  const source = fs.readFileSync(TARGET, "utf8");

  if (source.includes(NEW)) {
    console.log("[OK] Square dispatch is already fixed.");
    process.exit(0);
  }

  if (!source.includes(OLD)) {
    throw new Error("Could not find the old Square dispatch call. No changes were made.");
  }

  if (!fs.existsSync(BACKUP)) {
    fs.writeFileSync(BACKUP, source);
    console.log("[BACKUP] scrape.js -> scrape.js.pre-square-dispatch-hotfix");
  }

  fs.writeFileSync(TARGET, source.replace(OLD, NEW));
  console.log("[PATCHED] scrape.js Square dispatch argument order.");
} catch (error) {
  console.error("[SQUARE DISPATCH HOTFIX FAILED]", error.message);
  process.exitCode = 1;
}