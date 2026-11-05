import { pool } from "../config/database.js";
import {
  assertNoOpenPaymentReconciliation,
} from "./PaymentReconciliation.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function liveRecoveryProviders() {
  if (process.env.NODE_ENV !== "production") return [];

  const providers = [];

  if (process.env.PAYFAST_MODE?.trim() === "live") {
    providers.push("payfast_live");
  }

  if (process.env.OZOW_MODE?.trim() === "live") {
    providers.push("ozow_live");
  }

  return providers;
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

export async function listRecoverableLiveAttempts(orderId, db = pool) {
  const providers = liveRecoveryProviders();
  if (!providers.length) return [];

  const { rows } = await db.query(
    `SELECT p.id, p.provider, p.status, p.idempotency_key,
            p.amount_cents, p.created_at, p.provider_request_id
     FROM payments p
     JOIN orders o ON o.id = p.order_id
     WHERE p.order_id = $1
       AND p.provider = ANY($2::text[])
       AND (
         p.status = 'created'
         OR (p.provider = 'ozow_live' AND p.status = 'pending')
       )
       AND p.provider_payment_id IS NULL
       AND p.created_at <= NOW() - INTERVAL '30 minutes'
       AND o.is_demo = FALSE
       AND o.status = 'pending'
       AND o.payment_status = 'unpaid'
       AND o.stock_deducted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM payment_reconciliation_alerts a
         JOIN payments ap ON ap.id = a.payment_id
         WHERE ap.order_id = o.id AND a.status = 'open'
       )
     ORDER BY p.id`,
    [orderId, providers],
  );

  return rows;
}

export async function closeVerifiedUnpaidLiveAttempt(
  {
    orderId,
    paymentId,
    adminId,
    reference,
    confirmChecked,
    note,
    ozowFinalOutcome,
  },
  db = pool,
) {
  const providers = liveRecoveryProviders();

  if (!providers.length) {
    throw conflict("Live payment recovery is unavailable in this environment.");
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
    !UUID.test(reference)
  ) {
    throw conflict(
      "Check the payment provider and enter the exact merchant reference.",
    );
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

    // Same lock order as payment completion.
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
         AND provider = ANY($3::text[])
       FOR UPDATE`,
      [paymentId, orderId, providers],
    );

    const payment = payments[0];

    if (
      !payment ||
      payment.provider_payment_id !== null ||
      String(payment.idempotency_key).toLowerCase() !== reference.toLowerCase()
    ) {
      throw conflict(
        "Payment details changed or the reference does not match.",
      );
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

    // Duplicate submission: nothing more to release or record.
    if (payment.status === "cancelled" && active.length === 0) {
      await client.query("COMMIT");
      return;
    }

    const isOzow = payment.provider === "ozow_live";
    const eligibleStatus =
      payment.status === "created" ||
      (isOzow && payment.status === "pending");

    if (!eligibleStatus || !payment.old_enough) {
      throw conflict(
        "Only eligible live attempts at least 30 minutes old can be closed here.",
      );
    }

    let reviewFinding = "Admin confirmed no successful or pending PayFast transaction.";

    if (isOzow) {
      if (ozowFinalOutcome === "confirmed_terminal_unpaid") {
        reviewFinding =
          "Admin confirmed with Ozow that the request ended unpaid and can no longer collect payment.";
      } else if (ozowFinalOutcome === "confirmed_never_created") {
        if (
          payment.provider_request_id != null ||
          payment.provider_checkout_url != null ||
          payment.status === "pending"
        ) {
          throw conflict(
            "The store has evidence of an Ozow request. Verify its final status with Ozow.",
          );
        }

        reviewFinding =
          "Admin confirmed with Ozow that no payment request was created for this reference.";
      } else {
        throw conflict(
          "Record Ozow's confirmed final unpaid outcome before allowing another payment.",
        );
      }
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

    // The order stays pending and unpaid. Only the attempt is closed.
    await client.query(
      `INSERT INTO order_status_history (
         order_id, previous_status, new_status, changed_by, note
       )
       VALUES ($1, $2, $2, $3, $4)`,
      [
        orderId,
        order.status,
        adminId,
        `Locally closed ${payment.provider} payment ${paymentId}. ` +
          `Reference: ${payment.idempotency_key}. ` +
          `${reviewFinding} ${note.trim()}`,
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