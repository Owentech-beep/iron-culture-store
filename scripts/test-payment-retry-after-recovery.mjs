import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "../config/database.js";
import { createPaymentAttempt } from "../models/Payment.js";
import { closeVerifiedUnpaidLiveAttempt } from "../models/LivePaymentRecovery.js";
import { getPaymentPageData } from "../services/payments/paymentService.js";

const ids = {};
let fixtureCommitted = false;

async function transaction(work) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function checkLocalDatabase() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.equal(process.env.PAYFAST_MODE?.trim(), "sandbox");
  assert.ok(!process.env.DATABASE_URL, "Do not run with DATABASE_URL set.");

  const { rows: [db] } = await pool.query(`
    SELECT current_database() AS name,
           host(inet_server_addr()) AS address
  `);

  assert.equal(db.name, "iron_culture_store");
  assert.ok(
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(db.address),
    "Expected a local PostgreSQL server.",
  );
}

async function createFixture() {
  const tag = randomUUID();

  await transaction(async (client) => {
    async function insertId(sql, values) {
      const { rows: [row] } = await client.query(sql, values);
      return row.id;
    }

    ids.category = await insertId(
      `INSERT INTO categories (name, slug)
       VALUES ($1, $2) RETURNING id`,
      [`Retry test ${tag}`, `retry-category-${tag}`],
    );

    ids.brand = await insertId(
      `INSERT INTO brands (name, slug, is_demo)
       VALUES ($1, $2, FALSE) RETURNING id`,
      [`Retry test ${tag}`, `retry-brand-${tag}`],
    );

    ids.product = await insertId(
      `INSERT INTO products
         (category_id, brand_id, name, slug, price, is_active, is_demo)
       VALUES ($1, $2, 'Disposable retry test', $3, 800, TRUE, FALSE)
       RETURNING id`,
      [ids.category, ids.brand, `retry-product-${tag}`],
    );

    ids.variant = await insertId(
      `INSERT INTO product_variants (product_id, sku, flavour, size, price)
       VALUES ($1, $2, 'Test', '1 kg', 800) RETURNING id`,
      [ids.product, `RETRY-${tag}`],
    );

    await client.query(
      "INSERT INTO inventory (variant_id, quantity) VALUES ($1, 3)",
      [ids.variant],
    );

    ids.order = await insertId(
      `INSERT INTO orders (
         user_id, order_number, checkout_key, shipping_rate_status,
         shipping_address, subtotal_cents, delivery_cents, total_cents, is_demo
       )
       VALUES ($1, $2, $3, 'free', $4::jsonb, 80000, 0, 80000, FALSE)
       RETURNING id`,
      [
        ids.user,
        `TEST-${tag}`,
        randomUUID(),
        JSON.stringify({
          firstName: "Disposable",
          lastName: "Test",
          street: "Test address",
          city: "Test",
          email: "retry-test@example.com",
        }),
      ],
    );

    await client.query(
      `INSERT INTO order_items (
         order_id, variant_id, product_name, variant_name,
         quantity, unit_price_cents, line_total_cents
       )
       VALUES ($1, $2, 'Disposable retry test', 'Test option', 1, 80000, 80000)`,
      [ids.order, ids.variant],
    );
  });

  fixtureCommitted = true;
}

async function checkEligibility(expected) {
  const page = await getPaymentPageData(ids.order, ids.user);
  assert.ok(page, "Payment page data missing.");
  assert.equal(page.canStartPayment, expected, JSON.stringify(page.reasons));
}

async function checkInventory(reserved) {
  const { rows: [row] } = await pool.query(
    "SELECT quantity, reserved_quantity FROM inventory WHERE variant_id = $1",
    [ids.variant],
  );

  assert.equal(row.quantity, 3, "Physical stock must not change.");
  assert.equal(row.reserved_quantity, reserved, "Unexpected reserved stock.");
}

function isAttemptConflict(error) {
  return error.status === 409 && /already has a payment attempt/i.test(error.message);
}

async function cleanup() {
  await transaction(async (client) => {
    for (const sql of [
      `DELETE FROM payment_reconciliation_alerts WHERE payment_id IN
         (SELECT id FROM payments WHERE order_id = $1)`,
      `DELETE FROM stock_reservations WHERE payment_id IN
         (SELECT id FROM payments WHERE order_id = $1)`,
      "DELETE FROM payments WHERE order_id = $1",
      "DELETE FROM email_outbox WHERE order_id = $1",
      "DELETE FROM order_status_history WHERE order_id = $1",
      "DELETE FROM order_items WHERE order_id = $1",
      "DELETE FROM orders WHERE id = $1",
    ]) {
      await client.query(sql, [ids.order]);
    }

    await client.query("DELETE FROM inventory WHERE variant_id = $1", [ids.variant]);
    await client.query("DELETE FROM product_variants WHERE id = $1", [ids.variant]);
    await client.query("DELETE FROM products WHERE id = $1", [ids.product]);
    await client.query("DELETE FROM brands WHERE id = $1", [ids.brand]);
    await client.query("DELETE FROM categories WHERE id = $1", [ids.category]);
  });
}

