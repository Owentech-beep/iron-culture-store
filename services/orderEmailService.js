import { enqueueOrderEmail } from "../models/EmailOutbox.js";

function formatMoney(cents) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(cents) / 100);
}

// Uses the caller's transaction so the email and order changes
// are committed or rolled back together.
export async function queueOrderEmail(client, orderId, eventType) {
  if (!["order_received", "payment_confirmed"].includes(eventType)) {
    throw new Error("Unsupported order email event.");
  }

  const { rows } = await client.query(
    `SELECT
       id,
       order_number,
       shipping_address,
       payment_status,
       stock_deducted_at,
       subtotal_cents,
       delivery_cents,
       total_cents,
       is_demo
     FROM orders
     WHERE id = $1`,
    [orderId],
  );

  const order = rows[0];

  if (!order) {
    throw new Error("Cannot queue an email for an unknown order.");
  }

  const recipient = order.shipping_address?.email;
  const prefix = order.is_demo ? "[SANDBOX TEST] " : "";

  let subject;
  let lines;

  if (eventType === "order_received") {
    subject = `${prefix}Order received — ${order.order_number}`;

    lines = [
      "Thank you for your order with Iron Culture Supplements.",
      "",
      `Order: ${order.order_number}`,
      `Subtotal: ${formatMoney(order.subtotal_cents)}`,
      order.total_cents === null
        ? "Final total: awaiting a delivery quote."
        : `Order total: ${formatMoney(order.total_cents)}`,
      "",
      "Your order has been received. This is not a payment receipt.",
      "Submitting this order does not reserve stock.",
      "Sign in to your account and open My Orders to view its latest status.",
    ];
  } else {
    if (
      order.payment_status !== "paid" ||
      !order.stock_deducted_at ||
      order.total_cents === null
    ) {
      throw new Error(
        "Payment confirmation email requires paid status and stock evidence.",
      );
    }

    subject = `${prefix}Payment confirmed — ${order.order_number}`;

    lines = [
      order.is_demo
        ? "Your PayFast sandbox payment was confirmed."
        : "Your payment was confirmed.",
      "",
      `Order: ${order.order_number}`,
      `${order.is_demo ? "Test amount" : "Amount"}: ${formatMoney(
        order.total_cents,
      )}`,
      "",
      "Sign in to your account and open My Orders to view its latest status.",
    ];
  }

  if (order.is_demo) {
    lines.unshift(
      "SANDBOX TEST — no real money was collected and no goods will be dispatched.",
      "",
    );
  }

  lines.push("", "Iron Culture Supplements");

  return enqueueOrderEmail(client, {
    orderId: order.id,
    eventType,
    recipient,
    subject,
    textBody: lines.join("\n"),
    isDemo: order.is_demo,
  });
}