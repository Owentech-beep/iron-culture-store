import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteAdminEntry } from "../models/AdminDeletion.js";
import { pool } from "../config/database.js";
import {
  createPaymentAttempt,
  createSandboxPaymentAttempt,
  completeSandboxPayment,
  completePayment,
} from "../models/Payment.js";

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
  Object.assign(process.env, {
    PAYFAST_CHECKOUT_ENABLED: "true",
    PAYFAST_MERCHANT_ID: "10000100",
    PAYFAST_MERCHANT_KEY: "test-merchant-key",
    PAYFAST_PASSPHRASE: "test-passphrase",
    PAYFAST_PUBLIC_BASE_URL: "https://example.com",
    OZOW_CHECKOUT_ENABLED: "true",
    OZOW_MODE: "staging",
    OZOW_CLIENT_ID: "test-client",
    OZOW_CLIENT_SECRET: "test-secret",
    OZOW_SITE_CODE: "TEST-SITE",
    OZOW_PUBLIC_BASE_URL: "https://example.com",
    EMAIL_SENDING_ENABLED: "false",
  });

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


  const orderId = orderIds[2];
  const variantId = variantIds[1];

  // Both providers compete for the same order.
  // Wait for BOTH calls before asserting or cleaning up.
  const results = await Promise.allSettled([
    createPaymentAttempt(orderId, userId, "payfast"),
    createPaymentAttempt(orderId, userId, "ozow"),
  ]);

  checkRace(results, /already has a payment attempt/i);

  const winner = results.find(
    (result) => result.status === "fulfilled",
  ).value;

  assert.ok(
    ["payfast_sandbox", "ozow_staging"].includes(winner.provider),
  );

  await checkCounts([orderId], 1, 1);
  await checkInventory(variantId, 3, 1);

  console.log("PASS: simultaneous PayFast and Ozow submissions create one attempt.");
  console.log("PASS: stock is reserved once across both providers.");

  async function snapshot() {
    const queries = [
      ["SELECT * FROM payments WHERE order_id = $1 ORDER BY id", [orderId]],
      ["SELECT * FROM orders WHERE id = $1", [orderId]],
      ["SELECT * FROM inventory WHERE variant_id = $1", [variantId]],
      ["SELECT * FROM stock_reservations WHERE payment_id = $1 ORDER BY id", [winner.paymentId]],
      ["SELECT * FROM email_outbox WHERE order_id = $1 ORDER BY id", [orderId]],
    ];

    const rows = [];
    for (const [sql, values] of queries) {
      rows.push((await pool.query(sql, values)).rows);
    }
    return rows;
  }

  const before = await snapshot();

  for (const provider of ["payfast", "ozow"]) {
    await assert.rejects(
      () => createPaymentAttempt(orderId, userId, provider),
      (error) =>
        error.status === 409 &&
        /already has a payment attempt/i.test(error.message),
    );

    assert.deepEqual(await snapshot(), before);
  }

  console.log("PASS: neither provider can start another unresolved payment.");

  const [payments, orders, inventory, reservations, emails] = before;

  assert.equal(payments.length, 1);
  assert.equal(payments[0].provider, winner.provider);
  assert.equal(payments[0].status, "created");
  assert.equal(payments[0].provider_payment_id, null);
  assert.equal(payments[0].provider_request_started_at, null);

  assert.equal(orders[0].status, "pending");
  assert.equal(orders[0].payment_status, "unpaid");
  assert.equal(orders[0].stock_deducted_at, null);

  assert.equal(inventory[0].quantity, 3);
  assert.equal(inventory[0].reserved_quantity, 1);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].status, "active");
  assert.equal(reservations[0].quantity, 1);
  assert.equal(emails.length, 0);

  console.log("PASS: order stays unpaid; physical stock is unchanged; no email queued.");
  console.log("No provider requests were sent.");
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
