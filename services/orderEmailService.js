import { enqueueOrderEmail } from "../models/EmailOutbox.js";

function formatMoney(cents) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(Number(cents) / 100);
}

export async function queueOrderEmail(client, orderId, eventType) {
   const supportedEvents = [
    "order_received",
    "payment_confirmed",
    "delivery_quote_ready",
    "order_shipped",
  ];

  if (!supportedEvents.includes(eventType)) {
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
       is_demo,
       status,
       shipping_rate_status,
       quote_version,
       courier_name,
       courier_service,
       tracking_courier,
       tracking_number,
       shipped_at
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
  } else if (eventType === "delivery_quote_ready") {
    if (
      order.status !== "pending" ||
      order.payment_status !== "unpaid" ||
      order.shipping_rate_status !== "quoted" ||
      !Number.isInteger(order.quote_version) ||
      order.quote_version <= 0 ||
      order.delivery_cents === null ||
      order.total_cents === null
    ) {
      throw new Error(
        "Delivery quote email requires a finalised quote on an unpaid pending order.",
      );
    }

    subject = `${prefix}Delivery quote ready — ${order.order_number}`;

    lines = [
      "Your delivery quote is ready to review.",
      "",
      `Order: ${order.order_number}`,
      `Quote version: ${order.quote_version}`,
      `Courier: ${order.courier_name}`,
      `Service: ${order.courier_service}`,
      `Delivery charge: ${formatMoney(order.delivery_cents)}`,
      `Order total including delivery: ${formatMoney(order.total_cents)}`,
      "",
      "Sign in to your account, open My Orders, and select this order.",
      "Review the latest delivery charge and total before accepting.",
      "Accepting a quote does not itself collect payment or reserve stock.",
      "",
      "This email records the quote above. If it is revised, your order page will show the latest version.",
    ];
    } else if (eventType === "order_shipped") {
    if (
      order.is_demo ||
      order.status !== "shipped" ||
      order.payment_status !== "paid" ||
      !order.stock_deducted_at ||
      !order.shipped_at ||
      typeof order.tracking_courier !== "string" ||
      !order.tracking_courier.trim() ||
      typeof order.tracking_number !== "string" ||
      !order.tracking_number.trim()
    ) {
      throw new Error(
        "Dispatch email requires a shipped, paid, non-demo order with tracking details.",
      );
    }

    subject = `Order dispatched — ${order.order_number}`;

    lines = [
      "Your Iron Culture Supplements order has been dispatched.",
      "",
      `Order: ${order.order_number}`,
      `Courier: ${order.tracking_courier}`,
      `Tracking number: ${order.tracking_number}`,
      "",
      "Use this tracking number on the courier's official tracking service.",
      "Tracking updates may take time to appear.",
      "Sign in to your account and open My Orders to view your order details.",
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
    eventVersion:
      eventType === "delivery_quote_ready" ? order.quote_version : 0,
    recipient,
    subject,
    textBody: lines.join("\n"),
    isDemo: order.is_demo,
  });
}