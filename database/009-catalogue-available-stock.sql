BEGIN;

CREATE OR REPLACE VIEW catalogue_products AS
SELECT
  p.*,
  c.name AS category_name,
  c.slug AS category_slug,
  b.name AS brand_name,
  b.slug AS brand_slug,

  COALESCE(p.sale_price, p.price) AS effective_price,

  COALESCE((
    SELECT SUM(i.quantity - i.reserved_quantity)
    FROM product_variants v
    JOIN inventory i ON i.variant_id = v.id
    WHERE v.product_id = p.id
      AND v.is_active
  ), 0)::INTEGER AS stock,

  (
    SELECT pi.image_url
    FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.position, pi.id
    LIMIT 1
  ) AS image_url

FROM products p
JOIN categories c ON c.id = p.category_id
JOIN brands b ON b.id = p.brand_id;

COMMIT;