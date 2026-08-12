require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function run() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "db",
    "migrations",
    "016_manual_inventory_admin.sql"
  );

  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration not found: ${migrationPath}`);
  }

  const sql = fs.readFileSync(migrationPath, "utf8");
  await db.query(sql);

  const result = await db.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'appointment_inventory'
        AND column_name = 'scrape_overwrite_protected'
    `
  );

  if (!result.rows.length) {
    throw new Error("Migration ran but scrape_overwrite_protected was not found.");
  }

  console.log("[MANUAL INVENTORY] Migration 016 applied successfully.");
}

run()
  .catch((error) => {
    console.error("[MANUAL INVENTORY] Migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => null);
  });