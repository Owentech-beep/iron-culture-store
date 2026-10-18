BEGIN;

ALTER TABLE inventory
  ADD COLUMN reserved_quantity INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT inventory_reserved_quantity_valid
    CHECK (
      reserved_quantity >= 0
      AND reserved_quantity <= quantity
    );

CREATE TABLE stock_reservations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  payment_id INTEGER NOT NULL REFERENCES payments(id),
  variant_id INTEGER NOT NULL REFERENCES inventory(variant_id),

  quantity INTEGER NOT NULL CHECK (quantity > 0),

  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'released')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,

  UNIQUE (payment_id, variant_id),

  CHECK (expires_at > created_at),

  CHECK (
    (status = 'active' AND resolved_at IS NULL)
    OR
    (status IN ('consumed', 'released') AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX stock_reservations_active_variant_idx
  ON stock_reservations(variant_id)
  WHERE status = 'active';

CREATE INDEX stock_reservations_active_expiry_idx
  ON stock_reservations(expires_at)
  WHERE status = 'active';

COMMIT;