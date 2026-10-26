import { pool } from "../config/database.js";
import { listAdminInventory } from "./AdminProduct.js";

export async function getCostInventory(search) {
  const items = await listAdminInventory(search);

  if (!items.length) return [];

  const ids = items.map((item) => item.id);

  const { rows } = await pool.query(
    `SELECT
       i.variant_id,
       i.cost_tracking_started_at,
       opening.id AS opening_id,
       opening.quantity_received AS opening_quantity,
       opening.quantity_remaining AS opening_remaining,
       opening.unit_cost_cents AS opening_unit_cost_cents,

       COALESCE((
         SELECT SUM(b.quantity_remaining::BIGINT * b.unit_cost_cents)
         FROM stock_cost_batches b
         WHERE b.variant_id = i.variant_id
           AND b.unit_cost_cents IS NOT NULL
       ), 0)::TEXT AS known_stock_cost_cents,

       CASE
         WHEN i.cost_tracking_started_at IS NULL THEN i.quantity::BIGINT
         ELSE COALESCE((
           SELECT SUM(b.quantity_remaining)
           FROM stock_cost_batches b
           WHERE b.variant_id = i.variant_id
             AND b.unit_cost_cents IS NULL
         ), 0)
       END::TEXT AS unknown_cost_units

     FROM inventory i
     LEFT JOIN stock_cost_batches opening
       ON opening.variant_id = i.variant_id
      AND opening.entry_type = 'opening_balance'
     WHERE i.variant_id = ANY($1::INTEGER[])`,
    [ids],
  );

  const costsById = new Map(
    rows.map((row) => [Number(row.variant_id), row]),
  );

  return items.map((item) => ({
    ...item,
    ...costsById.get(Number(item.id)),
  }));
}

export async function getRecentStockPurchases() {
  const { rows } = await pool.query(
    `SELECT
       b.id,
       b.quantity_received,
       b.unit_cost_cents,
       (b.quantity_received::BIGINT * b.unit_cost_cents)::TEXT
         AS total_cost_cents,
       TO_CHAR(b.received_on, 'YYYY-MM-DD') AS received_on,
       b.supplier,
       b.invoice_reference,
       b.is_demo,
       p.name AS product_name,
       v.size,
       v.flavour
     FROM stock_cost_batches b
     JOIN product_variants v ON v.id = b.variant_id
     JOIN products p ON p.id = v.product_id
     WHERE b.entry_type = 'purchase'
     ORDER BY b.id DESC
     LIMIT 20`,
  );

  return rows;
}

export async function getStockCostSummary() {
  const { rows } = await pool.query(
    `WITH item_costs AS (
       SELECT
         order_id,
         COUNT(*) AS item_count,
         BOOL_AND(
           cost_recorded_at IS NOT NULL
           AND cost_total_cents IS NOT NULL
         ) AS complete_costs,
         COALESCE(SUM(cost_total_cents), 0) AS known_cost_cents
       FROM order_items
       GROUP BY order_id
     ),
     paid_orders AS (
       SELECT
         o.subtotal_cents::BIGINT - o.discount_cents::BIGINT
           AS product_revenue_cents,

         COALESCE(ic.known_cost_cents, 0) AS known_cost_cents,

         (
           o.stock_deducted_at IS NOT NULL
           AND COALESCE(ic.item_count, 0) > 0
           AND COALESCE(ic.complete_costs, FALSE)
         ) AS complete_costs

       FROM orders o
       LEFT JOIN item_costs ic ON ic.order_id = o.id
       WHERE o.payment_status = 'paid'
         AND NOT o.is_demo
     )
     SELECT
       COALESCE(SUM(product_revenue_cents), 0)::TEXT
         AS product_revenue_cents,

       COALESCE(SUM(known_cost_cents), 0)::TEXT
         AS known_cogs_cents,

       COUNT(*) FILTER (
         WHERE NOT complete_costs
       )::INTEGER AS missing_cost_orders,

       CASE
         WHEN COUNT(*) FILTER (WHERE NOT complete_costs) > 0
           THEN NULL
         ELSE (
           COALESCE(SUM(product_revenue_cents), 0)
           - COALESCE(SUM(known_cost_cents), 0)
         )::TEXT
       END AS gross_profit_cents,

       (
         SELECT COALESCE(
           SUM(quantity_received::BIGINT * unit_cost_cents),
           0
         )::TEXT
         FROM stock_cost_batches
         WHERE entry_type = 'purchase'
           AND NOT is_demo
       ) AS purchases_cents

     FROM paid_orders`,
  );

  return rows[0];
}