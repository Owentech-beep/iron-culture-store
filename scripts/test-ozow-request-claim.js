import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { pool } from "../config/database.js";
import {
  claimOzowPaymentRequest,
  saveOzowPaymentRequest,
} from "../models/OzowPaymentRequest.js";

const schema = `test_ozow_${randomUUID().replaceAll("-", "")}`;
let testPool;
let schemaCreated = false;

try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.DATABASE_URL
  ) {
    throw new Error("Run only against local development PostgreSQL.");
  }

  const { rows } = await pool.query(
    `SELECT current_database() AS database,
            host(inet_server_addr()) AS address`,
  );

  assert.equal(rows[0].database, "iron_culture_store");
  assert.ok(
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(rows[0].address),
    "Expected a local PostgreSQL connection.",
  );

  await pool.query(`CREATE SCHEMA ${schema}`);
  schemaCreated = true;

  testPool = new pg.Pool({
    ...pool.options,
    max: 4,
    options: `-c search_path=${schema},pg_catalog`,
  });

  await testPool.query(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      stock_deducted_at TIMESTAMPTZ,
      is_demo BOOLEAN NOT NULL
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      provider TEXT NOT NULL,
      provider_payment_id TEXT,
      idempotency_key UUID NOT NULL UNIQUE,
      amount_cents BIGINT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_request_id TEXT,
      provider_checkout_url TEXT,
      provider_request_started_at TIMESTAMPTZ,
      provider_request_expires_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider, provider_request_id),
      CHECK (
        provider_request_expires_at IS NULL OR
        (
          provider_request_started_at IS NOT NULL AND
          provider_request_expires_at > provider_request_started_at
        )
      )
    );

    CREATE UNIQUE INDEX one_active_payment
      ON payments(order_id)
      WHERE status IN ('created', 'pending', 'succeeded');

    CREATE TABLE stock_reservations (
      id INTEGER PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      status TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE payment_reconciliation_alerts (
      id INTEGER PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      status TEXT NOT NULL
    );

    INSERT INTO orders
      VALUES (1, 10, 'pending', 'unpaid', NULL, FALSE);
  `);

  await testPool.query(
    `INSERT INTO payments (
       id, order_id, provider, idempotency_key,
       amount_cents, currency, status
     )
     VALUES (1, 1, 'ozow_live', $1, 45400, 'ZAR', 'created')`,
    [randomUUID()],
  );

  await testPool.query(`
    INSERT INTO stock_reservations
      VALUES (1, 1, 'active', NOW() + INTERVAL '30 minutes')
  `);

  const input = {
    paymentId: 1,
    orderId: 1,
    userId: 10,
    provider: "ozow_live",
  };

  await assert.rejects(
    claimOzowPaymentRequest({ ...input, userId: 11 }, testPool),
    (error) => error.status === 409,
  );

  await assert.rejects(
    claimOzowPaymentRequest(
      { ...input, provider: "ozow_staging" },
      testPool,
    ),
    (error) => error.status === 409,
  );

  console.log("PASS: wrong owner and environment cannot claim the request.");

  // Wait for both calls before assertions or cleanup.
  const results = await Promise.allSettled([
    claimOzowPaymentRequest(input, testPool),
    claimOzowPaymentRequest(input, testPool),
  ]);

  const successes = results.filter((item) => item.status === "fulfilled");
  const failures = results.filter((item) => item.status === "rejected");

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.status, 409);

  const attempt = successes[0].value;

  assert.equal(attempt.amountCents, 45400);

  console.log("PASS: concurrent callers claim the request only once.");

  await assert.rejects(
    claimOzowPaymentRequest(input, testPool),
    (error) => error.status === 409,
  );

  console.log("PASS: a committed claim cannot be sent again automatically.");

  const requestId = randomUUID();

  const response = {
    providerRequestId: requestId,
    checkoutUrl: `https://pay.ozow.com/${requestId}/secure`,
    expiresAt: attempt.expiresAt,
  };

  await saveOzowPaymentRequest(attempt, response, testPool);
  await saveOzowPaymentRequest(attempt, response, testPool);

  let saved = await testPool.query(
    "SELECT * FROM payments WHERE id = 1",
  );

  assert.equal(saved.rows[0].status, "pending");
  assert.equal(saved.rows[0].provider_request_id, requestId);
  assert.equal(saved.rows[0].provider_payment_id, null);

  console.log("PASS: checkout response is saved; repeated identical save is safe.");

  await assert.rejects(
    saveOzowPaymentRequest(
      attempt,
      { ...response, providerRequestId: randomUUID() },
      testPool,
    ),
    (error) => error.status === 409,
  );

  await assert.rejects(
    saveOzowPaymentRequest(
      attempt,
      { ...response, checkoutUrl: "https://example.com/checkout" },
      testPool,
    ),
    (error) => error.status === 409,
  );

  console.log("PASS: changed request IDs and unsafe URLs are rejected.");

  await testPool.query(
    "UPDATE payments SET status = 'succeeded' WHERE id = 1",
  );

  await saveOzowPaymentRequest(attempt, response, testPool);

  saved = await testPool.query(
    "SELECT status FROM payments WHERE id = 1",
  );

  assert.equal(saved.rows[0].status, "succeeded");

  console.log("PASS: saving checkout details cannot downgrade succeeded status.");

  const order = await testPool.query(
    "SELECT payment_status, stock_deducted_at FROM orders WHERE id = 1",
  );

  const reservation = await testPool.query(
    "SELECT status FROM stock_reservations WHERE id = 1",
  );

  assert.equal(order.rows[0].payment_status, "unpaid");
  assert.equal(order.rows[0].stock_deducted_at, null);
  assert.equal(reservation.rows[0].status, "active");

  console.log("PASS: request handling leaves the order unpaid and reservation active.");
  console.log("No emails or payment requests were sent.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  await testPool?.end();

  try {
    if (schemaCreated) {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      console.log("Disposable Ozow test schema removed.");
    }
  } finally {
    await pool.end();
  }
}