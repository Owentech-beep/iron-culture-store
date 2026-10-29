import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteAdminEntry } from "../models/AdminDeletion.js";
import { pool } from "../config/database.js";
import {
  createPaymentAttempt,
  completePayment,
} from "../models/Payment.js";
import {
  claimOzowPaymentRequest,
} from "../models/OzowPaymentRequest.js";

function startTestPayment(orderId, userId) {
  return createPaymentAttempt(orderId, userId, "ozow");
}

function finishTestPayment(notification) {
  return completePayment(notification);
}

const orderIds = [];
const variantIds = [];
let categoryId;
let brandId;
let productId;
let setupCommitted = false;

async function checkInventory(variantId, quantity, reserved) {
  const { rows } = await pool.query(
    `SELECT quantity, reserved_quantity
     FROM inventory
     WHERE variant_id = $1`,
    [variantId],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, quantity);
  assert.equal(rows[0].reserved_quantity, reserved);
}

async function checkCounts(ids, payments, reservations) {
  const { rows } = await pool.query(
    `SELECT
       (
         SELECT COUNT(*)::INTEGER
         FROM payments
         WHERE order_id = ANY($1::INTEGER[])
       ) AS payments,
       (
         SELECT COUNT(*)::INTEGER
         FROM stock_reservations r
         JOIN payments p ON p.id = r.payment_id
         WHERE p.order_id = ANY($1::INTEGER[])
       ) AS reservations`,
    [ids],
  );

  assert.equal(rows[0].payments, payments);
  assert.equal(rows[0].reservations, reservations);
}

function checkRace(results, expectedMessage) {
  const successes = results.filter((r) => r.status === "fulfilled");
  const failures = results.filter((r) => r.status === "rejected");

  assert.equal(successes.length, 1, "Exactly one request must succeed.");
  assert.equal(failures.length, 1, "Exactly one request must be rejected.");
  assert.equal(failures[0].reason.status, 409);
  assert.match(failures[0].reason.message, expectedMessage);
}

