import { pool } from "../config/database.js";
import {
  assertNoOpenPaymentReconciliation,
} from "./PaymentReconciliation.js";

function enabled() {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.PAYFAST_MODE?.trim() === "live"
  );
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

export async function listRecoverableLiveAttempts(orderId) {
  if (!enabled()) return [];

  const { rows } = await pool.query(
    `SELECT p.id, p.idempotency_key, p.amount_cents, p.created_at
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.order_id = $1
       AND p.provider = 'payfast_live'
       AND p.status = 'created'
       AND p.provider_payment_id IS NULL
       AND p.created_at <= NOW() - INTERVAL '30 minutes'
       AND o.is_demo = FALSE
       AND o.status = 'pending'
       AND o.payment_status = 'unpaid'
       AND o.stock_deducted_at IS NULL
     ORDER BY p.id`,
    [orderId],
  );

  return rows;
}

export async function closeVerifiedUnpaidLiveAttempt({
  orderId,
  paymentId,
  adminId,
  reference,
  confirmChecked,
  note,
}, db = pool) {
  if (!enabled()) {
    throw conflict("Live recovery requires production and live PayFast mode.");
  }

  if (
    ![orderId, paymentId, adminId].every(
      (id) => Number.isSafeInteger(id) && id > 0 && id <= 2147483647,
    )
  ) {
    throw conflict("Invalid order, payment or administrator.");
  }

  if (
    confirmChecked !== true ||
    typeof reference !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      reference,
    )
  ) {
    throw conflict("Check PayFast and enter the exact payment reference.");
  }

  if (
    typeof note !== "string" ||
    note.trim().length < 10 ||
    note.trim().length > 300
  ) {
    throw conflict("Enter review findings of 10–300 characters.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    const admin = await client.query(
      `SELECT id FROM users
       WHERE id = $1 AND is_active = TRUE AND role = 'admin'`,
      [adminId],
    );

    if (admin.rows.length !== 1) {
      throw conflict("An active administrator is required.");
    }

    // Match payment processing lock order:
    // order -> payment -> reservations -> inventory.
    const { rows: orders } = await client.query(
      "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
      [orderId],
    );

    const order = orders[0];

    if (
      !order ||
      order.is_demo !== false ||
      order.status !== "pending" ||
      order.payment_status !== "unpaid" ||
      order.stock_deducted_at
    ) {
      throw conflict("This order is not eligible for live recovery.");
    }

    await assertNoOpenPaymentReconciliation(client, orderId);

    const { rows: payments } = await client.query(
      `SELECT *,
         created_at <= NOW() - INTERVAL '30 minutes' AS old_enough
       FROM payments
       WHERE id = $1
         AND order_id = $2
         AND provider = 'payfast_live'
       FOR UPDATE`,
      [paymentId, orderId],
    );

    const payment = payments[0];

    if (
      !payment ||
      payment.provider_payment_id !== null ||
      String(payment.idempotency_key).toLowerCase() !== reference.toLowerCase()
    ) {
      throw conflict("Payment details changed or the reference does not match.");
    }

    const { rows: reservations } = await client.query(
      `SELECT *
       FROM stock_reservations
       WHERE payment_id = $1
       ORDER BY variant_id, id
       FOR UPDATE`,
      [paymentId],
    );

    if (reservations.some((row) => row.status === "consumed")) {
      throw conflict("This attempt has consumed stock and cannot be closed.");
    }

    const active = reservations.filter((row) => row.status === "active");

    // A repeated submission must not release stock or add history twice.
    if (payment.status === "cancelled" && active.length === 0) {
      await client.query("COMMIT");
      return;
    }

    if (payment.status !== "created" || !payment.old_enough) {
      throw conflict(
        "Only created live attempts older than 30 minutes can be closed here.",
      );
    }

    for (const reservation of active) {
      if (
        !Number.isSafeInteger(reservation.quantity) ||
        reservation.quantity <= 0
      ) {
        throw conflict("Invalid reservation quantity. Nothing was changed.");
      }

      const result = await client.query(
        `UPDATE inventory
         SET reserved_quantity = reserved_quantity - $1
         WHERE variant_id = $2
           AND reserved_quantity >= $1
         RETURNING variant_id`,
        [reservation.quantity, reservation.variant_id],
      );

      if (result.rowCount !== 1) {
        throw conflict("Reserved stock does not match. Nothing was changed.");
      }
    }

    await client.query(
      `UPDATE stock_reservations
       SET status = 'released', resolved_at = NOW()
       WHERE payment_id = $1 AND status = 'active'`,
      [paymentId],
    );

    await client.query(
      `UPDATE payments
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [paymentId],
    );

    await client.query(
      `INSERT INTO order_status_history (
         order_id, previous_status, new_status, changed_by, note
       )
       VALUES ($1, $2, $2, $3, $4)`,
      [
        orderId,
        order.status,
        adminId,
        `Locally closed live payment ${paymentId}. ` +
          `Reference: ${payment.idempotency_key}. ` +
          `Admin confirmed no successful or pending PayFast transaction. ` +
          note.trim(),
      ],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    if (["55P03", "40P01"].includes(error.code)) {
      throw conflict("Payment records are being updated. Refresh and try again.");
    }

    throw error;
  } finally {
    client.release();
  }
}