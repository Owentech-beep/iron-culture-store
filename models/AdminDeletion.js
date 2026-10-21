import { pool } from "../config/database.js";

const definitions = {
  products: { table: "products" },
  brands: { table: "brands", productColumn: "brand_id" },
  categories: { table: "categories", productColumn: "category_id" },
};

function reject(message, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.publicMessage = message;
  return error;
}

export async function deleteAdminEntry(kind, id, expectedSlug) {
  if (!Object.hasOwn(definitions, kind)) {
    throw reject("Unknown catalogue section.", 404);
  }

  const definition = definitions[kind];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");

    // Table names come exclusively from the fixed definitions above.
    const { rows } = await client.query(
      `SELECT *
       FROM ${definition.table}
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    const entry = rows[0];

    if (!entry) {
      throw reject("This record no longer exists.", 404);
    }

    if (entry.slug !== expectedSlug) {
      throw reject(
        "This record changed. Refresh the page before deleting it.",
      );
    }

    if (kind === "products") {
      if (entry.is_active) {
        throw reject("Archive this product before permanently deleting it.");
      }

      // Lock variants so new foreign-key references cannot be added
      // between the reference checks and deletion.
      await client.query(
        `SELECT id
         FROM product_variants
         WHERE product_id = $1
         ORDER BY id
         FOR UPDATE`,
        [id],
      );

      const { rows: inventory } = await client.query(
        `SELECT i.variant_id, i.quantity, i.reserved_quantity
         FROM inventory i
         JOIN product_variants v ON v.id = i.variant_id
         WHERE v.product_id = $1
         ORDER BY i.variant_id
         FOR UPDATE OF i`,
        [id],
      );

      if (
        inventory.some(
          (item) =>
            Number(item.quantity) !== 0 ||
            Number(item.reserved_quantity) !== 0,
        )
      ) {
        throw reject(
          "This product still has physical or reserved stock. Keep it archived until its inventory is resolved.",
        );
      }

      const { rows: references } = await client.query(
        `SELECT
           EXISTS (
             SELECT 1
             FROM order_items oi
             JOIN product_variants v ON v.id = oi.variant_id
             WHERE v.product_id = $1
           ) AS has_orders,

           EXISTS (
             SELECT 1
             FROM stock_reservations r
             JOIN product_variants v ON v.id = r.variant_id
             WHERE v.product_id = $1
           ) AS has_reservations,

           EXISTS (
             SELECT 1
             FROM cart_items ci
             JOIN product_variants v ON v.id = ci.variant_id
             WHERE v.product_id = $1
           ) AS has_carts`,
        [id],
      );

      const reference = references[0];

      if (reference.has_orders || reference.has_reservations) {
        throw reject(
          "This product has order or reservation history. Keep it archived to preserve those records.",
        );
      }

      if (reference.has_carts) {
        throw reject(
          "This product is still referenced by a shopping cart. Keep it archived for now.",
        );
      }

      await client.query(
        "DELETE FROM product_images WHERE product_id = $1",
        [id],
      );

      await client.query(
        "DELETE FROM product_nutrition WHERE product_id = $1",
        [id],
      );

      await client.query(
        `DELETE FROM inventory
         WHERE variant_id IN (
           SELECT id FROM product_variants WHERE product_id = $1
         )`,
        [id],
      );

      await client.query(
        "DELETE FROM product_variants WHERE product_id = $1",
        [id],
      );
    } else {
      const { rows: products } = await client.query(
        `SELECT id
         FROM products
         WHERE ${definition.productColumn} = $1
         LIMIT 1`,
        [id],
      );

      if (products.length > 0) {
        throw reject(
          "Products still use this entry, including archived products. Reassign them before deleting it.",
        );
      }
    }

    await client.query(
      `DELETE FROM ${definition.table} WHERE id = $1`,
      [id],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    if (error.code === "23503") {
      throw reject(
        "Another record depends on this entry. Nothing was deleted.",
      );
    }

    if (["55P03", "40P01"].includes(error.code)) {
      throw reject(
        "This entry is being updated elsewhere. Refresh and try again.",
      );
    }

    throw error;
  } finally {
    client.release();
  }
}