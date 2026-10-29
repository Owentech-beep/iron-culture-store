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

const { startPayment } = await import(
  "../services/payments/paymentService.js"
);

const originalFetch = globalThis.fetch;
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



  let tokenRequests = 0;
  let paymentRequests = 0;
  let simulateTimeout = false;

  const providerRequestId = randomUUID();
  const checkoutUrl =
    "https://stagingpay.ozow.com/?test=" + providerRequestId;

  const submitted = [];

  // Replace fetch before the service creates its Ozow client.
  // Every URL is handled here; nothing reaches the network.
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(options.method, "POST");

    if (String(url) === "https://stagingone.ozow.com/v1/token") {
      tokenRequests++;

      const form = new URLSearchParams(options.body);
      assert.equal(form.get("client_id"), "test-client");
      assert.equal(form.get("client_secret"), "test-secret");
      assert.equal(form.get("scope"), "payments");

      return new Response(JSON.stringify({
        access_token: "fake-local-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "payments",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    assert.equal(
      String(url),
      "https://stagingone.ozow.com/v1/payments",
    );

    paymentRequests++;

    const headers = new Headers(options.headers);
    const payload = JSON.parse(options.body);

    assert.equal(headers.get("authorization"), "Bearer fake-local-token");
    assert.equal(payload.amount.currency, "ZAR");
    assert.equal(payload.amount.value, 600);
    assert.equal(payload.siteCode, "TEST-SITE");
    assert.equal(
      headers.get("idempotency-key"),
      payload.merchantReference,
    );

    submitted.push(payload);

    if (simulateTimeout) {
      throw new Error("Simulated timeout after request submission.");
    }

    return new Response(JSON.stringify({
      id: providerRequestId,
      status: "Created",
      redirectUrl: checkoutUrl,
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const checkout = await startPayment(orderIds[2], userId, "ozow");

  assert.equal(checkout.providerName, "ozow");
  assert.equal(checkout.mode, "staging");
  assert.equal(checkout.checkoutUrl, checkoutUrl);
  assert.equal(tokenRequests, 1);
  assert.equal(paymentRequests, 1);

  const { rows: saved } = await pool.query(
    "SELECT * FROM payments WHERE order_id = $1",
    [orderIds[2]],
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].provider, "ozow_staging");
  assert.equal(saved[0].status, "pending");
  assert.equal(saved[0].provider_request_id, providerRequestId);
  assert.equal(saved[0].provider_checkout_url, checkoutUrl);
  assert.ok(saved[0].provider_request_started_at);
  assert.ok(saved[0].provider_request_expires_at);
  assert.equal(saved[0].provider_payment_id, null);
  assert.equal(saved[0].idempotency_key, submitted[0].merchantReference);

  await checkInventory(variantIds[1], 3, 1);

  console.log("PASS: handoff saves Ozow request details before returning the checkout URL.");

  for (const provider of ["ozow", "payfast"]) {
    await assert.rejects(
      () => startPayment(orderIds[2], userId, provider),
      (error) => error.status === 409,
    );
  }

  assert.equal(paymentRequests, 1);
  await checkCounts([orderIds[2]], 1, 1);

  console.log("PASS: repeated handoff cannot submit another provider request.");

  // Use a separate disposable order for the uncertain outcome.
  simulateTimeout = true;

  await assert.rejects(
    () => startPayment(orderIds[0], userId, "ozow"),
    (error) => error.status === 409,
  );

  assert.equal(paymentRequests, 2);
  assert.equal(tokenRequests, 1);

  const { rows: unresolved } = await pool.query(
    "SELECT * FROM payments WHERE order_id = $1",
    [orderIds[0]],
  );

  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].status, "created");
  assert.ok(unresolved[0].provider_request_started_at);
  assert.equal(unresolved[0].provider_request_id, null);
  assert.equal(unresolved[0].provider_checkout_url, null);
  assert.equal(unresolved[0].provider_payment_id, null);

  await checkInventory(variantIds[0], 1, 1);

  for (const provider of ["ozow", "payfast"]) {
    await assert.rejects(
      () => startPayment(orderIds[0], userId, provider),
      (error) => error.status === 409,
    );
  }

  assert.equal(paymentRequests, 2);
  await checkCounts([orderIds[0]], 1, 1);

  console.log("PASS: timeout preserves the claim and reservation without automatic retry.");
  console.log("PASS: unresolved Ozow handoff also blocks a PayFast attempt.");
  console.log("PASS: the cached authentication token is reused.");

  const { rows: orders } = await pool.query(
    "SELECT payment_status, stock_deducted_at FROM orders WHERE id = ANY($1::INTEGER[])",
    [[orderIds[0], orderIds[2]]],
  );

  assert.equal(orders.length, 2);

  for (const order of orders) {
    assert.equal(order.payment_status, "unpaid");
    assert.equal(order.stock_deducted_at, null);
  }

  const { rows: emails } = await pool.query(
    "SELECT id FROM email_outbox WHERE order_id = ANY($1::INTEGER[])",
    [orderIds],
  );

  assert.equal(emails.length, 0);

  console.log("PASS: checkout handoff does not mark orders paid or queue confirmation emails.");
  console.log("All provider HTTP responses were simulated; no external requests were sent.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;

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
