import { pool } from "../config/database.js";

export async function getDashboardData() {
  const [
    salesResult,
    orderResult,
    customerResult,
    productResult,
    inventoryResult,
    recentOrdersResult,
    lowStockResult,
  ] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(SUM(total_cents), 0)::TEXT AS sales_cents
       FROM orders
       WHERE payment_status = 'paid'
         AND NOT is_demo`
    ),

    pool.query(
      `SELECT
         COUNT(*)::INTEGER AS total,
         COUNT(*) FILTER (
           WHERE is_demo
         )::INTEGER AS demo,
         COUNT(*) FILTER (
           WHERE status = 'pending'
         )::INTEGER AS pending,
         COUNT(*) FILTER (
           WHERE status = 'pending'
             AND shipping_rate_status = 'quote_required'
         )::INTEGER AS awaiting_quote
       FROM orders`
    ),

    pool.query(
      `SELECT COUNT(*)::INTEGER AS total
       FROM users
       WHERE role = 'customer'`
    ),

    pool.query(
      `SELECT
         COUNT(*)::INTEGER AS total,
         COUNT(*) FILTER (
           WHERE is_active
         )::INTEGER AS active,
         COUNT(*) FILTER (
           WHERE is_demo
         )::INTEGER AS demo
       FROM products`
    ),

    pool.query(
      `SELECT COUNT(*)::INTEGER AS total
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN inventory i ON i.variant_id = v.id
       WHERE p.is_active
         AND v.is_active
         AND COALESCE(i.quantity, 0)
             <= COALESCE(i.low_stock_threshold, 5)`
    ),

    pool.query(
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
       LIMIT 8`
    ),

    pool.query(
      `SELECT
         p.name AS product_name,
         p.is_demo,
         v.sku,
         v.flavour,
         COALESCE(i.quantity, 0) AS quantity,
         COALESCE(i.low_stock_threshold, 5) AS threshold
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN inventory i ON i.variant_id = v.id
       WHERE p.is_active
         AND v.is_active
         AND COALESCE(i.quantity, 0)
             <= COALESCE(i.low_stock_threshold, 5)
       ORDER BY COALESCE(i.quantity, 0), p.name, v.id
       LIMIT 10`
    ),
  ]);

  return {
    salesCents: salesResult.rows[0].sales_cents,
    orders: orderResult.rows[0],
    customers: customerResult.rows[0].total,
    products: productResult.rows[0],
    lowStockCount: inventoryResult.rows[0].total,
    recentOrders: recentOrdersResult.rows,
    lowStockItems: lowStockResult.rows,
  };
}