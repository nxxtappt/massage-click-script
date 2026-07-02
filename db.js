const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("[DB] DATABASE_URL is not set.");
}

const pool = new Pool({
  connectionString,
  ssl: connectionString
    ? { rejectUnauthorized: false }
    : false
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};