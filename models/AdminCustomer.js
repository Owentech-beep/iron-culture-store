import { pool } from "../config/database.js";

export async function listCustomers(search, requestedPage) {
  const searchValue = `%${search}%`;

  const countResult = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM users
     WHERE role = 'customer'
       AND (name ILIKE $1 OR email ILIKE $1)`,
    [searchValue]
  );

  const total = countResult.rows[0].total;
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);

  const result = await pool.query(
    `SELECT id, name, email, is_active, created_at
     FROM users
     WHERE role = 'customer'
       AND (name ILIKE $1 OR email ILIKE $1)
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [searchValue, pageSize, (page - 1) * pageSize]
  );

  return {
    customers: result.rows,
    total,
    page,
    totalPages,
  };
}

export async function findCustomer(id) {
  const result = await pool.query(
    `SELECT id, name, email, is_active, created_at
     FROM users
     WHERE id = $1 AND role = 'customer'`,
    [id]
  );

  if (!result.rows[0]) return null;

  const orders = await pool.query(
    `SELECT
       id,
       order_number,
       status,
       payment_status,
       total_cents,
       is_demo,
       created_at
     FROM orders
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 50`,
    [id]
  );

  return {
    ...result.rows[0],
    orders: orders.rows,
  };
}