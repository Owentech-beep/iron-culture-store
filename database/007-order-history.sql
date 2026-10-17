BEGIN;

ALTER TABLE orders
  ADD COLUMN stock_deducted_at TIMESTAMPTZ,
  ADD COLUMN tracking_courier VARCHAR(60),
  ADD COLUMN tracking_number VARCHAR(120),
  ADD COLUMN shipped_at TIMESTAMPTZ,
  ADD COLUMN delivered_at TIMESTAMPTZ,
  ADD COLUMN cancelled_at TIMESTAMPTZ;

CREATE TABLE order_status_history (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  order_id INTEGER NOT NULL
    REFERENCES orders(id) ON DELETE CASCADE,

  previous_status VARCHAR(20) NOT NULL,
  new_status VARCHAR(20) NOT NULL,

  changed_by INTEGER NOT NULL REFERENCES users(id),
  note VARCHAR(500) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX order_status_history_order_idx
  ON order_status_history(order_id, created_at);

COMMIT;