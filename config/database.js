import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  console.error("Unexpected database pool error:", error.message);
});

export async function checkDatabaseConnection() {
  await pool.query("SELECT 1");
}