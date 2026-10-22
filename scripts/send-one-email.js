import "dotenv/config";

import { pool } from "../config/database.js";
import { getEmailConfig } from "../config/email.js";
import { deliverQueuedEmail } from "../services/emailDeliveryService.js";
import {
  claimEmail,
  recordResult,
} from "../models/EmailWorker.js";

async function main() {
  const config = getEmailConfig();

  if (!config.enabled) {
    console.log("Sending disabled. No emails or database rows changed.");
    return;
  }

  if (config.mode === "test") {
    if (process.env.DATABASE_URL) {
      throw new Error("Test email sending requires local PostgreSQL.");
    }

    const { rows } = await pool.query(
      `SELECT
         current_database() AS database,
         host(inet_server_addr()) AS server_address`,
    );

    if (
      rows[0].database !== "iron_culture_store" ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        rows[0].server_address,
      )
    ) {
      throw new Error("Expected the local iron_culture_store database.");
    }
  } else if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("Live email sending requires DATABASE_URL.");
  }

  const email = await claimEmail(config);

  if (!email) {
    console.log(`No ${config.mode} order email is ready to send.`);
    return;
  }

  const result = await deliverQueuedEmail(email, config);

  await recordResult(
    email,
    result.status,
    result.providerId,
    result.message,
  );
}

try {
  await main();
} catch (error) {
  console.error("EMAIL WORKER FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}