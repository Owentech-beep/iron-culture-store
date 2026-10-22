import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

export async function claimEmail(config, db = pool) {
  if (!["test", "live"].includes(config.mode)) {
    throw new Error("Unsupported email mode.");
  }

  if (config.enabled !== true) return null;

  const isDemo = config.mode === "test";
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
       WHERE is_demo = $1
         AND status = 'sending'
         AND claimed_at < NOW() - INTERVAL '5 minutes'`,
      [isDemo],
    );

    // Leave a safety margin before the provider's 24-hour window.
    await client.query(
      `UPDATE email_outbox
       SET status = 'review_required',
           last_error = 'Automatic retry window or attempt limit reached.'
       WHERE is_demo = $1
         AND status = 'pending'
         AND (
           first_attempt_at <= NOW() - INTERVAL '23 hours'
           OR attempt_count >= 5
         )`,
      [isDemo],
    );

    const { rows } = await client.query(
      `SELECT *
       FROM email_outbox
       WHERE status = 'pending'
         AND is_demo = $1
         AND available_at <= NOW()
       ORDER BY id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [isDemo],
    );

    const email = rows[0];

    if (!email) {
      await client.query("COMMIT");
      return null;
    }

    if (email.is_demo !== isDemo) {
      throw new Error("Email record does not match the sending mode.");
    }

    const recipient = isDemo ? config.testRecipient : email.recipient;

    if (
      typeof recipient !== "string" ||
      recipient.length > 254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)
    ) {
      throw new Error("Email recipient is invalid. Review the queued record.");
    }

    if (
      typeof email.subject !== "string" ||
      !email.subject.trim() ||
      /[\r\n]/.test(email.subject) ||
      typeof email.text_body !== "string" ||
      !email.text_body.trim()
    ) {
      throw new Error("Queued email content is invalid.");
    }

    const subject =
      isDemo && !email.subject.startsWith("[SANDBOX TEST]")
        ? `[SANDBOX TEST] ${email.subject}`
        : email.subject;

    const expectedPayload = {
      from: config.from,
      to: [recipient],
      subject,
      text: email.text_body,
    };

    // A saved delivery snapshot and its key must remain paired.
    const hasSavedPayload = email.delivery_payload != null;
    const hasSavedKey = email.delivery_key != null;

    if (hasSavedPayload !== hasSavedKey) {
      throw new Error(
        "Incomplete email delivery snapshot. Review before sending.",
      );
    }

    const deliveryKey = email.delivery_key ?? randomUUID();
    const payload = email.delivery_payload ?? expectedPayload;
    const allowedFields = ["from", "to", "subject", "text"];

    // Preserve retries exactly: never silently change the recipient,
    // sender, subject or body of an already-prepared request.
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      Object.keys(payload).some((key) => !allowedFields.includes(key)) ||
      payload.from !== expectedPayload.from ||
      !Array.isArray(payload.to) ||
      payload.to.length !== 1 ||
      payload.to[0] !== recipient ||
      payload.subject !== subject ||
      payload.text !== expectedPayload.text
    ) {
      throw new Error(
        "Saved email payload does not match its record or configuration. Review before sending.",
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
