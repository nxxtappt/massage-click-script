"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = process.cwd();
const scrapePath = path.join(root, "scrape.js");
const squarePath = path.join(root, "scrapers", "square.js");

execFileSync(process.execPath, ["--check", scrapePath], { stdio: "pipe" });
execFileSync(process.execPath, ["--check", squarePath], { stdio: "pipe" });

const scrape = fs.readFileSync(scrapePath, "utf8");
const square = require(squarePath);

if (!scrape.includes("const result = await scrapeSquareBusiness(scrapeTarget);")) {
  throw new Error("Fixed Square dispatch call is missing.");
}
if (scrape.includes("scrapeSquareBusiness(page, scrapeTarget, attempt)")) {
  throw new Error("Old Square dispatch call is still present.");
}
if (typeof square.scrapeSquareBusiness !== "function") {
  throw new Error("Square scraper export is missing.");
}

console.log("[OK] scrape.js syntax");
console.log("[OK] square.js syntax");
console.log("[OK] Square dispatch now passes scrapeTarget directly");
console.log("[OK] Old page-first Square dispatch removed");
console.log("Square dispatch hotfix verified.");