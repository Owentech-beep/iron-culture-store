BEGIN;

CREATE OR REPLACE VIEW catalogue_products AS
SELECT
  p.id,
  p.category_id,
  p.brand_id,
  p.name,
  p.slug,
  p.short_description,
  p.description,
  p.ingredients,
  p.allergens,
  p.serving_size,
  p.nutrition_basis,
  p.price,
  p.sale_price,
  p.is_active,
  p.is_featured,
  p.is_demo,
  p.created_at,
  c.name AS category_name,
  c.slug AS category_slug,
  b.name AS brand_name,
  b.slug AS brand_slug,

  COALESCE(pricing.sale_price, pricing.price)::NUMERIC(10,2)
    AS effective_price,

  COALESCE((
    SELECT SUM(i.quantity - i.reserved_quantity)
    FROM product_variants v
    JOIN inventory i ON i.variant_id = v.id
    WHERE v.product_id = p.id
      AND v.is_active
  ), 0::BIGINT)::INTEGER AS stock,

  (
    SELECT pi.image_url
    FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.position, pi.id
    LIMIT 1
  ) AS image_url,

  pricing.price AS display_price,
  pricing.sale_price AS display_sale_price,

  (
    SELECT COUNT(*)::INTEGER
    FROM product_variants v
    WHERE v.product_id = p.id
      AND v.is_active
  ) AS variant_count,

  EXISTS (
    SELECT 1
    FROM product_variants v
    WHERE v.product_id = p.id
      AND v.is_active
      AND v.price > 0
      AND v.sale_price IS NOT NULL
      AND v.sale_price < v.price
  ) AS has_discounted_variant

FROM products p
JOIN categories c ON c.id = p.category_id
JOIN brands b ON b.id = p.brand_id
LEFT JOIN LATERAL (
  SELECT v.price, v.sale_price
  FROM product_variants v
  WHERE v.product_id = p.id
    AND v.is_active
  ORDER BY COALESCE(v.sale_price, v.price), v.id
  LIMIT 1
) pricing ON TRUE;

COMMIT;