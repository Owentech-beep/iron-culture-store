BEGIN;

CREATE TABLE orders (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  user_id INTEGER NOT NULL REFERENCES users(id),

  order_number VARCHAR(50) NOT NULL UNIQUE,
  checkout_key UUID NOT NULL UNIQUE,

  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending', 'paid', 'processing',
        'shipped', 'delivered', 'cancelled'
      )
    ),

  payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
    CHECK (
      payment_status IN (
        'unpaid', 'paid', 'failed', 'refunded'
      )
    ),

  shipping_rate_status VARCHAR(20) NOT NULL
    CHECK (
      shipping_rate_status IN ('free', 'quote_required', 'quoted')
    ),

  shipping_address JSONB NOT NULL,

  subtotal_cents BIGINT NOT NULL CHECK (subtotal_cents >= 0),
  discount_cents BIGINT NOT NULL DEFAULT 0
    CHECK (discount_cents >= 0 AND discount_cents <= subtotal_cents),

  delivery_cents BIGINT CHECK (delivery_cents >= 0),
  total_cents BIGINT CHECK (total_cents >= 0),

  is_demo BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    (
      shipping_rate_status = 'quote_required'
      AND delivery_cents IS NULL
      AND total_cents IS NULL
    )
    OR
    (
      shipping_rate_status IN ('free', 'quoted')
      AND delivery_cents IS NOT NULL
      AND total_cents IS NOT NULL
      AND total_cents =
        subtotal_cents - discount_cents + delivery_cents
      AND (
        shipping_rate_status <> 'free'
        OR delivery_cents = 0
      )
    )
  )
);

CREATE TABLE order_items (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  order_id INTEGER NOT NULL
    REFERENCES orders(id) ON DELETE CASCADE,

  variant_id INTEGER NOT NULL REFERENCES product_variants(id),

  product_name VARCHAR(180) NOT NULL,
  variant_name VARCHAR(100) NOT NULL,

  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),

  line_total_cents BIGINT NOT NULL,

  CHECK (line_total_cents = quantity * unit_price_cents)
);

CREATE INDEX orders_user_created_idx
  ON orders(user_id, created_at DESC);

CREATE INDEX order_items_order_idx ON order_items(order_id);

COMMIT;