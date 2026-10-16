BEGIN;

CREATE TABLE categories (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE brands (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE products (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  brand_id INTEGER NOT NULL REFERENCES brands(id),

  name VARCHAR(180) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  short_description TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '',
  allergens TEXT NOT NULL DEFAULT '',
  serving_size VARCHAR(120) NOT NULL DEFAULT '',
  nutrition_basis VARCHAR(120) NOT NULL DEFAULT '',

  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  sale_price NUMERIC(10, 2),

  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    sale_price IS NULL OR
    (sale_price >= 0 AND sale_price < price)
  )
);

CREATE TABLE product_variants (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL UNIQUE,
  flavour VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (product_id, flavour)
);

CREATE TABLE inventory (
  variant_id INTEGER PRIMARY KEY
    REFERENCES product_variants(id) ON DELETE CASCADE,

  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5
    CHECK (low_stock_threshold >= 0)
);

CREATE TABLE product_images (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  UNIQUE (product_id, position)
);

CREATE TABLE product_nutrition (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  nutrient VARCHAR(120) NOT NULL,
  amount VARCHAR(120) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, position)
);

CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX products_brand_idx ON products(brand_id);
CREATE INDEX variants_product_idx ON product_variants(product_id);

-- One catalogue row per product.
-- Stock includes only active variants.
CREATE VIEW catalogue_products AS
SELECT
  p.*,
  c.name AS category_name,
  c.slug AS category_slug,
  b.name AS brand_name,
  b.slug AS brand_slug,

  COALESCE(p.sale_price, p.price) AS effective_price,

  COALESCE((
    SELECT SUM(i.quantity)
    FROM product_variants v
    JOIN inventory i ON i.variant_id = v.id
    WHERE v.product_id = p.id AND v.is_active
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