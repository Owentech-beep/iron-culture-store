import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { pool } from "../config/database.js";
import {
  claimEmail,
  recordResult,
} from "../models/EmailWorker.js";

const schema = `email_test_${randomUUID().replaceAll("-", "")}`;
let testPool;
let schemaCreated = false;
let nextOrderId = 1;

const config = {
  mode: "test",
  enabled: true,
  from: "Test <sender@example.com>",
  testRecipient: "recipient@example.com",
};

async function insertEmail({
  isDemo = true,
  recipient = "recipient@example.com",
  subject = isDemo
    ? "[SANDBOX TEST] Queue test"
    : "Order received — queue test",
} = {}) {
  const { rows } = await testPool.query(
    `INSERT INTO email_outbox (
       order_id,
       event_type,
       recipient,
       subject,
       text_body,
       is_demo
     )
     VALUES (
       $1,
       'order_received',
       $2,
       $3,
       'Disposable test content.',
       $4
     )
     RETURNING id`,
    [nextOrderId++, recipient, subject, isDemo],
  );

  return rows[0].id;
}

async function readEmail(id) {
  const { rows } = await testPool.query(
    "SELECT * FROM email_outbox WHERE id = $1",
    [id],
  );

  assert.equal(rows.length, 1);
  return rows[0];
}

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

  // The generated schema name contains only letters, digits and underscores.
  await pool.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;

  // LIKE copies columns, checks and indexes, but not foreign keys.
  // Its identity sequence is separate from the real queue.
  await pool.query(
    `CREATE TABLE "${schema}".email_outbox
     (LIKE public.email_outbox INCLUDING ALL)`,
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

  // Test 1: competing workers.
  const id = await insertEmail();

  const results = await Promise.allSettled([
    claimEmail(config, testPool),
    claimEmail(config, testPool),
  ]);

  for (const result of results) {
    assert.equal(
      result.status,
      "fulfilled",
      result.reason?.message,
    );
  }

  const claims = results
    .map((result) => result.value)
    .filter(Boolean);

  assert.equal(claims.length, 1);
  const claim = claims[0];

  assert.equal(claim.id, id);
  assert.equal(claim.attempt_count, 1);
  assert.equal((await readEmail(id)).status, "sending");

  console.log("PASS: only one worker claims the same email.");

  // Test 2: stale claim cannot overwrite the current claim.
  await assert.rejects(
    () =>
      recordResult(
        { ...claim, claim_token: randomUUID() },
        "sent",
        "fake-provider-id",
        null,
        testPool,
      ),
    /claim changed/i,
  );

  assert.equal((await readEmail(id)).status, "sending");
  console.log("PASS: stale claim cannot update the email.");

  // Test 3: temporary failure schedules a delayed retry.
  await recordResult(
    claim,
    "pending",
    null,
    "Simulated temporary failure.",
    testPool,
  );

  const delayed = await readEmail(id);

  assert.equal(delayed.status, "pending");
  assert.equal(delayed.claim_token, null);
  assert.equal(delayed.claimed_at, null);

  const { rows: timing } = await testPool.query(
    `SELECT available_at > NOW() AS delayed
     FROM email_outbox WHERE id = $1`,
    [id],
  );

  assert.equal(timing[0].delayed, true);
  assert.equal(await claimEmail(config, testPool), null);

  console.log("PASS: retry delay prevents an immediate second attempt.");

  // Advance only the disposable test row's retry time.
  await testPool.query(
    `UPDATE email_outbox
     SET available_at = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
    [id],
  );

  const retry = await claimEmail(config, testPool);

  assert.equal(retry.attempt_count, 2);
  assert.equal(retry.delivery_key, claim.delivery_key);
  assert.deepEqual(retry.delivery_payload, claim.delivery_payload);
  assert.equal(
    retry.first_attempt_at.getTime(),
    claim.first_attempt_at.getTime(),
  );
  assert.notEqual(retry.claim_token, claim.claim_token);

  console.log("PASS: retry preserves payload, delivery key and first-attempt time.");

  await recordResult(
    retry,
    "sent",
    "fake-provider-id",
    null,
    testPool,
  );

  assert.equal((await readEmail(id)).status, "sent");
  assert.equal(await claimEmail(config, testPool), null);

  console.log("PASS: sent emails cannot be claimed again.");

  // Test 4: an interrupted send goes to review.
  const interruptedId = await insertEmail();
  await claimEmail(config, testPool);

  await testPool.query(
    `UPDATE email_outbox
     SET claimed_at = NOW() - INTERVAL '6 minutes'
     WHERE id = $1`,
    [interruptedId],
  );

  assert.equal(await claimEmail(config, testPool), null);

  const interrupted = await readEmail(interruptedId);

  assert.equal(interrupted.status, "review_required");
  assert.equal(interrupted.claim_token, null);
  assert.equal(interrupted.claimed_at, null);

  console.log("PASS: interrupted sends require review.");

  // Test 5: an old ambiguous attempt cannot be retried automatically.
  const expiredId = await insertEmail();

  await testPool.query(
    `UPDATE email_outbox
     SET attempt_count = 1,
         first_attempt_at = NOW() - INTERVAL '24 hours'
     WHERE id = $1`,
    [expiredId],
  );

  assert.equal(await claimEmail(config, testPool), null);
  assert.equal((await readEmail(expiredId)).status, "review_required");

  console.log("PASS: expired retry window requires review.");

  // Test 6: exhausted attempts cannot be claimed.
  const exhaustedId = await insertEmail();

  await testPool.query(
    `UPDATE email_outbox
     SET attempt_count = 5,
         first_attempt_at = NOW()
     WHERE id = $1`,
    [exhaustedId],
  );

  assert.equal(await claimEmail(config, testPool), null);
  assert.equal((await readEmail(exhaustedId)).status, "review_required");

   console.log("PASS: exhausted attempts require review.");

  // Test 7: live mode must skip demo records and use the customer address.
  const liveConfig = {
    mode: "live",
    enabled: true,
    from: "Iron Culture <notifications@ironculturesubs.co.za>",
    testRecipient: null,
  };

  const demoId = await insertEmail({
    recipient: "demo-original@example.com",
  });

  const liveId = await insertEmail({
    isDemo: false,
    recipient: "customer@example.com",
  });

  const liveClaim = await claimEmail(liveConfig, testPool);

  assert.ok(liveClaim);
  assert.equal(liveClaim.id, liveId);
  assert.equal(liveClaim.is_demo, false);
  assert.deepEqual(
    liveClaim.delivery_payload.to,
    ["customer@example.com"],
  );
  assert.equal(
    liveClaim.delivery_payload.subject,
    "Order received — queue test",
  );
  assert.equal((await readEmail(demoId)).status, "pending");

  // Only the pending demo record remains; live mode must ignore it.
  assert.equal(await claimEmail(liveConfig, testPool), null);

  console.log("PASS: live mode skips demo emails and keeps the customer recipient.");

  // Test 8: test mode uses its test inbox and cannot claim live records.
  const demoClaim = await claimEmail(config, testPool);

  assert.ok(demoClaim);
  assert.equal(demoClaim.id, demoId);
  assert.deepEqual(
    demoClaim.delivery_payload.to,
    [config.testRecipient],
  );

  await recordResult(
    demoClaim,
    "sent",
    "fake-demo-provider-id",
    null,
    testPool,
  );

  await recordResult(
    liveClaim,
    "pending",
    null,
    "Simulated temporary failure.",
    testPool,
  );

  await testPool.query(
    `UPDATE email_outbox
     SET available_at = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
    [liveId],
  );

  assert.equal(await claimEmail(config, testPool), null);

  console.log("PASS: test mode redirects demo email only and skips live emails.");

  // Test 9: changing a prepared live recipient must block the retry.
  await testPool.query(
    "UPDATE email_outbox SET recipient = $1 WHERE id = $2",
    ["different@example.com", liveId],
  );

  await assert.rejects(
    () => claimEmail(liveConfig, testPool),
    /saved email payload/i,
  );

  const blocked = await readEmail(liveId);

  assert.equal(blocked.status, "pending");
  assert.equal(blocked.attempt_count, 1);
  assert.equal(blocked.delivery_key, liveClaim.delivery_key);
  assert.deepEqual(
    blocked.delivery_payload,
    liveClaim.delivery_payload,
  );

  // Restore the original recipient on this disposable record.
  await testPool.query(
    "UPDATE email_outbox SET recipient = $1 WHERE id = $2",
    ["customer@example.com", liveId],
  );

  const liveRetry = await claimEmail(liveConfig, testPool);

  assert.ok(liveRetry);
  assert.equal(liveRetry.id, liveId);
  assert.equal(liveRetry.attempt_count, 2);
  assert.equal(liveRetry.delivery_key, liveClaim.delivery_key);
  assert.deepEqual(
    liveRetry.delivery_payload,
    liveClaim.delivery_payload,
  );

  await recordResult(
    liveRetry,
    "sent",
    "fake-live-provider-id",
    null,
    testPool,
  );

  assert.equal((await readEmail(liveId)).status, "sent");

  console.log("PASS: changed live recipient blocks retry without changing its snapshot.");
  console.log("PASS: valid live retry preserves the original payload and delivery key.");
  console.log("No network requests were made.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (testPool) await testPool.end();

  if (schemaCreated) {
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      console.log("Disposable email test schema removed.");
    } catch (error) {
      console.error("CLEANUP FAILED:", schema, error.message);
      process.exitCode = 1;
    }
  }

  await pool.end();
}