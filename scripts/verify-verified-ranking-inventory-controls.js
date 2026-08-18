#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  console.log(`✓ ${message}`);
}

function checkSyntax(rel) {
  execFileSync(process.execPath, ["--check", path.join(ROOT, rel)], {
    stdio: "pipe"
  });
  console.log(`✓ syntax: ${rel}`);
}

async function main() {
  const migration = read("db/migrations/017_verified_business_ranking_inventory_controls.sql");
  assert(migration.includes("verified_rank"), "migration adds verified_rank");
  assert(migration.includes("public_inventory_visible"), "migration adds public_inventory_visible");
  assert(migration.includes("public_inventory_limit"), "migration adds public_inventory_limit");

  const repo = read("database/BusinessRepository.js");
  assert(repo.includes("verified_rank:"), "BusinessRepository persists verified rank");
  assert(repo.includes("public_inventory_visible:"), "BusinessRepository persists public inventory visibility");
  assert(repo.includes("public_inventory_limit:"), "BusinessRepository persists public inventory card limit");

  const manager = read("businessManager.js");
  assert(manager.includes("verifiedRank:"), "businessManager exposes verifiedRank");
  assert(manager.includes("publicInventoryVisible:"), "businessManager exposes publicInventoryVisible");
  assert(manager.includes("publicInventoryLimit:"), "businessManager exposes publicInventoryLimit");

  const inventory = read("inventoryManager.js");
  assert(inventory.includes("includeHiddenInventory"), "inventoryManager supports internal hidden-inventory override");
  assert(
    inventory.includes("normalized.publicInventoryVisible === false"),
    "inventoryManager hides public inventory when admin disables it"
  );

  const admin = read("public/admin.js");
  assert(admin.includes("Verified Search Rank (0-100)"), "admin has verified search rank control");
  assert(admin.includes("Show this business inventory publicly"), "admin has public inventory visibility control");
  assert(admin.includes("Visible Times on Search Card (1-20)"), "admin has visible-times control");

  const app = read("public/app.js");
  assert(app.includes("verified-business-card"), "search UI applies verified-business-card class");
  assert(app.includes("getPublicInventoryLimit"), "search UI obeys per-business visible-time limit");
  assert(app.includes("compareRankedAppointments"), "client ordering preserves verified/admin rank");

  const styles = read("public/styles.css");
  assert(styles.includes("outline: 4px solid #002b49;"), "verified cards use requested 4px #002b49 outline");
  assert(
    !styles.includes("background: linear-gradient(180deg, #ffffff 0%, #f4f9fc 100%);") ||
      !/\.business-card\.verified-business-card\s*\{[\s\S]{0,300}background:\s*linear-gradient/.test(styles),
    "verified card no longer changes the card background"
  );

  [
    "database/BusinessRepository.js",
    "businessManager.js",
    "inventoryManager.js",
    "rankingEngine.js",
    "public/admin.js",
    "public/app.js"
  ].forEach(checkSyntax);

  // Runtime ranking behavior test.
  const ranking = require(path.join(ROOT, "rankingEngine.js"));
  const common = {
    platform: "test",
    serviceName: "60 Minute Massage",
    serviceCategory: "massage",
    durationMinutes: 60,
    localSortable: 209901010900,
    latitude: 30.2672,
    longitude: -97.7431
  };

  const unverified = {
    ...common,
    businessName: "Unverified Test",
    verificationStatus: "unclaimed",
    verifiedRank: 100
  };

  const verifiedLow = {
    ...common,
    businessName: "Verified Low",
    verificationStatus: "verified",
    verifiedRank: 10
  };

  const verifiedHigh = {
    ...common,
    businessName: "Verified High",
    verificationStatus: "verified",
    verifiedRank: 90
  };

  const ranked = ranking.sortAppointmentsByRanking(
    [unverified, verifiedLow, verifiedHigh],
    { serviceCategory: "massage" }
  );

  assert(ranked[0].businessName === "Verified High", "higher admin rank wins inside verified tier");
  assert(ranked[1].businessName === "Verified Low", "verified business stays above unverified business");
  assert(ranked[2].businessName === "Unverified Test", "unverified business remains below verified tier");

  // Runtime public visibility filter behavior. This does not query PostgreSQL.
  const inventoryManager = require(path.join(ROOT, "inventoryManager.js"));
  const hidden = {
    businessName: "Hidden Test Business",
    platform: "test",
    serviceName: "Massage",
    serviceCategory: "massage",
    publicInventoryVisible: false,
    businessEnabled: true,
    inventoryStatus: "active"
  };

  const publicRows = inventoryManager.filterInventory([hidden], {});
  const adminRows = inventoryManager.filterInventory(
    [hidden],
    { includeHiddenInventory: true }
  );

  assert(publicRows.length === 0, "hidden business inventory is excluded from public inventoryManager reads");
  assert(adminRows.length === 1, "hidden business inventory remains accessible with internal/admin override");

  console.log("");
  console.log("All verified-ranking and inventory-control checks passed.");
}

main().catch((error) => {
  console.error("");
  console.error("Verification failed:", error.message);
  process.exit(1);
});