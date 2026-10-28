BEGIN;

ALTER TABLE orders
  DROP CONSTRAINT orders_shipping_rate_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_shipping_rate_status_check
  CHECK (
    shipping_rate_status IN (
      'free',
      'flat_rate',
      'quote_required',
      'quoted'
    )
  );

ALTER TABLE orders
  DROP CONSTRAINT orders_check1;

ALTER TABLE orders
  ADD CONSTRAINT orders_check1
  CHECK (
    (
      shipping_rate_status = 'quote_required'
      AND delivery_cents IS NULL
      AND total_cents IS NULL
    )
    OR
    (
      shipping_rate_status IN ('free', 'flat_rate', 'quoted')
      AND delivery_cents IS NOT NULL
      AND total_cents IS NOT NULL
      AND total_cents =
        subtotal_cents - discount_cents + delivery_cents
      AND (
        shipping_rate_status <> 'free'
        OR delivery_cents = 0
      )
      AND (
        shipping_rate_status <> 'flat_rate'
        OR delivery_cents = 9900
      )
    )
  );

COMMIT;