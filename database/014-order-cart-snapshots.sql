BEGIN;

ALTER TABLE cart_items
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision >= 0);

ALTER TABLE order_items
  ADD COLUMN source_cart_item_id INTEGER,
  ADD COLUMN source_cart_item_revision INTEGER;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_cart_snapshot_valid
    CHECK (
      (
        source_cart_item_id IS NULL
        AND source_cart_item_revision IS NULL
      )
      OR
      (
        source_cart_item_id IS NOT NULL
        AND source_cart_item_id > 0
        AND source_cart_item_revision IS NOT NULL
        AND source_cart_item_revision >= 0
      )
    );

COMMIT;