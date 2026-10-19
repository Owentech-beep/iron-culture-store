import "dotenv/config";
import { randomUUID } from "node:crypto";

import { pool } from "../config/database.js";
import { getEmailConfig } from "../config/email.js";

async function claimEmail(config) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Interrupted sends need review rather than a blind resend.
    await client.query(
      `UPDATE email_outbox
       SET status = 'review_required',
           claim_token = NULL,
           claimed_at = NULL,
           last_error = 'Sending worker interrupted; inspect Resend before retrying.'
       WHERE is_demo
         AND status = 'sending'
         AND claimed_at < NOW() - INTERVAL '5 minutes'`,
    );

    // Leave a safety margin before the provider's 24-hour window.
    await client.query(
      `UPDATE email_outbox
       SET status = 'review_required',
           last_error = 'Automatic retry window or attempt limit reached.'
       WHERE is_demo
         AND status = 'pending'
         AND (
           first_attempt_at <= NOW() - INTERVAL '23 hours'
           OR attempt_count >= 5
         )`,
    );

    const { rows } = await client.query(
      `SELECT *
       FROM email_outbox
       WHERE status = 'pending'
         AND is_demo
         AND available_at <= NOW()
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );

    const email = rows[0];

    if (!email) {
      await client.query("COMMIT");
      return null;
    }

    const deliveryKey = email.delivery_key ?? randomUUID();

    const payload = email.delivery_payload ?? {
      from: config.from,
      to: [config.testRecipient],
      subject: email.subject.startsWith("[SANDBOX TEST]")
        ? email.subject
        : `[SANDBOX TEST] ${email.subject}`,
      text: email.text_body,
    };

    // Do not silently redirect an already-prepared request.
    const allowedFields = ["from", "to", "subject", "text"];

    if (
      Object.keys(payload).some((key) => !allowedFields.includes(key)) ||
      payload.from !== config.from ||
      !Array.isArray(payload.to) ||
      payload.to.length !== 1 ||
      payload.to[0] !== config.testRecipient ||
      typeof payload.subject !== "string" ||
      !payload.subject.startsWith("[SANDBOX TEST]") ||
      typeof payload.text !== "string" ||
      !payload.text.trim()
    ) {
      throw new Error(
        "Saved email payload does not match test configuration. Review it before sending.",
      );
    }

    const claimToken = randomUUID();

    const claimed = await client.query(
      `UPDATE email_outbox
       SET status = 'sending',
           claim_token = $2,
           claimed_at = NOW(),
           first_attempt_at = COALESCE(first_attempt_at, NOW()),
           attempt_count = attempt_count + 1,
           delivery_key = $3,
           delivery_payload = $4::JSONB,
           last_error = NULL
       WHERE id = $1
       RETURNING *`,
      [email.id, claimToken, deliveryKey, JSON.stringify(payload)],
    );

    await client.query("COMMIT");
    return claimed.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recordResult(email, status, providerId, message) {
  const retryDelay = Math.min(3600, 60 * 2 ** (email.attempt_count - 1));

  const result = await pool.query(
    `UPDATE email_outbox
     SET status = $3::VARCHAR,
         provider_email_id = $4,
         last_error = $5,
         sent_at = CASE
           WHEN $3::VARCHAR = 'sent' THEN NOW()
           ELSE NULL
         END,
         available_at = CASE
           WHEN $3::VARCHAR = 'pending'
             THEN NOW() + ($6::INTEGER * INTERVAL '1 second')
           ELSE available_at
         END,
         claim_token = NULL,
         claimed_at = NULL
     WHERE id = $1
       AND claim_token = $2
       AND status = 'sending'`,
    [email.id, email.claim_token, status, providerId, message, retryDelay],
  );

  if (result.rowCount !== 1) {
    throw new Error(
      "Email claim changed. Inspect its database row and Resend before retrying.",
    );
  }

  console.log({
    emailId: email.id,
    status,
    attemptCount: email.attempt_count,
    ...(status === "pending" ? { retryAfterSeconds: retryDelay } : {}),
  });
}

async function main() {
  const config = getEmailConfig();

  if (!config.enabled) {
    console.log("Sending disabled. No emails or database rows changed.");
    return;
  }

  if (process.env.DATABASE_URL) {
    throw new Error("This worker currently supports local PostgreSQL only.");
  }

  const { rows } = await pool.query(
    `SELECT
       current_database() AS database,
       host(inet_server_addr()) AS server_address`,
  );

  if (
    rows[0].database !== "iron_culture_store" ||
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(rows[0].server_address)
  ) {
    throw new Error("Expected the local iron_culture_store database.");
  }

  const email = await claimEmail(config);

  if (!email) {
    console.log("No demo email is ready to send.");
    return;
  }

  let status;
  let providerId = null;
  let message = null;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `iron-culture/${email.delivery_key}`,
      },
      body: JSON.stringify(email.delivery_payload),
    });

    const body = await response.json().catch(() => null);

    if (
      response.ok &&
      typeof body?.id === "string" &&
      body.id.length > 0 &&
      body.id.length <= 255
    ) {
      status = "sent";
      providerId = body.id;
    } else if (
      response.status === 429 ||
      response.status >= 500 ||
      response.ok
    ) {
      status = "pending";
      message = `Temporary or uncertain provider response: HTTP ${response.status}.`;
    } else {
      status = "review_required";
      message = `Provider rejected the request: HTTP ${response.status}. Check Resend logs.`;
    }
  } catch {
    status = "pending";
    message =
      "Network request failed or timed out. Delivery outcome is uncertain.";
  }

  if (status === "pending" && email.attempt_count >= 5) {
    status = "review_required";
    message =
      "Retry limit reached. Inspect Resend before taking further action.";
  }

  // A database error here leaves the claim for review.
  // Do not send another request just because recording the result failed.
  await recordResult(email, status, providerId, message);
}

try {
  await main();
} catch (error) {
  console.error("EMAIL WORKER FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
