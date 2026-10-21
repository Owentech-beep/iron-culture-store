BEGIN;

-- Existing variants keep their IDs and inventory.
-- An empty size means the admin has not assigned one yet.
ALTER TABLE product_variants
  ADD COLUMN size VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN price NUMERIC(12, 2),
  ADD COLUMN sale_price NUMERIC(12, 2);

ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_size_check
    CHECK (size = BTRIM(size)),
  ADD CONSTRAINT product_variants_price_check
    CHECK (price IS NULL OR price > 0),
  ADD CONSTRAINT product_variants_sale_price_check
    CHECK (
      sale_price IS NULL
      OR (
        price IS NOT NULL
        AND sale_price > 0
        AND sale_price < price
      )
    );

-- Replace flavour-only uniqueness with size + flavour.
ALTER TABLE product_variants
  DROP CONSTRAINT product_variants_product_id_flavour_key;

ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_product_size_flavour_key
    UNIQUE (product_id, size, flavour);

-- Allow order snapshots to contain both size and flavour.
-- Existing order descriptions remain unchanged.
ALTER TABLE order_items
  ALTER COLUMN variant_name TYPE TEXT;

COMMIT;