import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";

import { pool } from "../config/database.js";

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validToken(token) {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

function resetError(message) {
  const error = new Error(message);
  error.status = 400;
  error.publicMessage = message;
  return error;
}

// Returns the raw token only to the calling email service.
// Never log it or store it in the order email queue.
export async function createPasswordResetToken(email, db = pool) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, email
       FROM users
       WHERE email = $1 AND is_active
       FOR UPDATE`,
      [email],
    );

    const user = rows[0];

    if (!user) {
      await client.query("COMMIT");
      return null;
    }

    // Limit repeated requests for the same account.
    const { rows: recent } = await client.query(
      `SELECT id
       FROM password_reset_tokens
       WHERE user_id = $1
         AND created_at > clock_timestamp() - INTERVAL '2 minutes'
       LIMIT 1`,
      [user.id],
    );

    if (recent.length) {
      await client.query("COMMIT");
      return null;
    }

    const token = randomBytes(32).toString("hex");
    const tokenId = randomUUID();

    const { rows: tokens } = await client.query(
      `INSERT INTO password_reset_tokens (
         id,
         user_id,
         token_hash,
         expires_at
       )
       VALUES (
         $1,
         $2,
         $3,
         clock_timestamp() + INTERVAL '30 minutes'
       )
       RETURNING expires_at`,
      [tokenId, user.id, hashToken(token)],
    );

    await client.query("COMMIT");

    return {
      tokenId,
      token,
      recipient: user.email,
      expiresAt: tokens[0].expires_at,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Checking a link does not consume it.
// Email scanners must not invalidate links merely by opening them.
export async function isPasswordResetTokenValid(token, db = pool) {
  if (!validToken(token)) return false;

  const { rows } = await db.query(
    `SELECT t.id
     FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1
       AND t.used_at IS NULL
       AND t.expires_at > clock_timestamp()
       AND u.is_active
     LIMIT 1`,
    [hashToken(token)],
  );

  return rows.length === 1;
}

export async function resetPasswordWithToken(
  token,
  password,
  db = pool,
) {
  if (!validToken(token)) {
    throw resetError("This reset link is invalid or has expired.");
  }

  if (
    typeof password !== "string" ||
    password.length < 15 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    throw resetError(
      "Use at least 15 characters. The password must fit within 72 UTF-8 bytes.",
    );
  }

  // Avoid expensive password hashing for an already-invalid link.
  if (!(await isPasswordResetTokenValid(token, db))) {
    throw resetError("This reset link is invalid or has expired.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const tokenHash = hashToken(token);
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const { rows: matches } = await client.query(
      `SELECT user_id
       FROM password_reset_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );

    if (!matches.length) {
      throw resetError("This reset link is invalid or has expired.");
    }

    // All reset mutations lock the user before locking tokens.
    const { rows: users } = await client.query(
      `SELECT id, is_active
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [matches[0].user_id],
    );

    const user = users[0];

    if (!user?.is_active) {
      throw resetError("This reset link is invalid or has expired.");
    }

    // Recheck after acquiring the lock: another request may have used it.
    const { rows: tokens } = await client.query(
      `SELECT id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND user_id = $2
         AND used_at IS NULL
         AND expires_at > clock_timestamp()
       FOR UPDATE`,
      [tokenHash, user.id],
    );

    if (!tokens.length) {
      throw resetError("This reset link is invalid or has expired.");
    }

    await client.query(
      `UPDATE users
       SET password_hash = $1,
           auth_version = auth_version + 1
       WHERE id = $2`,
      [passwordHash, user.id],
    );

    // A successful reset invalidates every outstanding link for this user.
    await client.query(
      `UPDATE password_reset_tokens
       SET used_at = clock_timestamp()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );

    await client.query("COMMIT");

    return { userId: user.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}