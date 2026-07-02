require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("./db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "db",
    "migrations",
    "001_inventory_schema.sql"
  );

  const sql = fs.readFileSync(migrationPath, "utf8");

  await db.query(sql);

  console.log("Migration completed:", migrationPath);

  await db.pool.end();
}

runMigration().catch(async (error) => {
  console.error("Migration failed.");
  console.error(error);
  console.error("Message:", error.message);
  console.error("Code:", error.code);
  console.error("Detail:", error.detail);
  console.error("Stack:", error.stack);

  await db.pool.end();
  process.exit(1);
});