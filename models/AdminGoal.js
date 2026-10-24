import { pool } from "../config/database.js";

function goalError(message) {
  const error = new Error(message);
  error.status = 409;
  error.publicMessage = message;
  return error;
}

export async function getAdminGoals() {
  const [goals, products] = await Promise.all([
    pool.query(
      `SELECT
         g.*,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', p.id,
                 'name', p.name,
                 'position', gi.position
               )
               ORDER BY gi.position
             )
             FROM product_goal_items gi
             JOIN products p ON p.id = gi.product_id
             WHERE gi.goal_slug = g.slug
           ),
           '[]'::JSON
         ) AS items
       FROM product_goals g
       ORDER BY g.position, g.slug`,
    ),
    pool.query(
      `SELECT p.id, p.name
       FROM products p
       JOIN catalogue_products cp ON cp.id = p.id
       WHERE p.is_active
         AND p.retired_at IS NULL
         AND NOT p.is_demo
         AND cp.effective_price IS NOT NULL
       ORDER BY p.name, p.id`,
    ),
  ]);

  return {
    goals: goals.rows,
    products: products.rows,
  };
}

export async function saveAdminGoal(slug, productIds, published) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const goal = await client.query(
      `SELECT slug
       FROM product_goals
       WHERE slug = $1
       FOR UPDATE`,
      [slug],
    );

    if (!goal.rowCount) {
      throw goalError("This goal no longer exists.");
    }

    if (productIds.length) {
      const eligible = await client.query(
        `SELECT p.id
         FROM products p
         JOIN catalogue_products cp ON cp.id = p.id
         WHERE p.id = ANY($1::INTEGER[])
           AND p.is_active
           AND p.retired_at IS NULL
           AND NOT p.is_demo
           AND cp.effective_price IS NOT NULL
         ORDER BY p.id
         FOR SHARE OF p`,
        [productIds],
      );

      if (eligible.rowCount !== productIds.length) {
        throw goalError(
          "One of these products is no longer available for selection. Refresh and choose published products.",
        );
      }
    }

    await client.query(
      "DELETE FROM product_goal_items WHERE goal_slug = $1",
      [slug],
    );

    for (const [position, productId] of productIds.entries()) {
      await client.query(
        `INSERT INTO product_goal_items (
           goal_slug, product_id, position
         )
         VALUES ($1, $2, $3)`,
        [slug, productId, position],
      );
    }

    await client.query(
      `UPDATE product_goals
       SET is_active = $2
       WHERE slug = $1`,
      [slug, published],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}