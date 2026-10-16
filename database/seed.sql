BEGIN;

INSERT INTO categories (name, slug)
VALUES
  ('Protein', 'protein'),
  ('Pre-Workout', 'pre-workout'),
  ('Creatine', 'creatine'),
  ('Recovery', 'recovery'),
  ('Vitamins', 'vitamins'),
  ('Fat Loss', 'fat-loss'),
  ('Accessories', 'accessories')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO brands (name, slug, is_demo)
VALUES
  ('Demo Training Brand', 'demo-training-brand', TRUE),
  ('Demo Nutrition Brand', 'demo-nutrition-brand', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Fictional test records, not actual products or business prices.
-- Fourteen records allow testing pagination with a page size of twelve.
INSERT INTO products (
  category_id,
  brand_id,
  name,
  slug,
  short_description,
  description,
  price,
  sale_price,
  is_active,
  is_featured,
  is_demo,
  created_at
)
SELECT
  c.id,
  b.id,
  'DEMO ' || c.name || ' Sample ' || n,
  'demo-' || c.slug || '-' || n,
  'Development sample. Not a real product or offer.',
  'This fictional record is used to test the store. Its price and stock are test values. No nutritional or performance claims are being made.',
  (100 + n * 25)::NUMERIC(10, 2),
  CASE
    WHEN n % 3 = 0 THEN (90 + n * 25)::NUMERIC(10, 2)
    ELSE NULL
  END,
  TRUE,
  n <= 4,
  TRUE,
  NOW() - n * INTERVAL '1 day'

FROM generate_series(1, 14) AS series(n)
JOIN categories c ON c.slug = (
  ARRAY[
    'protein', 'pre-workout', 'creatine', 'recovery',
    'vitamins', 'fat-loss', 'accessories'
  ]
)[((n - 1) % 7) + 1]
JOIN brands b ON b.slug =
  CASE
    WHEN n % 2 = 0 THEN 'demo-nutrition-brand'
    ELSE 'demo-training-brand'
  END

ON CONFLICT (slug) DO NOTHING;

INSERT INTO product_variants (product_id, sku, flavour)
SELECT
  p.id,
  UPPER(p.slug) || '-A',
  'Demo option A'
FROM products p
WHERE p.is_demo AND p.slug LIKE 'demo-%'
ON CONFLICT (sku) DO NOTHING;

INSERT INTO product_variants (product_id, sku, flavour)
SELECT
  p.id,
  UPPER(p.slug) || '-B',
  'Demo option B'
FROM products p
WHERE p.is_demo AND p.slug LIKE 'demo-%'
ON CONFLICT (sku) DO NOTHING;

INSERT INTO inventory (variant_id, quantity)
SELECT
  v.id,
  CASE
    WHEN p.category_id = (
      SELECT id FROM categories WHERE slug = 'accessories'
    ) THEN 0
    WHEN v.flavour = 'Demo option A' THEN 8
    ELSE 3
  END
FROM product_variants v
JOIN products p ON p.id = v.product_id
WHERE p.is_demo
ON CONFLICT (variant_id) DO NOTHING;

COMMIT;