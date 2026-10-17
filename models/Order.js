import { pool } from "../config/database.js";

export async function findOrdersForUser(userId) {
  const { rows } = await pool.query(
    `SELECT
       id,
       order_number,
       status,
       payment_status,
       shipping_rate_status,
       subtotal_cents,
       total_cents,
       is_demo,
       created_at
     FROM orders
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    [userId]
  );

  return rows;
}

export async function findOrderForUser(orderId, userId) {
  const { rows } = await pool.query(
    `SELECT *
     FROM orders
     WHERE id = $1 AND user_id = $2`,
    [orderId, userId]
  );

  const order = rows[0];

  if (!order) return null;

  const itemsResult = await pool.query(
    `SELECT *
     FROM order_items
     WHERE order_id = $1
     ORDER BY id`,
    [order.id]
  );

  return {
    ...order,
    items: itemsResult.rows,
  };
}

export async function acceptDeliveryQuote(orderId, userId, quoteVersion) {
  const { rows } = await pool.query(
    `UPDATE orders
     SET quote_accepted_at = COALESCE(quote_accepted_at, NOW())
     WHERE id = $1
       AND user_id = $2
       AND quote_version = $3
       AND shipping_rate_status = 'quoted'
       AND status = 'pending'
       AND payment_status = 'unpaid'
       AND delivery_cents IS NOT NULL
       AND total_cents IS NOT NULL
     RETURNING id`,
    [orderId, userId, quoteVersion]
  );

  return rows[0] ?? null;
}