import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

import { pool } from "../config/database.js";
import {
  closeVerifiedUnpaidLiveAttempt,
} from "../models/LivePaymentRecovery.js";

const schema = `test_live_recovery_${randomUUID().replaceAll("-", "")}`;
const originalNodeEnv = process.env.NODE_ENV;
const originalPayfastMode = process.env.PAYFAST_MODE;

let testPool;
let schemaCreated = false;

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  if (
    process.env.NODE_ENV !== "development" ||
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

  // No public schema fallback: test queries use disposable tables only.
  testPool = new pg.Pool({
    options: `-c search_path=${schema},pg_catalog`,
    max: 4,
    connectionTimeoutMillis: 5000,
  });

  await testPool.query(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      is_active BOOLEAN NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      is_demo BOOLEAN NOT NULL,
      status TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      stock_deducted_at TIMESTAMPTZ
    );

    CREATE TABLE payments (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      provider_payment_id TEXT,
      idempotency_key UUID NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE inventory (
      variant_id INTEGER PRIMARY KEY,
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      reserved_quantity INTEGER NOT NULL
        CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity)
    );

    CREATE TABLE stock_reservations (
      id INTEGER PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      variant_id INTEGER NOT NULL REFERENCES inventory(variant_id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      status TEXT NOT NULL,
      resolved_at TIMESTAMPTZ
    );

    CREATE TABLE payment_reconciliation_alerts (
      id INTEGER PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      status TEXT NOT NULL
    );

    CREATE TABLE order_status_history (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      changed_by INTEGER NOT NULL REFERENCES users(id),
      note TEXT NOT NULL
    );
  `);

  const reference = randomUUID();

  const request = {
    orderId: 1,
    paymentId: 1,
    adminId: 1,
    reference,
    confirmChecked: true,
    note: "Disposable test: provider review confirmed no transaction.",
  };

  async function resetFixture() {
    await testPool.query(`
      TRUNCATE order_status_history,
        payment_reconciliation_alerts,
        stock_reservations,
        payments,
        inventory,
        orders,
        users RESTART IDENTITY;

      INSERT INTO users VALUES (1, TRUE, 'admin');

      INSERT INTO orders
        VALUES (1, FALSE, 'pending', 'unpaid', NULL);

      INSERT INTO inventory VALUES (1, 5, 1), (2, 5, 1);
    `);

    await testPool.query(
      `INSERT INTO payments (
         id, order_id, provider, status, idempotency_key, created_at
       )
       VALUES (
         1, 1, 'payfast_live', 'created', $1,
         NOW() - INTERVAL '1 hour'
       )`,
      [reference],
    );

    await testPool.query(`
      INSERT INTO stock_reservations
        (id, payment_id, variant_id, quantity, status)
      VALUES
        (1, 1, 1, 1, 'active'),
        (2, 1, 2, 1, 'active');
    `);
  }

  async function snapshot() {
    const tables = [
      "users",
      "orders",
      "payments",
      "inventory",
      "stock_reservations",
      "payment_reconciliation_alerts",
      "order_status_history",
    ];

    const result = {};

    for (const table of tables) {
      const key = table === "inventory" ? "variant_id" : "id";
      result[table] = (
        await testPool.query(`SELECT * FROM ${table} ORDER BY ${key}`)
      ).rows;
    }

    return result;
  }

  async function expectBlocked(label, setup, overrides = {}) {
    await resetFixture();
    if (setup) await setup();

    const before = await snapshot();

    await assert.rejects(
      () => closeVerifiedUnpaidLiveAttempt(
        { ...request, ...overrides },
        testPool,
      ),
      (error) => error.status === 409,
    );

    assert.deepEqual(await snapshot(), before);
    console.log(`PASS: ${label}; no records changed.`);
  }

  // These variables affect this test process only.
  process.env.NODE_ENV = "production";
  process.env.PAYFAST_MODE = "live";

  await expectBlocked("missing provider-review confirmation", null, {
    confirmChecked: false,
  });

  await expectBlocked("wrong payment reference", null, {
    reference: randomUUID(),
  });

  await expectBlocked("non-admin user", () => testPool.query(
    "UPDATE users SET role = 'customer' WHERE id = 1",
  ));

  await expectBlocked("demo order", () => testPool.query(
    "UPDATE orders SET is_demo = TRUE WHERE id = 1",
  ));

  await expectBlocked("sandbox payment", () => testPool.query(
    "UPDATE payments SET provider = 'payfast_sandbox' WHERE id = 1",
  ));

  await expectBlocked("recent attempt", () => testPool.query(
    "UPDATE payments SET created_at = NOW() WHERE id = 1",
  ));

  await expectBlocked("pending provider attempt", () => testPool.query(
    "UPDATE payments SET status = 'pending' WHERE id = 1",
  ));

  await expectBlocked("recorded provider transaction", () => testPool.query(
    "UPDATE payments SET provider_payment_id = 'TEST-PROVIDER-ID' WHERE id = 1",
  ));

  await expectBlocked("paid order", () => testPool.query(
    "UPDATE orders SET status = 'paid', payment_status = 'paid' WHERE id = 1",
  ));

  await expectBlocked("consumed reservation", () => testPool.query(
    "UPDATE stock_reservations SET status = 'consumed' WHERE id = 1",
  ));

  await expectBlocked("open reconciliation alert", () => testPool.query(
    `INSERT INTO payment_reconciliation_alerts
     VALUES (1, 1, 'open')`,
  ));

  // Variant 1 would be released before variant 2 fails.
  // The transaction must roll back both changes.
  await expectBlocked("partial stock release rolls back", () => testPool.query(
    "UPDATE inventory SET reserved_quantity = 0 WHERE variant_id = 2",
  ));

  await resetFixture();

  const results = await Promise.allSettled([
    closeVerifiedUnpaidLiveAttempt(request, testPool),
    closeVerifiedUnpaidLiveAttempt(request, testPool),
  ]);

  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }

  const state = await snapshot();

  assert.equal(state.payments[0].status, "cancelled");
  assert.equal(state.orders[0].status, "pending");
  assert.equal(state.orders[0].payment_status, "unpaid");

  for (const item of state.inventory) {
    assert.equal(item.quantity, 5);
    assert.equal(item.reserved_quantity, 0);
  }

  for (const reservation of state.stock_reservations) {
    assert.equal(reservation.status, "released");
    assert.ok(reservation.resolved_at);
  }

  assert.equal(state.order_status_history.length, 1);
  assert.equal(state.order_status_history[0].changed_by, 1);
  assert.ok(state.order_status_history[0].note.includes(reference));

  console.log("PASS: concurrent closure releases each reservation once.");
  console.log("PASS: physical stock and unpaid order remain unchanged.");
  console.log("PASS: one audit entry preserves admin and payment reference.");

  const beforeRepeat = await snapshot();
  await closeVerifiedUnpaidLiveAttempt(request, testPool);
  assert.deepEqual(await snapshot(), beforeRepeat);

  console.log("PASS: repeated closure changes nothing.");
  console.log("No emails or payment requests were sent.");
} catch (error) {
  console.error("TEST FAILED:", error);
  process.exitCode = 1;
} finally {
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("PAYFAST_MODE", originalPayfastMode);

  if (testPool) await testPool.end();

  if (schemaCreated) {
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      console.log("Disposable recovery test schema removed.");
    } catch (error) {
      console.error("TEST CLEANUP FAILED:", error.message);
      console.error("Disposable schema:", schema);
      process.exitCode = 1;
    }
  }

  await pool.end();
}