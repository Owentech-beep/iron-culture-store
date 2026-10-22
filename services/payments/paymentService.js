import { pool } from "../../config/database.js";
import { getPayfastConfig } from "../../config/payfast.js";
import { findOrderForUser } from "../../models/Order.js";
import { createPaymentAttempt } from "../../models/Payment.js";
import { buildPayfastCheckout } from "./payfast.js";
import { listPaymentReconciliationAlerts } from "../../models/PaymentReconciliation.js";

export async function getPaymentPageData(orderId, userId) {
  const order = await findOrderForUser(orderId, userId);
  if (!order) return null;

  const reasons = [];
  const reconciliationAlerts = await listPaymentReconciliationAlerts(order.id);

  if (reconciliationAlerts.length > 0) {
    reasons.push(
      "A payment for this order is being reviewed. Please do not pay again. Contact the store with your order number for assistance.",
    );
  }

  let config = null;

  try {
    config = getPayfastConfig();
  } catch {
    reasons.push("Payment configuration is incomplete.");
  }

  if (config) {
    if (!config.checkoutEnabled) {
      reasons.push("Online payments are temporarily unavailable.");
    }

    if (config.mode === "sandbox" && !order.is_demo) {
      reasons.push("Sandbox checkout is restricted to demo orders.");
    }

    if (config.mode === "live" && order.is_demo) {
      reasons.push("Demo orders cannot use live payments.");
    }
  }

  if (order.status !== "pending" || order.payment_status !== "unpaid") {
    reasons.push("This order is not awaiting a new payment.");
  }

  if (
    !["free", "quoted"].includes(order.shipping_rate_status) ||
    order.delivery_cents === null ||
    order.total_cents === null
  ) {
    reasons.push("The delivery charge must be finalised first.");
  }

  if (order.shipping_rate_status === "quoted" && !order.quote_accepted_at) {
    reasons.push("Accept the delivery quote on your order page first.");
  }

  const amount = Number(order.total_cents);

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    reasons.push("This order does not have a valid payable amount.");
  }

  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.provider,
       p.status,
       EXISTS (
         SELECT 1
         FROM stock_reservations r
         WHERE r.payment_id = p.id AND r.status = 'active'
       ) AS has_reservation
     FROM payments p
     WHERE p.order_id = $1
     ORDER BY p.created_at DESC, p.id DESC`,
    [order.id],
  );

  const blockingAttempt = rows.find(
    (payment) =>
      ["created", "pending", "succeeded"].includes(payment.status) ||
      payment.has_reservation,
  );

  if (blockingAttempt) {
    reasons.push(
      "A payment attempt already exists. Refresh this page for its status. Do not start another payment while it is unresolved.",
    );
  }

  return {
    order,
    reasons,
    paymentMode: config?.mode ?? null,
    providerName: config?.mode === "sandbox" ? "PayFast sandbox" : "PayFast",
    canStartPayment: reasons.length === 0,

    // Temporary compatibility with the existing payment template.
    canStartSandbox: config?.mode === "sandbox" && reasons.length === 0,

    paymentAttempt: rows[0] ?? null,
  };
}

export async function startPayment(orderId, userId) {
  const data = await getPaymentPageData(orderId, userId);

  if (!data) {
    const error = new Error("Order not found.");
    error.status = 404;
    throw error;
  }

  if (!data.canStartPayment) {
    const error = new Error(data.reasons.join(" "));
    error.status = 409;
    error.publicMessage = error.message;
    throw error;
  }

  // Rechecks eligibility and stock under database locks.
  const attempt = await createPaymentAttempt(orderId, userId);

  return buildPayfastCheckout(attempt);
}

// Preserve the old endpoint without allowing it to start live payments.
export async function startSandboxPayment(orderId, userId) {
  if (getPayfastConfig().mode !== "sandbox") {
    const error = new Error("Sandbox checkout is unavailable.");
    error.status = 409;
    error.publicMessage = error.message;
    throw error;
  }

  return startPayment(orderId, userId);
}