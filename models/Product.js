import { pool } from "../config/database.js";

// Demo records are hidden when NODE_ENV=production.
const includeDemo =
  process.env.NODE_ENV !== "production" ||
  process.env.SHOW_DEMO_PRODUCTS === "true";

function mapProduct(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,

    categorySlug: row.category_slug,
    categoryName: row.category_name,
    brandSlug: row.brand_slug,
    brandName: row.brand_name,

    price: row.display_price == null ? null : Number(row.display_price),
    salePrice:
      row.display_sale_price == null ? null : Number(row.display_sale_price),
    hasMultipleVariants: Number(row.variant_count) > 1,

    stock: Number(row.stock),
    imageUrl: row.image_url,
    shortDescription: row.short_description,
    description: row.description,
    ingredients: row.ingredients,
    allergens: row.allergens,
    servingSize: row.serving_size,
    nutritionBasis: row.nutrition_basis,

    isDemo: row.is_demo,
    createdAt: row.created_at,

    // No reviews or completed purchases exist yet.
    rating: 0,
    reviewCount: 0,
    unitsSold: 0,
  };
}

export function effectivePrice(product) {
  return product.salePrice ?? product.price;
}

export async function getCategories() {
  const { rows } = await pool.query(
    "SELECT id, name, slug FROM categories ORDER BY id",
  );

  return rows;
}

export async function getBrands() {
  const { rows } = await pool.query(
    `SELECT id, name, slug, logo_url
     FROM brands
     WHERE ($1::BOOLEAN OR NOT is_demo)
     ORDER BY name`,
    [includeDemo],
  );

  return rows;
}

export async function findProducts(filters) {
  const values = [includeDemo];

  const conditions = [
    "is_active",
    "($1::BOOLEAN OR NOT is_demo)",
    "effective_price IS NOT NULL",
  ];

  function addCondition(sql, value) {
    values.push(value);
    conditions.push(sql.replace("?", `$${values.length}`));
  }

  if (filters.q) {
    // Literal substring search: % and _ are treated as ordinary text.
    addCondition(
      "STRPOS(LOWER(name || ' ' || brand_name), LOWER(?)) > 0",
      filters.q,
    );
  }

  if (filters.category) {
    addCondition("category_slug = ?", filters.category);
  }

  if (filters.brand) {
    addCondition("brand_slug = ?", filters.brand);
  }

  if (filters.minPrice !== null) {
    addCondition("effective_price >= ?", filters.minPrice);
  }

  if (filters.maxPrice !== null) {
    addCondition("effective_price <= ?", filters.maxPrice);
  }

  if (filters.inStock) {
    conditions.push("stock > 0");
  }

  // No reviews exist yet, so no product qualifies for a star threshold.
  if (filters.rating > 0) {
    conditions.push("FALSE");
  }

  // Only fixed SQL strings are allowed for ordering.
  const sortOrders = {
    newest: "created_at DESC, id DESC",
    price_asc: "effective_price ASC, id ASC",
    price_desc: "effective_price DESC, id ASC",

    // Until reviews and sales exist, these use newest as the tie-breaker.
    rating: "created_at DESC, id DESC",
    popularity: "created_at DESC, id DESC",
  };

  const orderBy = sortOrders[filters.sort] ?? sortOrders.newest;
  const where = conditions.join(" AND ");

  const countResult = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM catalogue_products
     WHERE ${where}`,
    values,
  );

  const total = countResult.rows[0].total;
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, filters.page), totalPages);
  const offset = (page - 1) * pageSize;

  const result = await pool.query(
    `SELECT *
     FROM catalogue_products
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );

  return {
    products: result.rows.map(mapProduct),
    total,
    page,
    pageSize,
    totalPages,
  };
}

export async function findProductBySlug(slug) {
  const result = await pool.query(
    `SELECT *
    FROM catalogue_products
    WHERE slug = $1
    AND is_active
    AND effective_price IS NOT NULL
    AND ($2::BOOLEAN OR NOT is_demo)`,
    [slug, includeDemo],
  );

  if (result.rows.length === 0) return null;

  const product = mapProduct(result.rows[0]);

  const labelResult = await pool.query(
    `SELECT nutrition_image_url
   FROM products
   WHERE id = $1`,
    [product.id],
  );

  product.nutritionImageUrl = labelResult.rows[0]?.nutrition_image_url ?? null;

  const [imagesResult, variantsResult, nutritionResult] = await Promise.all([
    pool.query(
      `SELECT image_url
         FROM product_images
         WHERE product_id = $1
         ORDER BY position, id`,
      [product.id],
    ),
    pool.query(
      `SELECT
     v.id,
     v.sku,
     v.size,
     v.flavour,
     COALESCE(v.price, p.price) AS price,
     CASE
       WHEN v.price IS NOT NULL THEN v.sale_price
       ELSE p.sale_price
     END AS sale_price,
     COALESCE(i.quantity - i.reserved_quantity, 0) AS stock
   FROM product_variants v
   JOIN products p ON p.id = v.product_id
   LEFT JOIN inventory i ON i.variant_id = v.id
   WHERE v.product_id = $1 AND v.is_active
   ORDER BY v.id`,
      [product.id],
    ),
    pool.query(
      `SELECT nutrient, amount
         FROM product_nutrition
         WHERE product_id = $1
         ORDER BY position, id`,
      [product.id],
    ),
  ]);
  const variants = variantsResult.rows.map((row) => ({
    ...row,
    stock: Number(row.stock),
    price: Number(row.price),
    salePrice: row.sale_price === null ? null : Number(row.sale_price),
  }));
  return {
    ...product,
    images: imagesResult.rows.map((row) => row.image_url),
    variants,
    sizes: [...new Set(variants.map((variant) => variant.size))],
    flavours: [...new Set(variants.map((variant) => variant.flavour))],
    nutrition: nutritionResult.rows,
    reviews: [],
  };
}

export async function findRelatedProducts(product, limit = 4) {
  const result = await pool.query(
    `SELECT *
     FROM catalogue_products
     WHERE is_active
       AND category_slug = $1
       AND id <> $2
       AND ($3::BOOLEAN OR NOT is_demo)
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [product.categorySlug, product.id, includeDemo, limit],
  );

  return result.rows.map(mapProduct);
}

export async function getFeaturedProducts() {
  const result = await pool.query(
    `SELECT *
     FROM catalogue_products
     WHERE is_active
       AND effective_price IS NOT NULL
       AND is_featured
       AND ($1::BOOLEAN OR NOT is_demo)
     ORDER BY created_at DESC, id DESC
     LIMIT 4`,
    [includeDemo],
  );

  return result.rows.map(mapProduct);
}

export async function getDealProducts() {
  const result = await pool.query(
    `SELECT *
 FROM catalogue_products
 WHERE is_active
   AND effective_price IS NOT NULL
   AND display_sale_price IS NOT NULL
   AND display_sale_price < display_price
   AND ($1::BOOLEAN OR NOT is_demo)
 ORDER BY
   (display_price - display_sale_price)
   / NULLIF(display_price, 0) DESC,
   id DESC
 LIMIT 4`,
    [includeDemo],
  );

  return result.rows.map(mapProduct);
}
