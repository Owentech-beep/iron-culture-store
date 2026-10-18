import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "../config/database.js";
import {
  createSandboxPaymentAttempt,
  completeSandboxPayment,
} from "../models/Payment.js";
import {
  recordSandboxReconciliation,
  listPaymentReconciliationAlerts,
  resolveSuccessfulSandboxAlert,
} from "../models/PaymentReconciliation.js";

let fixtureOrderId;
let fixturePaymentId;

try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.PAYFAST_MODE?.trim() !== "sandbox" ||
    process.env.DATABASE_URL
  ) {
    throw new Error(
      "Run this test only against local development PostgreSQL in sandbox mode.",
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

  // Copy only the order's required fields into a new disposable demo order.
  // The source order is never updated.
  const { rows: orders } = await pool.query(
    `INSERT INTO orders (
       user_id,
       order_number,
       checkout_key,
       status,
       payment_status,
       shipping_rate_status,
       shipping_address,
       subtotal_cents,
       discount_cents,
       delivery_cents,
       total_cents,
       is_demo
     )
     SELECT
       user_id,
       $1,
       $2,
       'pending',
       'unpaid',
       'free',
       shipping_address,
       10000,
       0,
       0,
       10000,
       TRUE
     FROM orders
     WHERE id = 18 AND is_demo
     RETURNING id, user_id`,
    [`TEST-${randomUUID()}`, randomUUID()],
  );

  assert.equal(
    orders.length,
    1,
    "Expected demo order 18 as the fixture source.",
  );

  fixtureOrderId = orders[0].id;
  const userId = orders[0].user_id;
  const paymentReference = randomUUID();

  const { rows: payments } = await pool.query(
    `INSERT INTO payments (
       order_id,
       provider,
       idempotency_key,
       amount_cents,
       currency,
       status
     )
     VALUES ($1, 'payfast_sandbox', $2, 10000, 'ZAR', 'cancelled')
     RETURNING id`,
    [fixtureOrderId, paymentReference],
  );

  fixturePaymentId = payments[0].id;

  // Fictional data exercises the database layer only.
  // This does not simulate successful gateway authentication.
  const notification = {
    paymentReference,
    providerPaymentId: `999${Date.now()}`,
    amountCents: 10000,
  };

  await assert.rejects(
    () => completeSandboxPayment(notification),
    (error) => error.status === 409,
    "A closed attempt must not automatically become paid.",
  );

  await recordSandboxReconciliation(notification);
  await recordSandboxReconciliation(notification);

  const alerts = await listPaymentReconciliationAlerts(fixtureOrderId);

  assert.equal(alerts.length, 1, "Repeated reports must use one alert.");
  assert.equal(alerts[0].occurrence_count, 2);
  assert.equal(alerts[0].status, "open");

  await recordSandboxReconciliation({
    ...notification,
    paymentStatus: "FAILED",
  });

  const updatedAlerts = await listPaymentReconciliationAlerts(fixtureOrderId);

  assert.equal(updatedAlerts.length, 1);
  assert.equal(updatedAlerts[0].provider_status, "FAILED");
  assert.equal(updatedAlerts[0].occurrence_count, 3);
  assert.equal(updatedAlerts[0].status, "open");

  console.log("PASS: non-COMPLETE status saved for review.");

  await assert.rejects(
    () => createSandboxPaymentAttempt(fixtureOrderId, userId),
    (error) =>
      error.status === 409 && /reconciliation alert/i.test(error.message),
    "An open alert must block another payment attempt.",
  );

  const { rows: state } = await pool.query(
    `SELECT
       o.status,
       o.payment_status,
       o.stock_deducted_at,
       p.status AS attempt_status
     FROM orders o
     JOIN payments p ON p.order_id = o.id
     WHERE o.id = $1 AND p.id = $2`,
    [fixtureOrderId, fixturePaymentId],
  );

  assert.equal(state[0].status, "pending");
  assert.equal(state[0].payment_status, "unpaid");
  assert.equal(state[0].stock_deducted_at, null);
  assert.equal(state[0].attempt_status, "cancelled");

  console.log("PASS: closed attempt rejected.");
  console.log("PASS: reconciliation alert saved without duplication.");
  console.log("PASS: open alert blocks another payment.");
  console.log("PASS: order remains unpaid.");
  const { rows: admins } = await pool.query(
    `SELECT id
     FROM users
     WHERE role = 'admin' AND is_active
     ORDER BY id
     LIMIT 1`,
  );

  assert.ok(admins[0], "An active local admin is required for this test.");

  // Restore the fixture alert to COMPLETE.
  await recordSandboxReconciliation(notification);

  const [alert] = await listPaymentReconciliationAlerts(fixtureOrderId);

  const resolution = {
    orderId: fixtureOrderId,
    alertId: alert.id,
    adminId: admins[0].id,
    expectedOccurrenceCount: alert.occurrence_count,
    note: "Automated local fixture: matching successful payment reviewed.",
  };

  await assert.rejects(
    () => resolveSuccessfulSandboxAlert(resolution),
    (error) =>
      error.status === 409 && /successfully paid order/i.test(error.message),
    "An unpaid order must not qualify for resolution.",
  );

  console.log("PASS: resolution rejected for an unpaid order.");

  // Simulate a successful payment on the disposable fixture only.
  await pool.query(
    `UPDATE payments
     SET status = 'succeeded', provider_payment_id = $1
     WHERE id = $2`,
    [notification.providerPaymentId, fixturePaymentId],
  );

  await pool.query(
    `UPDATE orders
     SET status = 'paid',
         payment_status = 'paid',
         stock_deducted_at = NOW()
     WHERE id = $1`,
    [fixtureOrderId],
  );

  // A wrong amount must still block resolution.
  await recordSandboxReconciliation({
    ...notification,
    amountCents: 10001,
  });

  let [currentAlert] = await listPaymentReconciliationAlerts(fixtureOrderId);

  await assert.rejects(
    () =>
      resolveSuccessfulSandboxAlert({
        ...resolution,
        expectedOccurrenceCount: currentAlert.occurrence_count,
      }),
    (error) =>
      error.status === 409 && /successfully paid order/i.test(error.message),
    "A mismatched payment amount must block resolution.",
  );

  console.log("PASS: resolution rejected for an amount mismatch.");

  await recordSandboxReconciliation(notification);

  [currentAlert] = await listPaymentReconciliationAlerts(fixtureOrderId);

  const currentResolution = {
    ...resolution,
    expectedOccurrenceCount: currentAlert.occurrence_count,
  };

  await assert.rejects(
    () => resolveSuccessfulSandboxAlert(resolution),
    (error) =>
      error.status === 409 && /another notification/i.test(error.message),
    "A stale form must not resolve a newer alert.",
  );

  console.log("PASS: stale resolution form rejected.");

  await assert.rejects(
    () => resolveSuccessfulSandboxAlert(currentResolution),
    (error) =>
      error.status === 409 && /consumed reservations/i.test(error.message),
    "Missing consumed reservations must block resolution.",
  );

  console.log("PASS: missing stock evidence blocks resolution.");

  // Read an existing variant ID without modifying that variant or its stock.
  const { rows: sourceItems } = await pool.query(
    `SELECT oi.variant_id
     FROM order_items oi
     JOIN inventory i ON i.variant_id = oi.variant_id
     WHERE oi.order_id = 18
     ORDER BY oi.id
     LIMIT 1`,
  );

  assert.ok(sourceItems[0], "Order 18 needs an item with inventory.");

  const variantId = sourceItems[0].variant_id;

  const { rows: stockBefore } = await pool.query(
    `SELECT quantity, reserved_quantity
     FROM inventory
     WHERE variant_id = $1`,
    [variantId],
  );

  await pool.query(
    `INSERT INTO order_items (
       order_id,
       variant_id,
       product_name,
       variant_name,
       quantity,
       unit_price_cents,
       line_total_cents
     )
     VALUES ($1, $2, 'TEST FIXTURE', 'TEST OPTION', 1, 10000, 10000)`,
    [fixtureOrderId, variantId],
  );

  // Synthetic historical evidence for testing resolution only.
  // No inventory is reserved or deducted by this fixture.
  await pool.query(
    `INSERT INTO stock_reservations (
       payment_id,
       variant_id,
       quantity,
       status,
       expires_at,
       resolved_at
     )
     VALUES ($1, $2, 1, 'consumed',
             NOW() + INTERVAL '30 minutes', NOW())`,
    [fixturePaymentId, variantId],
  );

  await resolveSuccessfulSandboxAlert(currentResolution);

  // Repeat the same submission: no second history entry should be added.
  await resolveSuccessfulSandboxAlert(currentResolution);

  const { rows: resolvedAlerts } = await pool.query(
    `SELECT status, resolved_at, resolved_by, resolution_note
     FROM payment_reconciliation_alerts
     WHERE id = $1`,
    [alert.id],
  );

  assert.equal(resolvedAlerts[0].status, "resolved");
  assert.ok(resolvedAlerts[0].resolved_at);
  assert.equal(resolvedAlerts[0].resolved_by, admins[0].id);
  assert.equal(resolvedAlerts[0].resolution_note, resolution.note);

  assert.equal(
    (await listPaymentReconciliationAlerts(fixtureOrderId)).length,
    0,
  );

  const { rows: history } = await pool.query(
    `SELECT changed_by, previous_status, new_status, note
     FROM order_status_history
     WHERE order_id = $1`,
    [fixtureOrderId],
  );

  assert.equal(history.length, 1);
  assert.equal(history[0].changed_by, admins[0].id);
  assert.equal(history[0].previous_status, "paid");
  assert.equal(history[0].new_status, "paid");
  assert.ok(history[0].note.includes(resolution.note));

  const { rows: stockAfter } = await pool.query(
    `SELECT quantity, reserved_quantity
     FROM inventory
     WHERE variant_id = $1`,
    [variantId],
  );

  assert.deepEqual(stockAfter, stockBefore);

  console.log("PASS: matching successful payment alert resolved.");
  console.log("PASS: admin identity and resolution note recorded.");
  console.log("PASS: repeated resolution creates no duplicate history.");
  console.log("PASS: physical and reserved inventory unchanged.");
} catch (error) {
  console.error("TEST FAILED:", error.message);
  process.exitCode = 1;
} finally {
  // Remove only records created by this test.
  if (fixtureOrderId) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `DELETE FROM payment_reconciliation_alerts
         WHERE payment_id IN (
           SELECT id FROM payments WHERE order_id = $1
         )`,
        [fixtureOrderId],
      );
      await client.query(
        `DELETE FROM stock_reservations
   WHERE payment_id IN (
     SELECT id FROM payments WHERE order_id = $1
   )`,
        [fixtureOrderId],
      );

      await client.query("DELETE FROM payments WHERE order_id = $1", [
        fixtureOrderId,
      ]);

      await client.query("DELETE FROM orders WHERE id = $1", [fixtureOrderId]);

      await client.query("COMMIT");
      console.log("Disposable test records removed.");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        `Cleanup failed for test order ${fixtureOrderId}:`,
        error.message,
      );
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }

  await pool.end();
}
