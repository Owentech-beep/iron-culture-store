import { pool } from "../config/database.js";

export async function listAdminOrders() {
  const { rows } = await pool.query(
    `SELECT
       o.id,
       o.order_number,
       o.status,
       o.payment_status,
       o.shipping_rate_status,
       o.total_cents,
       o.is_demo,
       o.created_at,
       u.name AS customer_name
     FROM orders o
     JOIN users u ON u.id = o.user_id
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT 50`,
  );

  return rows;
}

export async function findAdminOrder(id) {
  const { rows } = await pool.query(
    `SELECT
       o.*,
       u.name AS customer_name,
       u.email AS customer_email
     FROM orders o
     JOIN users u ON u.id = o.user_id
     WHERE o.id = $1`,
    [id],
  );

  if (!rows[0]) return null;

  const items = await pool.query(
    `SELECT *
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [id],
  );

  return {
    ...rows[0],
    items: items.rows,
  };
}

export async function saveDeliveryQuote({
  orderId,
  adminId,
  deliveryCents,
  courier,
  service,
  expectedVersion,
}) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET
       delivery_cents = $1,
       total_cents = subtotal_cents - discount_cents + $1,
       shipping_rate_status = 'quoted',
       courier_name = $2,
       courier_service = $3,
       quoted_at = NOW(),
       quoted_by = $4,
       quote_version = quote_version + 1,
       quote_accepted_at = NULL
     WHERE id = $5
       AND quote_version = $6
       AND status = 'pending'
       AND payment_status = 'unpaid'
       AND shipping_rate_status IN ('quote_required', 'quoted')
     RETURNING id`,
    [deliveryCents, courier, service, adminId, orderId, expectedVersion],
  );

  return rows[0] ?? null;
}

export function availableOrderStatuses(order) {
  if (order.status === "pending" && order.payment_status === "unpaid") {
    return ["cancelled"];
  }

  if (
    order.payment_status !== "paid" ||
    !order.stock_deducted_at ||
    order.is_demo
  ) {
    return [];
  }

  const transitions = {
    paid: ["processing"],
    processing: ["shipped"],
    shipped: ["delivered"],
  };

  return transitions[order.status] ?? [];
}

export async function changeAdminOrderStatus({
  orderId,
  adminId,
  expectedStatus,
  nextStatus,
  note,
  courier,
  trackingNumber,
}) {
  const client = await pool.connect();

  function reject(message) {
    const error = new Error(message);
    error.status = 409;
    error.publicMessage = message;
    return error;
  }

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT *
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId],
    );

    const order = result.rows[0];

    if (!order) {
      throw reject("Order not found.");
    }

    if (order.status !== expectedStatus) {
      throw reject(
        "This order changed after the page loaded. Refresh it before trying again.",
      );
    }

    if (!availableOrderStatuses(order).includes(nextStatus)) {
      throw reject(
        "This status change is not allowed. Check payment, stock and the current order status.",
      );
    }

    if (nextStatus === "cancelled") {
      const activePayment = await client.query(
        `SELECT id
         FROM payments
         WHERE order_id = $1
           AND status IN ('created', 'pending', 'succeeded')
         LIMIT 1`,
        [orderId],
      );

      if (activePayment.rows.length > 0 || order.stock_deducted_at) {
        throw reject(
          "This order has payment or stock activity. It cannot use unpaid-order cancellation.",
        );
      }
    }

    if (
      nextStatus === "shipped" &&
      (!["The Courier Guy", "Aramex"].includes(courier) ||
        !trackingNumber ||
        trackingNumber.length > 120)
    ) {
      throw reject(
        "Choose a courier and enter its actual tracking number before marking the order shipped.",
      );
    }

    await client.query(
      `UPDATE orders
   SET
     status = $1::VARCHAR,

     tracking_courier = CASE
       WHEN $1::VARCHAR = 'shipped' THEN $2
       ELSE tracking_courier
     END,

     tracking_number = CASE
       WHEN $1::VARCHAR = 'shipped' THEN $3
       ELSE tracking_number
     END,

     shipped_at = CASE
       WHEN $1::VARCHAR = 'shipped' THEN NOW()
       ELSE shipped_at
     END,

     delivered_at = CASE
       WHEN $1::VARCHAR = 'delivered' THEN NOW()
       ELSE delivered_at
     END,

     cancelled_at = CASE
       WHEN $1::VARCHAR = 'cancelled' THEN NOW()
       ELSE cancelled_at
     END

   WHERE id = $4`,
      [nextStatus, courier || null, trackingNumber || null, orderId],
    );

    await client.query(
      `INSERT INTO order_status_history (
         order_id,
         previous_status,
         new_status,
         changed_by,
         note
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, order.status, nextStatus, adminId, note],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrderStatusHistory(orderId) {
  const { rows } = await pool.query(
    `SELECT
       h.*,
       u.name AS admin_name
     FROM order_status_history h
     JOIN users u ON u.id = h.changed_by
     WHERE h.order_id = $1
     ORDER BY h.created_at DESC, h.id DESC`,
    [orderId],
  );

  return rows;
}
