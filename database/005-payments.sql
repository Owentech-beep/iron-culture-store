BEGIN;

CREATE TABLE payments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  order_id INTEGER NOT NULL REFERENCES orders(id),

  provider VARCHAR(50) NOT NULL,
  provider_payment_id VARCHAR(255),

  idempotency_key UUID NOT NULL UNIQUE,

  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'ZAR'
    CHECK (currency = 'ZAR'),

  status VARCHAR(30) NOT NULL DEFAULT 'created'
    CHECK (
      status IN (
        'created',
        'pending',
        'succeeded',
        'failed',
        'cancelled',
        'expired',
        'refunded'
      )
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider, provider_payment_id)
);

CREATE INDEX payments_order_idx ON payments(order_id);

CREATE UNIQUE INDEX payments_one_active_per_order_idx
ON payments(order_id)
WHERE status IN ('created', 'pending', 'succeeded');

COMMIT;