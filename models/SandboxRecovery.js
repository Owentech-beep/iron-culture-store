import { pool } from "../config/database.js";
import {
  assertNoOpenPaymentReconciliation,
} from "./PaymentReconciliation.js";

export function sandboxRecoveryEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.PAYFAST_MODE?.trim() === "sandbox"
  );
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

export async function listRecoverableSandboxAttempts(orderId) {
  if (!sandboxRecoveryEnabled()) return [];

  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.idempotency_key,
       p.status,
       p.created_at
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.order_id = $1
       AND p.provider = 'payfast_sandbox'
       AND p.status IN ('created', 'pending')
       AND p.provider_payment_id IS NULL
       AND p.created_at <= NOW() - INTERVAL '30 minutes'
       AND o.is_demo
       AND o.status = 'pending'
       AND o.payment_status = 'unpaid'
       AND o.stock_deducted_at IS NULL
     ORDER BY p.id`,
    [orderId]
  );

  return rows;
}

export async function closeAbandonedSandboxAttempt({
  orderId,
  paymentId,
  adminId,
  note,
}) {
  if (!sandboxRecoveryEnabled()) {
    throw conflict("Sandbox recovery is disabled in this environment.");
  }

  if (typeof note !== "string" || note.length < 10 || note.length > 300) {
    throw conflict("Enter a recovery note of 10–300 characters.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: orders } = await client.query(
      `SELECT *
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );

    const order = orders[0];
    await assertNoOpenPaymentReconciliation(client, orderId);

    if (
      !order ||
      !order.is_demo ||
      order.status !== "pending" ||
      order.payment_status !== "unpaid" ||
      order.stock_deducted_at
    ) {
      throw conflict("This order is not eligible for sandbox recovery.");
    }

    const { rows: payments } = await client.query(
      `SELECT *,
         created_at <= NOW() - INTERVAL '30 minutes' AS old_enough
       FROM payments
       WHERE id = $1
         AND order_id = $2
         AND provider = 'payfast_sandbox'
       FOR UPDATE`,
      [paymentId, orderId]
    );

    const payment = payments[0];

    if (!payment || payment.provider_payment_id) {
      throw conflict(
        "This attempt cannot be closed. Check its provider payment records."
      );
    }

    const { rows: reservations } = await client.query(
      `SELECT *
       FROM stock_reservations
       WHERE payment_id = $1
       ORDER BY variant_id
       FOR UPDATE`,
      [paymentId]
    );

    if (reservations.some((row) => row.status === "consumed")) {
      throw conflict("Stock was already consumed for this attempt.");
    }

    const active = reservations.filter((row) => row.status === "active");

    // A repeated submission must not release stock twice.
    if (payment.status === "cancelled" && active.length === 0) {
      await client.query("COMMIT");
      return;
    }

    if (
      !["created", "pending"].includes(payment.status) ||
      !payment.old_enough
    ) {
      throw conflict(
        "Only unresolved sandbox attempts older than 30 minutes can be closed."
      );
    }

    for (const reservation of active) {
      const result = await client.query(
        `UPDATE inventory
         SET reserved_quantity = reserved_quantity - $1
         WHERE variant_id = $2
           AND reserved_quantity >= $1
         RETURNING variant_id`,
        [reservation.quantity, reservation.variant_id]
      );

      if (result.rowCount !== 1) {
        throw conflict(
          "Reserved stock does not match. Recovery was rolled back."
        );
      }
    }

    await client.query(
      `UPDATE stock_reservations
       SET status = 'released', resolved_at = NOW()
       WHERE payment_id = $1 AND status = 'active'`,
      [paymentId]
    );

    await client.query(
      `UPDATE payments
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [paymentId]
    );

    await client.query(
      `INSERT INTO order_status_history (
         order_id,
         previous_status,
         new_status,
         changed_by,
         note
       )
       VALUES ($1, $2, $2, $3, $4)`,
      [
        orderId,
        order.status,
        adminId,
        `Closed abandoned sandbox payment ${paymentId}. ` +
          `Reference: ${payment.idempotency_key}. ${note}`,
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}