import { pool } from "../config/database.js";

const includeDemo =
  process.env.NODE_ENV !== "production" ||
  process.env.SHOW_DEMO_PRODUCTS === "true";

function cartError(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

export async function getCartCount(userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(ci.quantity), 0)::INTEGER AS count
     FROM carts c
     JOIN cart_items ci ON ci.cart_id = c.id
     WHERE c.user_id = $1`,
    [userId],
  );

  return rows[0].count;
}

export async function getCart(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT
       ci.id,
       ci.quantity,
       v.id AS variant_id,
       v.flavour,
       p.name,
       p.slug,
       p.is_demo,
       COALESCE(i.quantity, 0) AS stock,

       (
         p.is_active
         AND v.is_active
         AND ($2::BOOLEAN OR NOT p.is_demo)
       ) AS available,

       (
         COALESCE(p.sale_price, p.price) * 100
       )::BIGINT AS unit_price_cents

     FROM carts c
     JOIN cart_items ci ON ci.cart_id = c.id
     JOIN product_variants v ON v.id = ci.variant_id
     JOIN products p ON p.id = v.product_id
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE c.user_id = $1
     ORDER BY ci.created_at, ci.id`,
    [userId, includeDemo],
  );

  const items = rows.map((row) => {
    const unitPriceCents = Number(row.unit_price_cents);

    return {
      id: row.id,
      variantId: row.variant_id,
      name: row.name,
      slug: row.slug,
      flavour: row.flavour,
      quantity: row.quantity,
      stock: row.stock,
      available: row.available,
      isDemo: row.is_demo,
      unitPriceCents,
      lineTotalCents: unitPriceCents * row.quantity,
      needsAttention: !row.available || row.quantity > row.stock,
    };
  });

  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalCents: items.reduce((sum, item) => sum + item.lineTotalCents, 0),
    hasUnavailableItems: items.some((item) => item.needsAttention),
  };
}

// Lock one customer's cart while changing its contents.
// This prevents concurrent add requests from losing quantity updates.
async function withLockedCart(userId, action) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO carts (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    const { rows } = await client.query(
      `SELECT id
       FROM carts
       WHERE user_id = $1
       FOR UPDATE`,
      [userId],
    );

    const result = await action(client, rows[0].id);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function checkVariant(client, variantId, quantity) {
  const { rows } = await client.query(
    `SELECT
       COALESCE(i.quantity, 0) AS stock,
       p.is_active AS product_active,
       v.is_active AS variant_active,
       p.is_demo
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE v.id = $1`,
    [variantId],
  );

  const variant = rows[0];

  if (
    !variant ||
    !variant.product_active ||
    !variant.variant_active ||
    (!includeDemo && variant.is_demo)
  ) {
    throw cartError("This product option is no longer available.");
  }

  if (quantity > variant.stock) {
    throw cartError(
      `Only ${variant.stock} units of this option are currently available.`,
    );
  }
}

export async function addCartItem(userId, variantId, quantity) {
  return withLockedCart(userId, async (client, cartId) => {
    const { rows } = await client.query(
      `SELECT quantity
       FROM cart_items
       WHERE cart_id = $1 AND variant_id = $2`,
      [cartId, variantId],
    );

    const nextQuantity = (rows[0]?.quantity ?? 0) + quantity;

    if (nextQuantity > 99) {
      throw cartError("You can add up to 99 units of one option.");
    }

    await checkVariant(client, variantId, nextQuantity);

    await client.query(
      `INSERT INTO cart_items (cart_id, variant_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (cart_id, variant_id)
       DO UPDATE SET quantity = EXCLUDED.quantity`,
      [cartId, variantId, nextQuantity],
    );
  });
}

export async function updateCartItem(userId, itemId, quantity) {
  return withLockedCart(userId, async (client, cartId) => {
    const { rows } = await client.query(
      `SELECT variant_id
       FROM cart_items
       WHERE id = $1 AND cart_id = $2`,
      [itemId, cartId],
    );

    if (!rows[0]) {
      throw cartError("This cart item could not be found.");
    }

    await checkVariant(client, rows[0].variant_id, quantity);

    await client.query(
      `UPDATE cart_items
       SET quantity = $1
       WHERE id = $2 AND cart_id = $3`,
      [quantity, itemId, cartId],
    );
  });
}

export async function removeCartItem(userId, itemId) {
  return withLockedCart(userId, async (client, cartId) => {
    await client.query(
      `DELETE FROM cart_items
       WHERE id = $1 AND cart_id = $2`,
      [itemId, cartId],
    );
  });
}
