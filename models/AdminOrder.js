import { pool } from "../config/database.js";
import { queueOrderEmail } from "../services/orderEmailService.js";

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
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Use the same order lock as payment creation.
    const { rows: orders } = await client.query(
      `SELECT id
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId],
    );

    if (!orders.length) {
      await client.query("ROLLBACK");
      return null;
    }

    // Run after acquiring the lock so committed payment changes are visible.
    const { rows: blockers } = await client.query(
      `SELECT p.id
       FROM payments p
       WHERE p.order_id = $1
         AND (
           p.status IN ('created', 'pending', 'succeeded')
           OR EXISTS (
             SELECT 1
             FROM stock_reservations r
             WHERE r.payment_id = p.id
               AND r.status = 'active'
           )
         )
       LIMIT 1`,
      [orderId],
    );

    if (blockers.length) {
      const error = new Error(
        "The delivery quote cannot change while a payment or stock reservation is unresolved, or after payment succeeds.",
      );
      error.status = 409;
      error.publicMessage = error.message;
      throw error;
    }

    const { rows } = await client.query(
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
         AND stock_deducted_at IS NULL
         AND shipping_rate_status IN ('quote_required', 'quoted')
       RETURNING id`,
      [deliveryCents, courier, service, adminId, orderId, expectedVersion],
    );

        if (rows[0]) {
      await queueOrderEmail(
        client,
        rows[0].id,
        "delivery_quote_ready",
      );
    }

    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
      const { rows: blockers } = await client.query(
        `SELECT p.id
     FROM payments p
     WHERE p.order_id = $1
       AND (
         p.status IN ('created', 'pending', 'succeeded')
         OR EXISTS (
           SELECT 1
           FROM stock_reservations r
           WHERE r.payment_id = p.id
             AND r.status = 'active'
         )
       )
     LIMIT 1`,
        [orderId],
      );

      if (blockers.length > 0 || order.stock_deducted_at) {
        throw reject(
          "This order has a payment or stock reservation that must be resolved before cancellation, or its stock has already been deducted.",
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
       CASE
         WHEN h.changed_by IS NULL THEN 'System'
         ELSE COALESCE(u.name, 'Unknown administrator')
       END AS admin_name
     FROM order_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.order_id = $1
     ORDER BY h.created_at DESC, h.id DESC`,
    [orderId]
  );

  return rows;
}
