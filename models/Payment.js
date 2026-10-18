import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";
import { assertNoOpenPaymentReconciliation } from "./PaymentReconciliation.js";
import { clearPurchasedCartItems } from "./Cart.js";

function paymentConflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

export async function createSandboxPaymentAttempt(orderId, userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialise payment creation and admin updates for this order.
    const { rows: orders } = await client.query(
      `SELECT *
       FROM orders
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [orderId, userId],
    );

    const order = orders[0];

    if (!order) {
      throw paymentConflict("This order could not be found.");
    }

    await assertNoOpenPaymentReconciliation(client, orderId);

    if (!order.is_demo) {
      throw paymentConflict(
        "Sandbox payments are currently restricted to demo orders.",
      );
    }

    if (
      order.status !== "pending" ||
      order.payment_status !== "unpaid" ||
      order.stock_deducted_at
    ) {
      throw paymentConflict("This order cannot start a new payment.");
    }

    if (
      !["free", "quoted"].includes(order.shipping_rate_status) ||
      order.delivery_cents === null ||
      order.total_cents === null ||
      (order.shipping_rate_status === "quoted" && !order.quote_accepted_at)
    ) {
      throw paymentConflict(
        "Finalise and accept any delivery quote before payment.",
      );
    }

    const amountCents = Number(order.total_cents);

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw paymentConflict("This order has an invalid payment amount.");
    }

    const { rows: existingPayments } = await client.query(
      `SELECT id
       FROM payments
       WHERE order_id = $1
         AND status IN ('created', 'pending', 'succeeded')
       LIMIT 1`,
      [orderId],
    );

    if (existingPayments.length) {
      throw paymentConflict(
        "This order already has a payment attempt awaiting resolution.",
      );
    }

    // Also block a new attempt if an earlier reservation is unresolved.
    const { rows: existingReservations } = await client.query(
      `SELECT r.id
       FROM stock_reservations r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.order_id = $1 AND r.status = 'active'
       LIMIT 1`,
      [orderId],
    );

    if (existingReservations.length) {
      throw paymentConflict(
        "An earlier stock reservation must be resolved first.",
      );
    }

    // Group repeated variants and lock them in a consistent order.
    const { rows: items } = await client.query(
      `SELECT variant_id, SUM(quantity)::INTEGER AS quantity
       FROM order_items
       WHERE order_id = $1
       GROUP BY variant_id
       ORDER BY variant_id`,
      [orderId],
    );

    if (!items.length) {
      throw paymentConflict("This order has no items.");
    }

    for (const item of items) {
      const { rows: variants } = await client.query(
        `SELECT
           i.quantity,
           i.reserved_quantity,
           v.is_active AS variant_active,
           p.is_active AS product_active
         FROM inventory i
         JOIN product_variants v ON v.id = i.variant_id
         JOIN products p ON p.id = v.product_id
         WHERE i.variant_id = $1
         FOR UPDATE OF i, v, p`,
        [item.variant_id],
      );

      const variant = variants[0];

      if (!variant || !variant.variant_active || !variant.product_active) {
        throw paymentConflict("An item in this order is no longer available.");
      }

      if (variant.quantity - variant.reserved_quantity < item.quantity) {
        throw paymentConflict(
          "There is no longer enough available stock for this order.",
        );
      }
    }

    const paymentReference = randomUUID();

    const { rows: payments } = await client.query(
      `INSERT INTO payments (
         order_id,
         provider,
         idempotency_key,
         amount_cents,
         currency,
         status
       )
       VALUES ($1, 'payfast_sandbox', $2, $3, 'ZAR', 'created')
       RETURNING id`,
      [order.id, paymentReference, amountCents],
    );

    const paymentId = payments[0].id;

    for (const item of items) {
      await client.query(
        `UPDATE inventory
         SET reserved_quantity = reserved_quantity + $1
         WHERE variant_id = $2`,
        [item.quantity, item.variant_id],
      );

      await client.query(
        `INSERT INTO stock_reservations (
           payment_id,
           variant_id,
           quantity,
           expires_at
         )
         VALUES ($1, $2, $3, NOW() + INTERVAL '30 minutes')`,
        [paymentId, item.variant_id, item.quantity],
      );
    }

    await client.query("COMMIT");

    return {
      paymentId,
      orderId: order.id,
      paymentReference,
      amountCents,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function completeSandboxPayment({
  paymentReference,
  providerPaymentId,
  amountCents,
}) {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0 ||
    typeof providerPaymentId !== "string" ||
    !/^\d{1,255}$/.test(providerPaymentId)
  ) {
    throw paymentConflict("Invalid payment confirmation.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Find the order first, then follow the established lock order:
    // order -> payment -> reservations -> inventory.
    const { rows: matches } = await client.query(
      `SELECT order_id
       FROM payments
       WHERE idempotency_key = $1
         AND provider = 'payfast_sandbox'`,
      [paymentReference],
    );

    if (!matches.length) {
      throw paymentConflict("Payment attempt not found.");
    }

    const { rows: orders } = await client.query(
      `SELECT *
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [matches[0].order_id],
    );

    const order = orders[0];

    const { rows: payments } = await client.query(
      `SELECT *
       FROM payments
       WHERE idempotency_key = $1
         AND provider = 'payfast_sandbox'
       FOR UPDATE`,
      [paymentReference],
    );

    const payment = payments[0];

    if (
      !order ||
      !payment ||
      !order.is_demo ||
      payment.currency !== "ZAR" ||
      Number(payment.amount_cents) !== amountCents
    ) {
      throw paymentConflict(
        "Payment confirmation does not match the stored attempt.",
      );
    }

    if (
      payment.provider_payment_id &&
      payment.provider_payment_id !== providerPaymentId
    ) {
      throw paymentConflict(
        "This attempt already has a different provider payment reference.",
      );
    }

    // A repeated notification must not deduct stock again.
    if (payment.status === "succeeded") {
      if (
        payment.provider_payment_id !== providerPaymentId ||
        order.payment_status !== "paid" ||
        !order.stock_deducted_at
      ) {
        throw paymentConflict(
          "Payment records need review before confirmation.",
        );
      }
          await client.query("COMMIT");
        return {
          orderId: order.id,
        alreadyProcessed: true,
      };
    }

    if (
      !["created", "pending"].includes(payment.status) ||
      order.status !== "pending" ||
      order.payment_status !== "unpaid" ||
      order.stock_deducted_at ||
      Number(order.total_cents) !== amountCents ||
      !["free", "quoted"].includes(order.shipping_rate_status) ||
      (order.shipping_rate_status === "quoted" && !order.quote_accepted_at)
    ) {
      throw paymentConflict(
        "This payment needs reconciliation before the order can be updated.",
      );
    }

    const { rows: reservations } = await client.query(
      `SELECT *
       FROM stock_reservations
       WHERE payment_id = $1
       ORDER BY variant_id
       FOR UPDATE`,
      [payment.id],
    );

    const { rows: items } = await client.query(
      `SELECT variant_id, SUM(quantity)::INTEGER AS quantity
       FROM order_items
       WHERE order_id = $1
       GROUP BY variant_id
       ORDER BY variant_id`,
      [order.id],
    );

    if (
      !items.length ||
      reservations.length !== items.length ||
      reservations.some(
        (reservation, index) =>
          reservation.status !== "active" ||
          reservation.variant_id !== items[index].variant_id ||
          reservation.quantity !== items[index].quantity,
      )
    ) {
      throw paymentConflict(
        "Stock reservations do not match this order. Review is required.",
      );
    }

    // An elapsed review deadline does not invalidate a reservation
    // that remains active when a verified payment arrives.
    for (const reservation of reservations) {
      const result = await client.query(
        `UPDATE inventory
         SET
           quantity = quantity - $1,
           reserved_quantity = reserved_quantity - $1
         WHERE variant_id = $2
           AND quantity >= $1
           AND reserved_quantity >= $1
         RETURNING variant_id`,
        [reservation.quantity, reservation.variant_id],
      );

      if (result.rowCount !== 1) {
        throw paymentConflict(
          "Reserved stock could not be consumed. Review is required.",
        );
      }
    }

    await client.query(
      `UPDATE stock_reservations
       SET status = 'consumed', resolved_at = NOW()
       WHERE payment_id = $1 AND status = 'active'`,
      [payment.id],
    );

    await client.query(
      `UPDATE payments
       SET
         status = 'succeeded',
         provider_payment_id = $1,
         updated_at = NOW()
       WHERE id = $2`,
      [providerPaymentId, payment.id],
    );

    await client.query(
      `UPDATE orders
       SET
         status = 'paid',
         payment_status = 'paid',
         stock_deducted_at = NOW()
       WHERE id = $1`,
      [order.id],
    );

    await client.query(
      `INSERT INTO order_status_history (
     order_id,
     previous_status,
     new_status,
     changed_by,
     note
   )
   VALUES ($1, $2, 'paid', NULL, $3)`,
      [
        order.id,
        order.status,
        "PayFast sandbox payment verified. Test stock reservation consumed; no real money collected.",
      ],
    );
    await client.query("COMMIT");
       await clearPurchasedCartItems(client, order.id, order.user_id);
    return {
      orderId: order.id,
      alreadyProcessed: false,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
