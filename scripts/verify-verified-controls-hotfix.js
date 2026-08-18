#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function assert(value, message) {
  if (!value) throw new Error(message);
  console.log(`✓ ${message}`);
}

function syntax(rel) {
  execFileSync(process.execPath, ["--check", path.join(ROOT, rel)], {
    stdio: "pipe"
  });
  console.log(`✓ syntax ${rel}`);
}

async function verifyDatabaseColumns() {
  if (!process.env.DATABASE_URL) {
    console.log("• DATABASE_URL not present; skipped live PostgreSQL column check.");
    return;
  }

  const db = require(path.join(ROOT, "db.js"));

  try {
    const result = await db.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'businesses'
        AND column_name IN (
          'verified_rank',
          'public_inventory_visible',
          'public_inventory_limit'
        )
      ORDER BY column_name
    `);

    const names = new Set(result.rows.map((row) => row.column_name));

    assert(names.has("verified_rank"), "PostgreSQL has verified_rank");
    assert(names.has("public_inventory_visible"), "PostgreSQL has public_inventory_visible");
    assert(names.has("public_inventory_limit"), "PostgreSQL has public_inventory_limit");
  } finally {
    if (db.pool && typeof db.pool.end === "function") {
      await db.pool.end();
    }
  }
}

async function main() {
  const admin = read("public/admin.js");
  const app = read("public/app.js");
  const styles = read("public/styles.css");
  const adminCss = read("public/admin.css");
  const manager = read("businessManager.js");
  const repo = read("database/BusinessRepository.js");
  const routes = read("adminRoutes.js");
  const inventory = read("inventoryManager.js");
  const ranking = read("rankingEngine.js");

  assert(
    admin.includes("Search &amp; Inventory Controls"),
    "Admin renders always-visible Search & Inventory Controls"
  );
  assert(
    admin.includes("Verified Search Rank (0-100)"),
    "Admin renders verified rank field"
  );
  assert(
    admin.includes("Show appointments publicly"),
    "Admin renders public inventory toggle"
  );
  assert(
    admin.includes("Visible Appointment Times (1-20)"),
    "Admin renders visible appointment count"
  );

  assert(
    repo.includes("verified_rank:"),
    "BusinessRepository persists verified rank"
  );
  assert(
    routes.includes("publicInventoryVisible: cleanAdminBoolean"),
    "Admin route normalizes public inventory visibility"
  );
  assert(
    manager.includes("publicInventoryLimit: Math.max"),
    "businessManager returns public inventory controls"
  );

  assert(
    inventory.includes("normalized.publicInventoryVisible === false"),
    "Public inventory filter hides disabled-public inventory"
  );
  assert(
    inventory.includes("includeHiddenInventory"),
    "Internal inventory reads can explicitly include hidden inventory"
  );

  assert(
    ranking.includes("const verifiedDiff"),
    "Ranking engine has verified-business tier"
  );
  assert(
    ranking.includes("getVerifiedRank(b)"),
    "Ranking engine applies admin rank within verified tier"
  );

  assert(
    app.includes('isVerifiedBusiness ? "verified-business-card" : ""'),
    "Left-side list card receives verified-business-card class"
  );
  assert(
    app.includes("getPublicInventoryLimit(firstAppointment)"),
    "Public search obeys per-business visible appointment count"
  );

  assert(
    styles.includes("outline: 4px solid #002b49;"),
    "Verified left-side card has 4px #002b49 outline"
  );
  assert(
    styles.includes(".verified-map-pin,") &&
      styles.includes("border: 2px solid #002b49;"),
    "Verified map pin remains at its existing 2px outline"
  );
  assert(
    !/\.business-card\.verified-business-card\s*\{[^}]*background\s*:/s.test(styles),
    "Verified list card keeps the normal card background"
  );
  assert(
    adminCss.includes("admin-search-inventory-controls"),
    "Admin control block styling installed"
  );

  [
    "database/BusinessRepository.js",
    "adminRoutes.js",
    "businessManager.js",
    "inventoryManager.js",
    "rankingEngine.js",
    "public/admin.js",
    "public/app.js"
  ].forEach(syntax);

  const rankingEngine = require(path.join(ROOT, "rankingEngine.js"));
  const common = {
    serviceName: "60 Minute Massage",
    serviceCategory: "massage",
    localSortable: 209901010900,
    latitude: 30.2672,
    longitude: -97.7431
  };

  const ranked = rankingEngine.sortAppointmentsByRanking(
    [
      {
        ...common,
        businessName: "Unverified",
        verificationStatus: "unclaimed",
        verifiedRank: 100
      },
      {
        ...common,
        businessName: "Verified Low",
        verificationStatus: "verified",
        verifiedRank: 10
      },
      {
        ...common,
        businessName: "Verified High",
        verificationStatus: "verified",
        verifiedRank: 90
      }
    ],
    { serviceCategory: "massage" }
  );

  assert(
    ranked[0].businessName === "Verified High",
    "Higher verified admin rank sorts first"
  );
  assert(
    ranked[1].businessName === "Verified Low",
    "Verified businesses remain ahead of unverified businesses"
  );

  await verifyDatabaseColumns();

  console.log("");
  console.log("Verified-controls hotfix checks passed.");
}

main().catch((error) => {
  console.error("");
  console.error("VERIFY FAILED:", error.message);
  process.exit(1);
});