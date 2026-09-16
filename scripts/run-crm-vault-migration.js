"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("../db");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; run this from a Render shell or configured Codespace.");
  }
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "019_crm_credential_vault.sql"),
    "utf8"
  );
  await db.query(sql);
  const { rows } = await db.query(
    "SELECT to_regclass('public.crm_credentials') IS NOT NULL AS installed"
  );
  if (!rows[0]?.installed) throw new Error("crm_credentials table was not installed.");
  console.log("CRM vault migration 019 installed (no credentials or keys printed).");
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
