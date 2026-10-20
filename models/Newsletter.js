import { createHash, randomBytes } from "node:crypto";
import { pool } from "../config/database.js";

export const NEWSLETTER_CONSENT_VERSION = "newsletter-v1";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validToken(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

export function normalizeNewsletterEmail(value) {
  if (typeof value !== "string") return null;

  const email = value.trim().toLowerCase();

  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return null;
  }

  return email;
}

export async function requestNewsletterConfirmation(rawEmail, db = pool) {
  const email = normalizeNewsletterEmail(rawEmail);

  if (!email) {
    throw new Error("Enter a valid email address.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO newsletter_subscribers (
         email,
         consent_version
       )
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING`,
      [email, NEWSLETTER_CONSENT_VERSION],
    );

    const { rows } = await client.query(
      `SELECT
         *,
         (
           confirmation_token_hash IS NOT NULL
           AND consent_requested_at >
             clock_timestamp() - INTERVAL '2 minutes'
         ) AS cooling_down
       FROM newsletter_subscribers
       WHERE email = $1
       FOR UPDATE`,
      [email],
    );

    const subscriber = rows[0];

    // Existing subscribers stay subscribed.
    // Repeated requests cannot continuously generate new links.
    if (subscriber.status === "subscribed" || subscriber.cooling_down) {
      await client.query("COMMIT");
      return null;
    }

    const token = randomBytes(32).toString("hex");
    const unsubscribeToken = randomBytes(32).toString("hex");

    await client.query(
      `UPDATE newsletter_subscribers
       SET confirmation_token_hash = $2,
           confirmation_expires_at =
             clock_timestamp() + INTERVAL '24 hours',
           consent_version = $3,
           consent_requested_at = clock_timestamp(),
           unsubscribe_token_hash = $4,
           updated_at = clock_timestamp()
       WHERE id = $1`,
      [
        subscriber.id,
        hashToken(token),
        NEWSLETTER_CONSENT_VERSION,
        hashToken(unsubscribeToken),
      ],
    );

    // An unsubscribed address remains unsubscribed until
    // its owner confirms the new request.
    await client.query("COMMIT");

    return {
      subscriberId: subscriber.id,
      email,
      token,
      unsubscribeToken,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// A link-preview request must not subscribe anyone.
export async function isNewsletterConfirmationValid(token, db = pool) {
  if (!validToken(token)) return false;

  const { rows } = await db.query(
    `SELECT id
     FROM newsletter_subscribers
     WHERE confirmation_token_hash = $1
       AND confirmation_expires_at > clock_timestamp()
       AND status IN ('pending', 'unsubscribed')`,
    [hashToken(token)],
  );

  return rows.length === 1;
}

// Called only after the visitor submits the confirmation form.
export async function confirmNewsletterSubscription(token, db = pool) {
  if (!validToken(token)) return false;

  const result = await db.query(
    `UPDATE newsletter_subscribers
     SET status = 'subscribed',
         confirmed_at = clock_timestamp(),
         unsubscribed_at = NULL,
         confirmation_token_hash = NULL,
         confirmation_expires_at = NULL,
         updated_at = clock_timestamp()
     WHERE confirmation_token_hash = $1
       AND confirmation_expires_at > clock_timestamp()
       AND status IN ('pending', 'unsubscribed')
     RETURNING id`,
    [hashToken(token)],
  );

  return result.rowCount === 1;
}

export async function isNewsletterUnsubscribeValid(token, db = pool) {
  if (!validToken(token)) return false;

  const { rows } = await db.query(
    `SELECT id
     FROM newsletter_subscribers
     WHERE unsubscribe_token_hash = $1`,
    [hashToken(token)],
  );

  return rows.length === 1;
}

export async function unsubscribeNewsletter(token, db = pool) {
  if (!validToken(token)) return false;

  const result = await db.query(
    `UPDATE newsletter_subscribers
     SET status = 'unsubscribed',
         unsubscribed_at = COALESCE(
           unsubscribed_at,
           clock_timestamp()
         ),
         confirmation_token_hash = NULL,
         confirmation_expires_at = NULL,
         updated_at = clock_timestamp()
     WHERE unsubscribe_token_hash = $1
     RETURNING id`,
    [hashToken(token)],
  );

  return result.rowCount === 1;
}