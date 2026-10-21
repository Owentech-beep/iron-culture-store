import { randomUUID } from "node:crypto";
import { pool } from "../config/database.js";

export async function listAdminProducts(search, requestedPage) {
  const parameters = [`%${search}%`];

  const countResult = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM products
     WHERE name ILIKE $1 OR slug ILIKE $1`,
    parameters,
  );

  const total = countResult.rows[0].total;
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);

  const result = await pool.query(
    `SELECT *
     FROM catalogue_products
     WHERE name ILIKE $1 OR slug ILIKE $1
     ORDER BY id DESC
     LIMIT $2 OFFSET $3`,
    [...parameters, pageSize, (page - 1) * pageSize],
  );

  return {
    products: result.rows,
    total,
    page,
    totalPages,
  };
}

export async function getProductOptions() {
  const [categories, brands] = await Promise.all([
    pool.query("SELECT id, name FROM categories ORDER BY name"),
    pool.query("SELECT id, name FROM brands ORDER BY name"),
  ]);

  return {
    categories: categories.rows,
    brands: brands.rows,
  };
}

export async function getAdminProduct(id) {
  const result = await pool.query(
    `SELECT p.*,
       (
         SELECT image_url
         FROM product_images
         WHERE product_id = p.id AND position = 0
       ) AS image_url
     FROM products p
     WHERE p.id = $1`,
    [id],
  );

  if (!result.rows[0]) return null;

  const variants = await pool.query(
    `SELECT
       v.id,
       v.flavour,
       v.size,
       v.price,
       v.sale_price,
       v.sku,
       v.is_active,
       COALESCE(i.quantity, 0) AS quantity
     FROM product_variants v
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE v.product_id = $1
     ORDER BY v.id`,
    [id],
  );

  return {
    ...result.rows[0],
    variants: variants.rows,
  };
}

export async function saveAdminProduct(id, data) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const values = [
      data.name,
      data.slug,
      data.category_id,
      data.brand_id,
      data.price,
      data.sale_price || null,
      data.short_description,
      data.description,
      data.ingredients,
      data.allergens,
      data.is_active,
      data.is_featured,
      data.is_demo,
    ];

    let productId;

    if (id) {
      const result = await client.query(
        `UPDATE products SET
           name = $1,
           slug = $2,
           category_id = $3,
           brand_id = $4,
           price = $5,
           sale_price = $6,
           short_description = $7,
           description = $8,
           ingredients = $9,
           allergens = $10,
           is_active = $11,
           is_featured = $12,
           is_demo = $13
         WHERE id = $14
         RETURNING id`,
        [...values, id],
      );

      if (!result.rows[0]) {
        const error = new Error("Product not found.");
        error.status = 404;
        throw error;
      }

      productId = result.rows[0].id;
    } else {
      const result = await client.query(
        `INSERT INTO products (
           name, slug, category_id, brand_id,
           price, sale_price, short_description,
           description, ingredients, allergens,
           is_active, is_featured, is_demo
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11, $12, $13
         )
         RETURNING id`,
        values,
      );

      productId = result.rows[0].id;
    }

    if (data.image_url) {
      await client.query(
        `INSERT INTO product_images (product_id, image_url, position)
         VALUES ($1, $2, 0)
         ON CONFLICT (product_id, position)
         DO UPDATE SET image_url = EXCLUDED.image_url`,
        [productId, data.image_url],
      );
    } else {
      await client.query(
        `DELETE FROM product_images
         WHERE product_id = $1 AND position = 0`,
        [productId],
      );
    }

    await client.query("COMMIT");
    return productId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveAdminProduct(id) {
  await pool.query("UPDATE products SET is_active = FALSE WHERE id = $1", [id]);
}

export async function addAdminVariant(
  productId,
  { size, flavour, price, salePrice },
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO product_variants (
         product_id,
         sku,
         size,
         flavour,
         price,
         sale_price
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        productId,
        `IC-${randomUUID().toUpperCase()}`,
        size,
        flavour,
        price,
        salePrice || null,
      ],
    );

    await client.query(
      `INSERT INTO inventory (variant_id, quantity)
       VALUES ($1, 0)`,
      [result.rows[0].id],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listAdminInventory(search) {
  const { rows } = await pool.query(
    `SELECT
       v.id,
       v.flavour,
       v.size,
       v.price,
       v.sale_price,
       v.sku,
       p.id AS product_id,
       p.name AS product_name,
       p.is_active AS product_active,
       p.is_demo,
      i.quantity,
      i.reserved_quantity,
      (i.quantity - i.reserved_quantity) AS available_quantity,
      i.low_stock_threshold
     FROM product_variants v
     JOIN products p ON p.id = v.product_id
     JOIN inventory i ON i.variant_id = v.id
     WHERE p.name ILIKE $1 OR v.sku ILIKE $1
     ORDER BY p.name, v.id
     LIMIT 100`,
    [`%${search}%`],
  );

  return rows;
}

export async function updateAdminStock(
  variantId,
  quantity,
  previousQuantity,
  threshold,
) {
  const result = await pool.query(
    `UPDATE inventory
     SET quantity = $1, low_stock_threshold = $2
     WHERE variant_id = $3
       AND quantity = $4
       AND reserved_quantity <= $1
     RETURNING variant_id`,
    [quantity, threshold, variantId, previousQuantity],
  );

  return result.rowCount === 1;
}
