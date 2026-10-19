import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

export async function claimEmail(config, db = pool) {
    const client = await db.connect();

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

export async function recordResult(
  email,
  status,
  providerId,
  message,
  db = pool,
) {
  const retryDelay = Math.min(3600, 60 * 2 ** (email.attempt_count - 1));

    const result = await db.query(
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


