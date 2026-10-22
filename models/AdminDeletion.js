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
      throw reject("This record changed. Refresh before removing it.");
    }

    if (kind === "products") {
      await client.query(
        `SELECT id
         FROM product_variants
         WHERE product_id = $1
         ORDER BY id
         FOR UPDATE`,
        [id],
      );

      const { rows: inventory } = await client.query(
        `SELECT i.variant_id, i.reserved_quantity
         FROM inventory i
         JOIN product_variants v ON v.id = i.variant_id
         WHERE v.product_id = $1
         ORDER BY i.variant_id
         FOR UPDATE OF i`,
        [id],
      );

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
           ) AS has_reservations`,
        [id],
      );

      const preserveHistory =
        references[0].has_orders ||
        references[0].has_reservations ||
        inventory.some((item) => Number(item.reserved_quantity) !== 0);

      // Remove these options from customers' current carts.
      // Existing order items remain separate and unchanged.
      await client.query(
        `DELETE FROM cart_items
         WHERE variant_id IN (
           SELECT id FROM product_variants WHERE product_id = $1
         )`,
        [id],
      );

      if (preserveHistory) {
        await client.query(
          `UPDATE products
           SET is_active = FALSE,
               is_featured = FALSE,
               retired_at = COALESCE(retired_at, NOW())
           WHERE id = $1`,
          [id],
        );

        // Do not alter inventory or reservations: an existing
        // payment can still need to consume its reserved stock.
        await client.query("COMMIT");
        return { outcome: "retired" };
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
          "Products still use this entry. Reassign them before deleting it, including retired products.",
        );
      }
    }

    await client.query(
      `DELETE FROM ${definition.table} WHERE id = $1`,
      [id],
    );

    await client.query("COMMIT");
    return { outcome: "deleted" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    if (error.code === "23503") {
      throw reject(
        "A linked record changed during removal. Refresh and try again. Nothing was removed.",
      );
    }

    if (["55P03", "40P01"].includes(error.code)) {
      throw reject(
        "This product is being updated elsewhere. Refresh and try again.",
      );
    }

    throw error;
  } finally {
    client.release();
  }
}