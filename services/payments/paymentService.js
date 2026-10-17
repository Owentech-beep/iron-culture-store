import { findOrderForUser } from "../../models/Order.js";
import { getPaymentProvider } from "./provider.js";

export async function getPaymentPageData(orderId, userId) {
  const order = await findOrderForUser(orderId, userId);

  if (!order) return null;

  const provider = getPaymentProvider();
  const reasons = [];

  if (order.is_demo) {
    reasons.push(
      "This is a demo order. It cannot be paid through a live gateway.",
    );
  }

  if (order.status !== "pending") {
    reasons.push("This order is not awaiting a new payment.");
  }

  if (order.payment_status !== "unpaid") {
    reasons.push("This order's payment status does not allow a new payment.");
  }

  if (
    order.shipping_rate_status === "quote_required" ||
    order.delivery_cents === null ||
    order.total_cents === null
  ) {
    reasons.push("The delivery charge must be finalised before payment.");
  }

  if (order.shipping_rate_status === "quoted" && !order.quote_accepted_at) {
    reasons.push(
      "Accept the delivery quote on your order page before proceeding to payment.",
    );
  }

  if (
    order.total_cents !== null &&
    (!Number.isSafeInteger(Number(order.total_cents)) ||
      Number(order.total_cents) <= 0)
  ) {
    reasons.push("This order does not have a valid payable amount.");
  }

  if (!provider.configured) {
    reasons.push("Online payment has not been activated yet.");
  }

  return {
    order,
    reasons,
    providerName: provider.name,
  };
}
