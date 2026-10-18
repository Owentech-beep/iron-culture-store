import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "../config/database.js";
import { createSandboxPaymentAttempt } from "../models/Payment.js";

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
        `INSERT INTO product_variants (product_id, sku, flavour)
         VALUES ($1, $2, $3)
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
    createSandboxPaymentAttempt(orderIds[0], userId),
    createSandboxPaymentAttempt(orderIds[1], userId),
  ]);

  checkRace(competingOrders, /enough available stock/i);
  await checkCounts(orderIds.slice(0, 2), 1, 1);
  await checkInventory(variantIds[0], 1, 1);

  console.log("PASS: only one order reserves the last unit.");

  const duplicateRequests = await Promise.allSettled([
    createSandboxPaymentAttempt(orderIds[2], userId),
    createSandboxPaymentAttempt(orderIds[2], userId),
  ]);

  checkRace(duplicateRequests, /already has a payment attempt/i);
  await checkCounts([orderIds[2]], 1, 1);
  await checkInventory(variantIds[1], 3, 1);

  console.log("PASS: concurrent requests create only one payment attempt.");

  await assert.rejects(
    () => createSandboxPaymentAttempt(orderIds[3], userId),
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
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  if (setupCommitted) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM payment_reconciliation_alerts
         WHERE payment_id IN (
           SELECT id FROM payments WHERE order_id = ANY($1::INTEGER[])
         )`,
        [orderIds],
      );

      await client.query(
        `DELETE FROM stock_reservations
         WHERE payment_id IN (
           SELECT id FROM payments WHERE order_id = ANY($1::INTEGER[])
         )`,
        [orderIds],
      );

      await client.query(
        "DELETE FROM payments WHERE order_id = ANY($1::INTEGER[])",
        [orderIds],
      );

      await client.query(
        "DELETE FROM orders WHERE id = ANY($1::INTEGER[])",
        [orderIds],
      );

      // Product deletion cascades to these disposable variants/inventory.
      await client.query("DELETE FROM products WHERE id = $1", [productId]);
      await client.query("DELETE FROM brands WHERE id = $1", [brandId]);
      await client.query("DELETE FROM categories WHERE id = $1", [categoryId]);

      await client.query("COMMIT");
      console.log("Disposable test records removed.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("TEST CLEANUP FAILED:", error.message);
      console.error("Fixture IDs:", { orderIds, productId, brandId, categoryId });
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }

  await pool.end();
}