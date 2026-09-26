"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../db");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Run this in the configured Render shell.");
  }
  const sql = fs.readFileSync(path.join(__dirname, "..", "db", "migrations", "020_billing_leads.sql"), "utf8");
  await db.query(sql);
  const { rows } = await db.query("SELECT to_regclass('public.billing_leads') IS NOT NULL AS installed");
  if (!rows[0]?.installed) throw new Error("Billing leads table was not installed.");
  console.log("Billing leads migration 020 installed.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
