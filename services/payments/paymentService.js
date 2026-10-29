import { pool } from "../../config/database.js";
import { getPayfastConfig } from "../../config/payfast.js";
import { getOzowConfig } from "../../config/ozow.js";
import { findOrderForUser } from "../../models/Order.js";
import { createPaymentAttempt } from "../../models/Payment.js";
import {
  claimOzowPaymentRequest,
  saveOzowPaymentRequest,
} from "../../models/OzowPaymentRequest.js";
import { buildPayfastCheckout } from "./payfast.js";
import { createOzowPaymentClient } from "./ozowPayment.js";
import { listPaymentReconciliationAlerts } from "../../models/PaymentReconciliation.js";

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

// Public display information only. Never return credentials to templates.
export function getAvailablePaymentMethods(isDemo) {
  const methods = [];

  try {
    const config = getPayfastConfig();
    const isTest = config.mode === "sandbox";

    if (config.checkoutEnabled && isDemo === isTest) {
      methods.push({
        id: "payfast",
        label: isTest ? "PayFast sandbox" : "PayFast",
        mode: config.mode,
      });
    }
  } catch {
    // Invalid PayFast configuration must not disable Ozow.
  }

  try {
    const config = getOzowConfig();

    if (config) {
      const isTest = config.mode === "staging";

      if (isDemo === isTest) {
        methods.push({
          id: "ozow",
          label: isTest ? "Ozow staging" : "Ozow",
          mode: config.mode,
        });
      }
    }
  } catch {
    // Invalid Ozow configuration must not disable PayFast.
  }

  return methods;
}

let cachedOzowConfig = null;
let cachedOzowClient = null;

function getOzowClient(config) {
  const unchanged =
    cachedOzowConfig &&
    [
      "mode",
      "provider",
      "apiOrigin",
      "baseUrl",
      "siteCode",
      "clientId",
      "clientSecret",
    ].every((key) => cachedOzowConfig[key] === config[key]);

  if (!unchanged) {
    cachedOzowClient = createOzowPaymentClient(config);
    cachedOzowConfig = config;
  }

  return cachedOzowClient;
}

export async function getPaymentPageData(orderId, userId) {
  const order = await findOrderForUser(orderId, userId);
  if (!order) return null;

  const reasons = [];
  const paymentMethods = getAvailablePaymentMethods(order.is_demo);
  const reconciliationAlerts = await listPaymentReconciliationAlerts(order.id);

  if (reconciliationAlerts.length > 0) {
    reasons.push(
      "A payment for this order is being reviewed. Please do not pay again. Contact the store with your order number.",
    );
  }

  if (!paymentMethods.length) {
    reasons.push("Online payments are temporarily unavailable for this order.");
  }

  if (
    order.status !== "pending" ||
    order.payment_status !== "unpaid" ||
    order.stock_deducted_at
  ) {
    reasons.push("This order is not awaiting a new payment.");
  }

  if (
    !["free", "flat_rate", "quoted"].includes(order.shipping_rate_status) ||
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
    paymentMethods,
    canStartPayment: reasons.length === 0,
    paymentAttempt: blockingAttempt ?? rows[0] ?? null,

    // Compatibility for any remaining older callers.
    paymentMode: paymentMethods[0]?.mode ?? null,
    providerName: paymentMethods[0]?.label ?? null,
    canStartSandbox:
      reasons.length === 0 &&
      paymentMethods.some(
        (method) => method.id === "payfast" && method.mode === "sandbox",
      ),
  };
}

export async function startPayment(orderId, userId, providerName = "payfast") {
  if (!["payfast", "ozow"].includes(providerName)) {
    throw conflict("Choose an available payment method.");
  }

  const data = await getPaymentPageData(orderId, userId);

  if (!data) {
    const error = new Error("Order not found.");
    error.status = 404;
    throw error;
  }

  if (!data.canStartPayment) {
    throw conflict(data.reasons.join(" "));
  }

  if (!data.paymentMethods.some((method) => method.id === providerName)) {
    throw conflict("The selected payment method is unavailable.");
  }

  let ozowConfig = null;
  let ozowClient = null;

  if (providerName === "ozow") {
    ozowConfig = getOzowConfig();

    if (!ozowConfig) {
      throw conflict("Ozow payments are temporarily unavailable.");
    }

    // Validate the client before creating an attempt or reserving stock.
    ozowClient = getOzowClient(ozowConfig);
  }

  // The database rechecks ownership, eligibility, stock and existing
  // attempts across BOTH providers under transaction locks.
  const attempt = await createPaymentAttempt(orderId, userId, providerName);

  if (providerName === "payfast") {
    return {
      ...buildPayfastCheckout(attempt),
      providerName: "payfast",
    };
  }

  try {
    // Commit a single-use claim before making the provider request.
    const claimed = await claimOzowPaymentRequest({
      paymentId: attempt.paymentId,
      orderId: attempt.orderId,
      userId,
      provider: ozowConfig.provider,
    });

    const result = await ozowClient.createPaymentRequest(claimed);

    // Save the provider response before redirecting the customer.
    await saveOzowPaymentRequest(claimed, result);

    return {
      providerName: "ozow",
      mode: ozowConfig.mode,
      checkoutUrl: result.checkoutUrl,
    };
  } catch (error) {
    console.error("Ozow checkout needs review:", {
      paymentId: attempt.paymentId,
      orderId: attempt.orderId,
      name: error.name,
      code: error.code,
      message: error.message,
      connectionCode: error.cause?.code,
    });
    // Never release stock or submit another provider request automatically:
    // a timeout can occur after Ozow has already created the request.
    throw conflict(
      "Your payment attempt needs review. Check Payment Status before trying again.",
    );
  }
}

export async function startSandboxPayment(orderId, userId) {
  if (getPayfastConfig().mode !== "sandbox") {
    throw conflict("Sandbox checkout is unavailable.");
  }

  return startPayment(orderId, userId, "payfast");
}
