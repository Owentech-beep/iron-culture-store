BEGIN;

ALTER TABLE products
  ADD COLUMN nutrition_image_url TEXT,
  ADD COLUMN nutrition_image_public_id TEXT,
  ADD CONSTRAINT products_nutrition_image_pair_check
    CHECK (
      (nutrition_image_url IS NULL)
      = (nutrition_image_public_id IS NULL)
    );

COMMIT;