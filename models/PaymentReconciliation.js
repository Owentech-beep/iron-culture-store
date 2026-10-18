import { pool } from "../config/database.js";

export async function recordSandboxReconciliation({
  paymentReference,
  providerPaymentId,
  amountCents,
  paymentStatus = "COMPLETE",
}) {
  if (
    typeof paymentStatus !== "string" ||
    !/^[A-Z_]{1,30}$/.test(paymentStatus)
  ) {
    throw new Error("Unexpected provider payment status.");
  }

  const reason =
    paymentStatus === "COMPLETE"
      ? "Verified PayFast sandbox COMPLETE notification could not be applied safely. Check payment, order and stock records."
      : `Verified PayFast sandbox ${paymentStatus} notification requires review. Stock has not been released automatically.`;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: payments } = await client.query(
      `SELECT id, order_id
       FROM payments
       WHERE idempotency_key = $1
         AND provider = 'payfast_sandbox'`,
      [paymentReference],
    );

    const payment = payments[0];

    if (!payment) {
      throw new Error(
        "Cannot attach reconciliation alert to an unknown payment.",
      );
    }

    await client.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [
      payment.order_id,
    ]);

    await client.query(
      `INSERT INTO payment_reconciliation_alerts (
         payment_id,
         provider_payment_id,
         amount_cents,
         provider_status,
         reason
       )
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (payment_id, provider_payment_id)
      DO UPDATE SET
        status = 'open',
          resolved_at = NULL,
          resolved_by = NULL,
          resolution_note = NULL,
         provider_status = EXCLUDED.provider_status,
         amount_cents = EXCLUDED.amount_cents,
         reason = EXCLUDED.reason,
         last_seen_at = NOW(),
         occurrence_count =
           payment_reconciliation_alerts.occurrence_count + 1`,
      [payment.id, providerPaymentId, amountCents, paymentStatus, reason],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function assertNoOpenPaymentReconciliation(client, orderId) {
  const { rows } = await client.query(
    `SELECT a.id
     FROM payment_reconciliation_alerts a
     JOIN payments p ON p.id = a.payment_id
     WHERE p.order_id = $1 AND a.status = 'open'
     LIMIT 1`,
    [orderId],
  );

  if (rows.length) {
    const error = new Error(
      "This order has a payment reconciliation alert. Review it before starting another payment or releasing stock.",
    );

    error.status = 409;
    error.publicMessage = error.message;
    throw error;
  }
}

export async function listPaymentReconciliationAlerts(orderId) {
  const { rows } = await pool.query(
    `SELECT
       a.*,
       p.idempotency_key AS payment_reference
     FROM payment_reconciliation_alerts a
     JOIN payments p ON p.id = a.payment_id
     WHERE p.order_id = $1 AND a.status = 'open'
     ORDER BY a.first_seen_at DESC, a.id DESC`,
    [orderId],
  );

  return rows;
}

export async function resolveSuccessfulSandboxAlert({
  orderId,
  alertId,
  adminId,
  expectedOccurrenceCount,
  note,
}) {
  function reject(message) {
    const error = new Error(message);
    error.status = 409;
    error.publicMessage = message;
    return error;
  }

  if (
    process.env.NODE_ENV !== "development" ||
    process.env.PAYFAST_MODE?.trim() !== "sandbox"
  ) {
    throw reject("This resolution action is available only in local sandbox.");
  }

  if (
    typeof note !== "string" ||
    note.trim().length < 10 ||
    note.trim().length > 300 ||
    !Number.isSafeInteger(expectedOccurrenceCount) ||
    expectedOccurrenceCount < 1
  ) {
    throw reject("Enter a valid resolution note and refresh the alert.");
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

    if (!order || !order.is_demo) {
      throw reject("A demo order is required.");
    }

    const { rows: payments } = await client.query(
      `SELECT p.*
       FROM payments p
       JOIN payment_reconciliation_alerts a ON a.payment_id = p.id
       WHERE a.id = $1 AND p.order_id = $2
       FOR UPDATE OF p`,
      [alertId, orderId]
    );

    const payment = payments[0];

    if (!payment || payment.provider !== "payfast_sandbox") {
      throw reject("Sandbox payment alert not found.");
    }

    const { rows: alerts } = await client.query(
      `SELECT *
       FROM payment_reconciliation_alerts
       WHERE id = $1
       FOR UPDATE`,
      [alertId]
    );

    const alert = alerts[0];

    if (alert.occurrence_count !== expectedOccurrenceCount) {
      throw reject(
        "Another notification arrived after this page loaded. Refresh and review it."
      );
    }

    if (alert.status === "resolved") {
      await client.query("COMMIT");
      return;
    }

    if (
      alert.provider_status !== "COMPLETE" ||
      payment.status !== "succeeded" ||
      payment.currency !== "ZAR" ||
      payment.provider_payment_id !== alert.provider_payment_id ||
      String(payment.amount_cents) !== String(alert.amount_cents) ||
      String(order.total_cents) !== String(payment.amount_cents) ||
      order.payment_status !== "paid" ||
      !["paid", "processing", "shipped", "delivered"].includes(order.status) ||
      !order.stock_deducted_at
    ) {
      throw reject(
        "The alert does not match a successfully paid order. Separate reconciliation is required."
      );
    }

    const { rows: reservations } = await client.query(
      `SELECT variant_id, quantity, status, resolved_at
       FROM stock_reservations
       WHERE payment_id = $1
       ORDER BY variant_id
       FOR UPDATE`,
      [payment.id]
    );

    const { rows: items } = await client.query(
      `SELECT variant_id, SUM(quantity)::INTEGER AS quantity
       FROM order_items
       WHERE order_id = $1
       GROUP BY variant_id
       ORDER BY variant_id`,
      [orderId]
    );

    if (
      !items.length ||
      reservations.length !== items.length ||
      reservations.some(
        (reservation, index) =>
          reservation.variant_id !== items[index].variant_id ||
          reservation.quantity !== items[index].quantity ||
          reservation.status !== "consumed" ||
          !reservation.resolved_at
      )
    ) {
      throw reject(
        "Consumed reservations do not match the order. Review stock records."
      );
    }

    await client.query(
      `UPDATE payment_reconciliation_alerts
       SET
         status = 'resolved',
         resolved_at = NOW(),
         resolved_by = $1,
         resolution_note = $2
       WHERE id = $3`,
      [adminId, note.trim(), alertId]
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
        `Resolved sandbox alert ${alertId} for payment ${payment.id} ` +
          `(notification count ${alert.occurrence_count}). ${note.trim()}`,
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
