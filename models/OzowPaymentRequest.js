import { pool } from "../config/database.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkoutHosts = {
  ozow_live: "pay.ozow.com",
  ozow_staging: "stagingpay.ozow.com",
};

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

function validId(value) {
  return Number.isInteger(value) && value > 0 && value <= 2147483647;
}

export async function claimOzowPaymentRequest(
  { paymentId, orderId, userId, provider },
  db = pool,
) {
  if (
    !validId(paymentId) ||
    !validId(orderId) ||
    !validId(userId) ||
    !Object.hasOwn(checkoutHosts, provider)
  ) {
    throw conflict("Invalid Ozow payment attempt.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    // Keep the established lock order: order, then payment.
    const { rows: orders } = await client.query(
      `SELECT id, status, payment_status, stock_deducted_at, is_demo
       FROM orders
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [orderId, userId],
    );

    const order = orders[0];

    if (
      !order ||
      order.status !== "pending" ||
      order.payment_status !== "unpaid" ||
      order.stock_deducted_at ||
      order.is_demo !== (provider === "ozow_staging")
    ) {
      throw conflict("This order cannot start an Ozow request.");
    }

    const { rows: alerts } = await client.query(
      `SELECT a.id
       FROM payment_reconciliation_alerts a
       JOIN payments p ON p.id = a.payment_id
       WHERE p.order_id = $1 AND a.status = 'open'
       LIMIT 1`,
      [orderId],
    );

    if (alerts.length) {
      throw conflict("A payment for this order requires review.");
    }

    const { rows: payments } = await client.query(
      `SELECT *
       FROM payments
       WHERE id = $1 AND order_id = $2
       FOR UPDATE`,
      [paymentId, orderId],
    );

    const payment = payments[0];

    if (
      !payment ||
      payment.provider !== provider ||
      payment.status !== "created" ||
      payment.provider_payment_id !== null ||
      payment.provider_request_started_at !== null ||
      payment.provider_request_id !== null ||
      payment.provider_checkout_url !== null
    ) {
      throw conflict(
        "This payment request has already started or requires review.",
      );
    }

    const amountCents = Number(payment.amount_cents);

    if (
      !Number.isSafeInteger(amountCents) ||
      amountCents <= 0 ||
      payment.currency !== "ZAR"
    ) {
      throw conflict("Invalid Ozow payment amount.");
    }

    const { rows: reservations } = await client.query(
      `SELECT
         COUNT(*)::INTEGER AS total,
         BOOL_AND(status = 'active') AS all_active,
         DATE_TRUNC('milliseconds', MIN(expires_at)) AS expires_at,
         MIN(expires_at) > CLOCK_TIMESTAMP() + INTERVAL '1 minute'
           AS enough_time
       FROM stock_reservations
       WHERE payment_id = $1`,
      [paymentId],
    );

    const reservation = reservations[0];

    if (
      reservation.total === 0 ||
      !reservation.all_active ||
      !reservation.enough_time
    ) {
      throw conflict(
        "The stock reservation is unavailable or too close to expiry.",
      );
    }

    const { rows: claimed } = await client.query(
      `UPDATE payments
       SET provider_request_started_at = CLOCK_TIMESTAMP(),
           provider_request_expires_at = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING provider_request_expires_at`,
      [paymentId, reservation.expires_at],
    );

    // Commit the claim BEFORE any network request is made.
    await client.query("COMMIT");

    return {
      paymentId,
      orderId,
      provider,
      paymentReference: payment.idempotency_key,
      amountCents,
      expiresAt:
        claimed[0].provider_request_expires_at.toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function saveOzowPaymentRequest(
  attempt,
  result,
  db = pool,
) {
  if (
    !validId(attempt.paymentId) ||
    !validId(attempt.orderId) ||
    !Object.hasOwn(checkoutHosts, attempt.provider) ||
    typeof attempt.paymentReference !== "string" ||
    !UUID.test(attempt.paymentReference) ||
    typeof result.providerRequestId !== "string" ||
    !UUID.test(result.providerRequestId) ||
    result.expiresAt !== attempt.expiresAt
  ) {
    throw conflict("Invalid Ozow checkout response.");
  }

  let url;

  try {
    if (
      typeof result.checkoutUrl !== "string" ||
      result.checkoutUrl.length > 2048
    ) {
      throw new Error("Invalid URL.");
    }

    url = new URL(result.checkoutUrl);
  } catch {
    throw conflict("Invalid Ozow checkout URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== checkoutHosts[attempt.provider] ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw conflict("Unexpected Ozow checkout destination.");
  }

  const saved = await db.query(
    `UPDATE payments
     SET provider_request_id = $5,
         provider_checkout_url = $6,
         status = CASE
           WHEN status = 'created' THEN 'pending'
           ELSE status
         END,
         updated_at = NOW()
     WHERE id = $1
       AND order_id = $2
       AND provider = $3
       AND idempotency_key = $4
       AND amount_cents = $7
       AND currency = 'ZAR'
       AND provider_request_started_at IS NOT NULL
       AND provider_request_expires_at = $8::TIMESTAMPTZ
       AND status IN ('created', 'pending', 'succeeded')
       AND (
         (provider_request_id IS NULL AND provider_checkout_url IS NULL)
         OR
         (provider_request_id = $5 AND provider_checkout_url = $6)
       )`,
    [
      attempt.paymentId,
      attempt.orderId,
      attempt.provider,
      attempt.paymentReference,
      result.providerRequestId,
      url.href,
      attempt.amountCents,
      attempt.expiresAt,
    ],
  );

  if (saved.rowCount !== 1) {
    throw conflict(
      "The payment changed. Review its status before sending another request.",
    );
  }
}