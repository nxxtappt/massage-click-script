const { Pool } = require("pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) console.warn("[DB] DATABASE_URL is not set.");
const pool = new Pool({ connectionString, ssl: connectionString ? { rejectUnauthorized: false } : false });
module.exports = {
  query: (text, params) => pool.query(text, params),
  connect: () => pool.connect(),
  pool,
  healthCheck: async () => {
    const result = await pool.query("SELECT NOW() AS database_time");
    return { healthy: true, databaseTime: result.rows[0].database_time };
  }
};