try {
  await checkLocalDatabase();

  // Only this test process uses live-mode labels. No provider client is called.
  Object.assign(process.env, {
    NODE_ENV: "production",
    PAYFAST_MODE: "live",
    PAYFAST_CHECKOUT_ENABLED: "true",
    PAYFAST_MERCHANT_ID: "10000100",
    PAYFAST_MERCHANT_KEY: "test-merchant-key",
    PAYFAST_PASSPHRASE: "test-passphrase",
    PAYFAST_PUBLIC_BASE_URL: "https://example.com",
    OZOW_MODE: "live",
    OZOW_CHECKOUT_ENABLED: "true",
    OZOW_CLIENT_ID: "test-client",
    OZOW_CLIENT_SECRET: "test-secret",
    OZOW_SITE_CODE: "TEST-SITE",
    OZOW_PUBLIC_BASE_URL: "https://example.com",
    EMAIL_SENDING_ENABLED: "false",
  });

  const { rows: [admin] } = await pool.query(
    "SELECT id FROM users WHERE is_active AND role = 'admin' ORDER BY id LIMIT 1",
  );
  assert.ok(admin, "An active local admin is required. No fixture was created.");
  ids.admin = admin.id;

  const { rows: [user] } = await pool.query(
    "SELECT id FROM users WHERE is_active ORDER BY (id = $1), id LIMIT 1",
    [ids.admin],
  );
  ids.user = user.id;

  await createFixture();
  await checkEligibility(true);

  const first = await createPaymentAttempt(ids.order, ids.user, "ozow");
  assert.equal(first.provider, "ozow_live");

  // Simulate Ozow having previously returned a checkout URL.
  const { rows: [original] } = await pool.query(
    `UPDATE payments
     SET status = 'pending',
         created_at = NOW() - INTERVAL '2 hours',
         provider_request_started_at = NOW() - INTERVAL '2 hours',
         provider_request_expires_at = NOW() - INTERVAL '90 minutes',
         provider_request_id = $3,
         provider_checkout_url = 'https://example.invalid/test-only'
     WHERE id = $1 AND order_id = $2 AND provider = 'ozow_live'
     RETURNING idempotency_key`,
    [first.paymentId, ids.order, randomUUID()],
  );
  assert.ok(original);

  await checkEligibility(false);
  for (const provider of ["ozow", "payfast"]) {
    await assert.rejects(
      () => createPaymentAttempt(ids.order, ids.user, provider),
      isAttemptConflict,
    );
  }
  await checkInventory(1);
  console.log("PASS: an unresolved Ozow attempt blocks both retry options.");

  const review = {
    orderId: ids.order,
    paymentId: first.paymentId,
    adminId: ids.admin,
    reference: original.idempotency_key,
    confirmChecked: true,
    ozowFinalOutcome: "confirmed_terminal_unpaid",
    note: "Disposable test: provider confirmed terminal unpaid status.",
  };

  const { rows: [alert] } = await pool.query(
    `INSERT INTO payment_reconciliation_alerts
       (payment_id, provider_payment_id, amount_cents, reason)
     VALUES ($1, $2, 80000, 'Disposable retry test alert')
     RETURNING id`,
    [first.paymentId, randomUUID()],
  );

  await assert.rejects(
    () => closeVerifiedUnpaidLiveAttempt(review),
    (error) => error.status === 409,
  );
  await checkInventory(1);
  console.log("PASS: an open reconciliation alert blocks recovery.");

  // Remove only the alert this test injected. This is not an admin workflow.
  await pool.query(
    "DELETE FROM payment_reconciliation_alerts WHERE id = $1 AND payment_id = $2",
    [alert.id, first.paymentId],
  );

  await closeVerifiedUnpaidLiveAttempt(review);
  await checkInventory(0);
  await checkEligibility(true);
  console.log("PASS: verified closure enables payment on the same order.");

  const results = await Promise.allSettled(
    ["ozow", "payfast"].map((provider) =>
      createPaymentAttempt(ids.order, ids.user, provider),
    ),
  );

  const successes = results.filter((r) => r.status === "fulfilled");
  const failures = results.filter((r) => r.status === "rejected");
  assert.equal(successes.length, 1, "Exactly one retry should succeed.");
  assert.equal(failures.length, 1, "Exactly one retry should be blocked.");
  assert.ok(isAttemptConflict(failures[0].reason), failures[0].reason.message);

  const retry = successes[0].value;
  assert.notEqual(retry.paymentId, first.paymentId);

  const { rows: attempts } = await pool.query(
    `SELECT p.id, p.status AS payment, r.status AS reservation
     FROM payments p
     LEFT JOIN stock_reservations r ON r.payment_id = p.id
     WHERE p.order_id = $1
     ORDER BY p.id, r.id`,
    [ids.order],
  );

  assert.deepEqual(attempts, [
    { id: first.paymentId, payment: "cancelled", reservation: "released" },
    { id: retry.paymentId, payment: "created", reservation: "active" },
  ]);

  await checkInventory(1);
  await checkEligibility(false);

  const { rows: [order] } = await pool.query(
    "SELECT status, payment_status, stock_deducted_at FROM orders WHERE id = $1",
    [ids.order],
  );
  assert.equal(order.status, "pending");
  assert.equal(order.payment_status, "unpaid");
  assert.equal(order.stock_deducted_at, null);

  const emails = await pool.query(
    "SELECT id FROM email_outbox WHERE order_id = $1",
    [ids.order],
  );
  assert.equal(emails.rowCount, 0);

  console.log("PASS: two competing retries create one new attempt and reserve one unit.");
  console.log("PASS: the order stays unpaid and no confirmation email is queued.");
  console.log("No provider requests were sent.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  try {
    if (fixtureCommitted) {
      await cleanup();
      console.log("Disposable retry records removed.");
    }
  } catch (error) {
    console.error("TEST CLEANUP FAILED:", error.message);
    console.error("Disposable fixture IDs:", ids);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}