try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.PAYFAST_MODE?.trim() !== "sandbox" ||
    process.env.DATABASE_URL
  ) {
    throw new Error(
      "Run only against local development PostgreSQL in sandbox mode.",
    );
  }

  const { rows: connection } = await pool.query(
    `SELECT
       current_database() AS database,
       host(inet_server_addr()) AS server_address`,
  );

  assert.equal(connection[0].database, "iron_culture_store");
  assert.ok(
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      connection[0].server_address,
    ),
    "Expected a local PostgreSQL server.",
  );

  // Only this test process enables payment creation.
  // The database and sandbox checks above must pass first.
  // Fake credentials are used only to validate configuration.
  // This script never calls the Ozow HTTP client.
  process.env.OZOW_CHECKOUT_ENABLED = "true";
  process.env.OZOW_MODE = "staging";
  process.env.OZOW_CLIENT_ID = "disposable-test-client";
  process.env.OZOW_CLIENT_SECRET = "disposable-test-secret";
  process.env.OZOW_SITE_CODE = "TEST-SITE";
  process.env.OZOW_PUBLIC_BASE_URL = "https://example.com";
  process.env.EMAIL_SENDING_ENABLED = "false";

  // Use an existing account only as an order owner.
  // Its account details and existing orders are never modified.
  const { rows: users } = await pool.query(
    "SELECT id FROM users WHERE is_active ORDER BY id LIMIT 1",
  );

  assert.equal(users.length, 1, "An active local account is required.");
  const userId = users[0].id;
  const token = randomUUID();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const category = await client.query(
      `INSERT INTO categories (name, slug)
       VALUES ('Concurrency test', $1)
       RETURNING id`,
      [`test-category-${token}`],
    );
    categoryId = category.rows[0].id;

    const brand = await client.query(
      `INSERT INTO brands (name, slug, is_demo)
       VALUES ('Concurrency test', $1, TRUE)
       RETURNING id`,
      [`test-brand-${token}`],
    );
    brandId = brand.rows[0].id;

    const product = await client.query(
      `INSERT INTO products (
         category_id, brand_id, name, slug, price,
         is_active, is_demo
       )
       VALUES ($1, $2, 'Disposable concurrency test', $3, 600, TRUE, TRUE)
       RETURNING id`,
      [categoryId, brandId, `test-product-${token}`],
    );
    productId = product.rows[0].id;

    // A: last unit; B: duplicate request; C/D: insufficient-stock order.
    for (const [index, quantity] of [1, 3, 2, 0].entries()) {
      const variant = await client.query(
        `INSERT INTO product_variants (
           product_id, sku, flavour, size, price
         )
         VALUES ($1, $2, $3, '1 kg', 600)
         RETURNING id`,
        [productId, `TEST-${token}-${index}`, `Test ${index}`],
      );

      const variantId = variant.rows[0].id;
      variantIds.push(variantId);

      await client.query(
        `INSERT INTO inventory (variant_id, quantity)
         VALUES ($1, $2)`,
        [variantId, quantity],
      );
      // Option B starts with three units costing R400 each.
      // It is the option used by the duplicate-confirmation test.
      if (index === 1) {
        await client.query(
          `INSERT INTO stock_cost_batches (
       variant_id,
       entry_type,
       quantity_received,
       quantity_remaining,
       unit_cost_cents,
       received_on,
       supplier,
       invoice_reference,
       note,
       is_demo,
       created_by,
       submission_key
     )
     VALUES (
       $1, 'purchase', $2, $2, 40000,
       CURRENT_DATE,
       'Disposable test supplier',
       'TEST-INVOICE',
       'Disposable stock-cost test fixture.',
       TRUE,
       $3,
       $4
     )`,
          [variantId, quantity, userId, randomUUID()],
        );

        await client.query(
          `UPDATE inventory
     SET cost_tracking_started_at = NOW()
     WHERE variant_id = $1`,
          [variantId],
        );
      }
    }

    async function createOrder(variants) {
      const total = variants.length * 60000;

      const order = await client.query(
        `INSERT INTO orders (
           user_id, order_number, checkout_key,
           shipping_rate_status, shipping_address,
           subtotal_cents, delivery_cents, total_cents, is_demo
         )
         VALUES ($1, $2, $3, 'free', $4::JSONB, $5, 0, $5, TRUE)
         RETURNING id`,
        [
          userId,
          `TEST-${randomUUID()}`,
          randomUUID(),
          JSON.stringify({
            firstName: "Disposable",
            lastName: "Test",
            street: "Test address",
            city: "Test",
            email: "payment-test@example.com",
          }),
          total,
        ],
      );

      const orderId = order.rows[0].id;
      orderIds.push(orderId);

      for (const variantId of variants) {
        await client.query(
          `INSERT INTO order_items (
             order_id, variant_id, product_name, variant_name,
             quantity, unit_price_cents, line_total_cents
           )
           VALUES ($1, $2, 'Test product', 'Test option', 1, 60000, 60000)`,
          [orderId, variantId],
        );
      }
    }

    await createOrder([variantIds[0]]);
    await createOrder([variantIds[0]]);
    await createOrder([variantIds[1]]);
    await createOrder([variantIds[2], variantIds[3]]);

    await client.query("COMMIT");
    setupCommitted = true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Wait for both requests to finish before checking or cleaning up.
  const competingOrders = await Promise.allSettled([
    startTestPayment(orderIds[0], userId),
    startTestPayment(orderIds[1], userId),
  ]);

  checkRace(competingOrders, /enough available stock/i);
  await checkCounts(orderIds.slice(0, 2), 1, 1);
  await checkInventory(variantIds[0], 1, 1);

  console.log("PASS: only one order reserves the last unit.");

  const duplicateRequests = await Promise.allSettled([
    startTestPayment(orderIds[2], userId),
    startTestPayment(orderIds[2], userId),
  ]);

  checkRace(duplicateRequests, /already has a payment attempt/i);
  await checkCounts([orderIds[2]], 1, 1);
  await checkInventory(variantIds[1], 3, 1);

  console.log("PASS: concurrent requests create only one payment attempt.");

  await assert.rejects(
    () => startTestPayment(orderIds[3], userId),
    (error) =>
      error.status === 409 && /enough available stock/i.test(error.message),
  );

  await checkCounts([orderIds[3]], 0, 0);
  await checkInventory(variantIds[2], 2, 0);
  await checkInventory(variantIds[3], 0, 0);

  console.log("PASS: insufficient stock leaves no partial reservations.");

  const { rows: orders } = await pool.query(
    `SELECT status, payment_status, stock_deducted_at
     FROM orders
     WHERE id = ANY($1::INTEGER[])`,
    [orderIds],
  );

  assert.equal(orders.length, 4);

  for (const order of orders) {
    assert.equal(order.status, "pending");
    assert.equal(order.payment_status, "unpaid");
    assert.equal(order.stock_deducted_at, null);
  }

  console.log("PASS: physical stock unchanged and orders remain unpaid.");
  const successfulRequest = duplicateRequests.find(
    (result) => result.status === "fulfilled",
  );

  assert.ok(successfulRequest);
  const attempt = successfulRequest.value;

  const notification = {
    paymentReference: attempt.paymentReference,
    providerPaymentId: randomUUID(),
    amountCents: attempt.amountCents,
    provider: "ozow_staging",
    paymentStatus: "COMPLETE",
  };

  // Snapshot all completion-related records for this disposable order.
  async function snapshot() {
    const queries = [
      ["SELECT * FROM orders WHERE id = $1", [orderIds[2]]],
      ["SELECT * FROM payments WHERE order_id = $1 ORDER BY id", [orderIds[2]]],
      ["SELECT * FROM stock_reservations WHERE payment_id = $1 ORDER BY id", [attempt.paymentId]],
      ["SELECT * FROM inventory WHERE variant_id = $1", [variantIds[1]]],
      ["SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderIds[2]]],
      ["SELECT * FROM stock_cost_batches WHERE variant_id = $1 ORDER BY id", [variantIds[1]]],
      ["SELECT * FROM stock_cost_allocations WHERE variant_id = $1 ORDER BY id", [variantIds[1]]],
      ["SELECT * FROM email_outbox WHERE order_id = $1 ORDER BY id", [orderIds[2]]],
      ["SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY id", [orderIds[2]]],
    ];

    const results = [];
    for (const [sql, values] of queries) {
      results.push((await pool.query(sql, values)).rows);
    }
    return results;
  }

  async function rejectWithoutChanges(candidate, label) {
    const before = await snapshot();

    await assert.rejects(
      () => completePayment(candidate),
      (error) => error.status === 409,
    );

    assert.deepEqual(await snapshot(), before);
    console.log("PASS: " + label + "; no completion records changed.");
  }

  await rejectWithoutChanges(notification, "unclaimed Ozow attempt rejected");

  await claimOzowPaymentRequest({
    paymentId: attempt.paymentId,
    orderId: orderIds[2],
    userId,
    provider: "ozow_staging",
  });

  for (const status of [undefined, "PENDING", "INCOMPLETE", "ERROR"]) {
    await rejectWithoutChanges(
      { ...notification, paymentStatus: status },
      "non-success or missing Ozow status rejected",
    );
  }

  await rejectWithoutChanges(
    { ...notification, amountCents: notification.amountCents + 1 },
    "wrong Ozow amount rejected",
  );

  await rejectWithoutChanges(
    { ...notification, provider: "ozow_live" },
    "live notification cannot complete a staging attempt",
  );

  await rejectWithoutChanges(
    { ...notification, providerPaymentId: "123456" },
    "non-UUID Ozow transaction ID rejected",
  );

  // Exercise the order/environment check using only our fixture.
  await pool.query(
    "UPDATE orders SET is_demo = FALSE WHERE id = $1",
    [orderIds[2]],
  );

  try {
    await rejectWithoutChanges(
      notification,
      "staging payment cannot complete a non-demo order",
    );
  } finally {
    await pool.query(
      "UPDATE orders SET is_demo = TRUE WHERE id = $1",
      [orderIds[2]],
    );
  }

  // In-flight confirmations must still work after checkout is disabled.
  process.env.OZOW_CHECKOUT_ENABLED = "false";

  // A wrong amount must not consume the reservation.
  await assert.rejects(
    () =>
      finishTestPayment({
        ...notification,
        amountCents: notification.amountCents + 1,
      }),
    (error) => error.status === 409,
  );

  // A live notification must not match a sandbox payment.
  await assert.rejects(
    () =>
      completePayment({
        ...notification,
        provider: "ozow_live",
      }),
    (error) => error.status === 409,
  );

  await checkInventory(variantIds[1], 3, 1);

  const { rows: beforeCompletion } = await pool.query(
    `SELECT status, payment_status, stock_deducted_at
     FROM orders
     WHERE id = $1`,
    [orderIds[2]],
  );

  assert.equal(beforeCompletion[0].status, "pending");
  assert.equal(beforeCompletion[0].payment_status, "unpaid");
  assert.equal(beforeCompletion[0].stock_deducted_at, null);

  const { rows: beforeEmails } = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM email_outbox
     WHERE order_id = $1`,
    [orderIds[2]],
  );

  assert.equal(beforeEmails[0].total, 0);
  console.log("PASS: wrong amount and provider leave payment state unchanged.");

  // Remove the disposable product while payments hold reservations.
  const { rows: productBeforeRemoval } = await pool.query(
    "SELECT slug FROM products WHERE id = $1",
    [productId],
  );

  assert.equal(productBeforeRemoval.length, 1);

  const { rows: reservationsBeforeRemoval } = await pool.query(
    `SELECT r.*
     FROM stock_reservations r
     JOIN payments p ON p.id = r.payment_id
     WHERE p.order_id = ANY($1::INTEGER[])
     ORDER BY r.id`,
    [orderIds],
  );

  const removal = await deleteAdminEntry(
    "products",
    productId,
    productBeforeRemoval[0].slug,
  );

  assert.equal(removal.outcome, "retired");

  const { rows: retiredProducts } = await pool.query(
    `SELECT is_active, retired_at
     FROM products
     WHERE id = $1`,
    [productId],
  );

  assert.equal(retiredProducts.length, 1);
  assert.equal(retiredProducts[0].is_active, false);
  assert.ok(retiredProducts[0].retired_at);

  await checkInventory(variantIds[0], 1, 1);
  await checkInventory(variantIds[1], 3, 1);
  await checkInventory(variantIds[2], 2, 0);
  await checkInventory(variantIds[3], 0, 0);

  const { rows: reservationsAfterRemoval } = await pool.query(
    `SELECT r.*
     FROM stock_reservations r
     JOIN payments p ON p.id = r.payment_id
     WHERE p.order_id = ANY($1::INTEGER[])
     ORDER BY r.id`,
    [orderIds],
  );

  assert.deepEqual(
    reservationsAfterRemoval,
    reservationsBeforeRemoval,
    "Retirement must preserve every reservation unchanged.",
  );

  console.log(
    "PASS: removing a reserved product retires it without changing stock or reservations.",
  );

  process.env.OZOW_CHECKOUT_ENABLED = "true";

  // This order previously failed for insufficient stock and has
  // no payment attempt. Retirement must now prevent a new attempt.
  await assert.rejects(
    () => startTestPayment(orderIds[3], userId),
    (error) =>
      error.status === 409 && /no longer available/i.test(error.message),
  );

  await checkCounts([orderIds[3]], 0, 0);

  console.log("PASS: retired products cannot start new payment attempts.");

  process.env.OZOW_CHECKOUT_ENABLED = "false";

  // Wait for both calls before assertions or cleanup.
  const confirmations = await Promise.allSettled([
    finishTestPayment(notification),
    finishTestPayment(notification),
  ]);

  for (const result of confirmations) {
    if (result.status === "rejected") throw result.reason;
  }

  assert.deepEqual(
    confirmations.map((result) => result.value.alreadyProcessed).sort(),
    [false, true],
  );

  await checkInventory(variantIds[1], 2, 0);

  const { rows: completedOrders } = await pool.query(
    `SELECT status, payment_status, stock_deducted_at
     FROM orders
     WHERE id = $1`,
    [orderIds[2]],
  );

  assert.equal(completedOrders[0].status, "paid");
  assert.equal(completedOrders[0].payment_status, "paid");
  assert.ok(completedOrders[0].stock_deducted_at);

  const { rows: completedPayments } = await pool.query(
    `SELECT status, provider, provider_payment_id
     FROM payments
     WHERE id = $1`,
    [attempt.paymentId],
  );

  assert.equal(completedPayments[0].status, "succeeded");
  assert.equal(completedPayments[0].provider, "ozow_staging");
  assert.equal(
    completedPayments[0].provider_payment_id,
    notification.providerPaymentId,
  );

  const { rows: consumed } = await pool.query(
    `SELECT status, quantity, resolved_at
     FROM stock_reservations
     WHERE payment_id = $1`,
    [attempt.paymentId],
  );

  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].status, "consumed");
  assert.equal(consumed[0].quantity, 1);
  assert.ok(consumed[0].resolved_at);

  const { rows: emails } = await pool.query(
    `SELECT event_type, status, is_demo
     FROM email_outbox
     WHERE order_id = $1`,
    [orderIds[2]],
  );

  assert.equal(emails.length, 1);
  assert.equal(emails[0].event_type, "payment_confirmed");
  assert.equal(emails[0].status, "pending");
  assert.equal(emails[0].is_demo, true);

  const { rows: history } = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM order_status_history
     WHERE order_id = $1 AND new_status = 'paid'`,
    [orderIds[2]],
  );

  assert.equal(history[0].total, 1);

  console.log(
    "PASS: successful confirmation marks the order and payment paid.",
  );
  console.log("PASS: duplicate confirmations deduct stock only once.");
  console.log("PASS: reservation consumed and reserved stock released.");
  console.log("PASS: one payment email and one paid history entry.");

  const { rows: costedItems } = await pool.query(
    `SELECT
     quantity,
     cost_total_cents::TEXT AS cost_total_cents,
     cost_recorded_at
   FROM order_items
   WHERE order_id = $1
     AND variant_id = $2`,
    [orderIds[2], variantIds[1]],
  );

  assert.equal(costedItems.length, 1);
  assert.equal(costedItems[0].quantity, 1);
  assert.equal(costedItems[0].cost_total_cents, "40000");
  assert.ok(costedItems[0].cost_recorded_at);

  const { rows: allocations } = await pool.query(
    `SELECT
     a.quantity,
     a.unit_cost_cents::TEXT AS unit_cost_cents
   FROM stock_cost_allocations a
   JOIN order_items oi ON oi.id = a.order_item_id
   WHERE oi.order_id = $1
     AND a.variant_id = $2`,
    [orderIds[2], variantIds[1]],
  );

  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].quantity, 1);
  assert.equal(allocations[0].unit_cost_cents, "40000");

  const { rows: remainingCosts } = await pool.query(
    `SELECT
     SUM(quantity_remaining)::INTEGER AS remaining_units,
     SUM(
       quantity_remaining::BIGINT * unit_cost_cents
     )::TEXT AS remaining_cost_cents
   FROM stock_cost_batches
   WHERE variant_id = $1`,
    [variantIds[1]],
  );

  assert.equal(remainingCosts[0].remaining_units, 2);
  assert.equal(remainingCosts[0].remaining_cost_cents, "80000");

  console.log("PASS: sold unit records its R400 purchase cost.");
  console.log("PASS: duplicate confirmations create one cost allocation.");
  console.log("PASS: remaining two units retain R800 of stock cost.");
  await rejectWithoutChanges(
    { ...notification, providerPaymentId: randomUUID() },
    "another transaction cannot replace the completed payment",
  );

  const beforeReplay = await snapshot();
  const replay = await completePayment(notification);

  assert.equal(replay.alreadyProcessed, true);
  assert.deepEqual(await snapshot(), beforeReplay);

  console.log("PASS: later replay leaves payment, stock, costs and email unchanged.");
  console.log("PASS: completion works while new Ozow checkout is disabled.");
  console.log("No provider requests were sent; the demo email is removed during cleanup.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (setupCommitted) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Remove cost records belonging only to this test's disposable variants.
      // Allocations reference both batches and order items, so delete them first.
      await client.query(
        `DELETE FROM stock_cost_allocations
   WHERE variant_id = ANY($1::INTEGER[])`,
        [variantIds],
      );

      await client.query(
        `DELETE FROM stock_cost_adjustments
   WHERE variant_id = ANY($1::INTEGER[])`,
        [variantIds],
      );

      await client.query(
        `DELETE FROM stock_cost_batches
   WHERE variant_id = ANY($1::INTEGER[])`,
        [variantIds],
      );

      await client.query(
        `DELETE FROM payment_reconciliation_alerts
         WHERE payment_id IN (
           SELECT id FROM payments
           WHERE order_id = ANY($1::INTEGER[])
         )`,
        [orderIds],
      );

      await client.query(
        `DELETE FROM stock_reservations
         WHERE payment_id IN (
           SELECT id FROM payments
           WHERE order_id = ANY($1::INTEGER[])
         )`,
        [orderIds],
      );

      await client.query(
        "DELETE FROM payments WHERE order_id = ANY($1::INTEGER[])",
        [orderIds],
      );

      await client.query(
        "DELETE FROM email_outbox WHERE order_id = ANY($1::INTEGER[])",
        [orderIds],
      );

      await client.query(
        "DELETE FROM order_status_history WHERE order_id = ANY($1::INTEGER[])",
        [orderIds],
      );

      await client.query(
        "DELETE FROM order_items WHERE order_id = ANY($1::INTEGER[])",
        [orderIds],
      );

      await client.query("DELETE FROM orders WHERE id = ANY($1::INTEGER[])", [
        orderIds,
      ]);

      await client.query(
        "DELETE FROM inventory WHERE variant_id = ANY($1::INTEGER[])",
        [variantIds],
      );

      await client.query(
        "DELETE FROM product_variants WHERE id = ANY($1::INTEGER[])",
        [variantIds],
      );

      await client.query("DELETE FROM products WHERE id = $1", [productId]);

      await client.query("DELETE FROM brands WHERE id = $1", [brandId]);

      await client.query("DELETE FROM categories WHERE id = $1", [categoryId]);

      await client.query("COMMIT");
      console.log("Disposable test records removed.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("TEST CLEANUP FAILED:", error.message);
      console.error("Fixture IDs:", {
        orderIds,
        productId,
        brandId,
        categoryId,
      });
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }
  await pool.end();
}
