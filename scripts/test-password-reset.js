import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import pg from "pg";

import { pool } from "../config/database.js";
import {
  createPasswordResetToken,
  isPasswordResetTokenValid,
  resetPasswordWithToken,
} from "../models/PasswordReset.js";

const schema = `reset_test_${randomUUID().replaceAll("-", "")}`;

let testPool;
let schemaCreated = false;

const oldPassword = "Old disposable test password 123!";
const newPassword = "New disposable test password 456!";
const otherPassword = "Other disposable test password 789!";

try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.EMAIL_MODE !== "test" ||
    process.env.DATABASE_URL
  ) {
    throw new Error("Run only against local development PostgreSQL.");
  }

  const { rows: connection } = await pool.query(
    `SELECT
       current_database() AS database,
       host(inet_server_addr()) AS address`,
  );

  assert.equal(connection[0].database, "iron_culture_store");

  assert.ok(
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      connection[0].address,
    ),
    "Expected local PostgreSQL.",
  );

  await pool.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;

  await pool.query(
    `CREATE TABLE "${schema}".users
     (LIKE public.users INCLUDING ALL)`,
  );

  await pool.query(
    `CREATE TABLE "${schema}".password_reset_tokens
     (LIKE public.password_reset_tokens INCLUDING ALL)`,
  );

  testPool = new pg.Pool({
    ...pool.options,
    max: 4,
    options: `-c search_path=${schema}`,
  });

  const { rows: location } = await testPool.query(
    "SELECT current_schema() AS schema",
  );

  assert.equal(location[0].schema, schema);

  const email = `reset-${randomUUID()}@example.com`;
  const oldHash = await bcrypt.hash(oldPassword, 12);

  const { rows: users } = await testPool.query(
    `INSERT INTO users (
       name, email, password_hash, role
     )
     VALUES ('Disposable Reset Test', $1, $2, 'admin')
     RETURNING id, auth_version`,
    [email, oldHash],
  );

  const user = users[0];

  const unknown = await createPasswordResetToken(
    `missing-${randomUUID()}@example.com`,
    testPool,
  );

  assert.equal(unknown, null);

  const first = await createPasswordResetToken(email, testPool);
  assert.ok(first);

  const { rows: storedTokens } = await testPool.query(
    "SELECT * FROM password_reset_tokens WHERE id = $1",
    [first.tokenId],
  );

  const expectedHash = createHash("sha256")
    .update(first.token)
    .digest("hex");

  assert.equal(storedTokens[0].token_hash, expectedHash);
  assert.notEqual(storedTokens[0].token_hash, first.token);
  assert.equal(Object.hasOwn(storedTokens[0], "token"), false);

  console.log("PASS: reset token is stored as a hash.");

  assert.equal(
    await isPasswordResetTokenValid(first.token, testPool),
    true,
  );

  assert.equal(
    await isPasswordResetTokenValid(first.token, testPool),
    true,
  );

  console.log("PASS: checking a link does not consume it.");

  assert.equal(
    await createPasswordResetToken(email, testPool),
    null,
  );

  console.log("PASS: repeated requests respect the account cooldown.");

  await assert.rejects(
    () => resetPasswordWithToken(first.token, "short", testPool),
    (error) => error.status === 400,
  );

  assert.equal(
    await isPasswordResetTokenValid(first.token, testPool),
    true,
  );

  console.log("PASS: invalid password does not consume the token.");

  // Expire only the disposable token while preserving its date constraint.
  await testPool.query(
    `UPDATE password_reset_tokens
     SET created_at = NOW() - INTERVAL '31 minutes',
         expires_at = NOW() - INTERVAL '1 minute'
     WHERE id = $1`,
    [first.tokenId],
  );

  assert.equal(
    await isPasswordResetTokenValid(first.token, testPool),
    false,
  );

  await assert.rejects(
    () => resetPasswordWithToken(first.token, newPassword, testPool),
    (error) => error.status === 400,
  );

  const { rows: unchanged } = await testPool.query(
    "SELECT password_hash, auth_version FROM users WHERE id = $1",
    [user.id],
  );

  assert.equal(unchanged[0].password_hash, oldHash);
  assert.equal(unchanged[0].auth_version, user.auth_version);

  console.log("PASS: expired token cannot change password or session version.");

  const second = await createPasswordResetToken(email, testPool);
  assert.ok(second);

  // Create another outstanding token to check account-wide invalidation.
  const siblingToken = randomBytes(32).toString("hex");
  const siblingHash = createHash("sha256")
    .update(siblingToken)
    .digest("hex");

  await testPool.query(
    `INSERT INTO password_reset_tokens (
       id, user_id, token_hash, expires_at
     )
     VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')`,
    [randomUUID(), user.id, siblingHash],
  );

  const outcomes = await Promise.allSettled([
    resetPasswordWithToken(second.token, newPassword, testPool),
    resetPasswordWithToken(second.token, otherPassword, testPool),
  ]);

  const successes = outcomes.filter(
    (result) => result.status === "fulfilled",
  );
  const failures = outcomes.filter(
    (result) => result.status === "rejected",
  );

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.status, 400);

  console.log("PASS: only one concurrent reset succeeds.");

  const winningPassword =
    outcomes[0].status === "fulfilled" ? newPassword : otherPassword;

  const { rows: updated } = await testPool.query(
    `SELECT password_hash, auth_version, role
     FROM users WHERE id = $1`,
    [user.id],
  );

  assert.equal(
    await bcrypt.compare(winningPassword, updated[0].password_hash),
    true,
  );

  assert.equal(
    await bcrypt.compare(oldPassword, updated[0].password_hash),
    false,
  );

  assert.equal(updated[0].auth_version, user.auth_version + 1);
  assert.equal(updated[0].role, "admin");

  console.log("PASS: password changes, session version increments once, role stays.");

  assert.equal(
    await isPasswordResetTokenValid(siblingToken, testPool),
    false,
  );

  await assert.rejects(
    () => resetPasswordWithToken(second.token, newPassword, testPool),
    (error) => error.status === 400,
  );

  const { rows: remaining } = await testPool.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM password_reset_tokens
     WHERE user_id = $1 AND used_at IS NULL`,
    [user.id],
  );

  assert.equal(remaining[0].count, 0);

  console.log("PASS: used token cannot be reused; other outstanding links are invalidated.");

  await testPool.query(
    "UPDATE users SET is_active = FALSE WHERE id = $1",
    [user.id],
  );

  assert.equal(
    await createPasswordResetToken(email, testPool),
    null,
  );

  console.log("PASS: inactive accounts cannot receive new reset tokens.");
  console.log("No emails were sent and no existing accounts were changed.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (testPool) await testPool.end();

  if (schemaCreated) {
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      console.log("Disposable password-reset schema removed.");
    } catch (error) {
      console.error("CLEANUP FAILED:", schema, error.message);
      process.exitCode = 1;
    }
  }

  await pool.end();
}
