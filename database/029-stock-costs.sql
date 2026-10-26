BEGIN;

-- Each receipt records a separate batch of stock.
-- Existing stock will be recorded as an opening balance when
-- cost tracking is initialised for that option.
CREATE TABLE stock_cost_batches (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  variant_id INTEGER NOT NULL
    REFERENCES product_variants(id),

  entry_type VARCHAR(20) NOT NULL
    CHECK (
      entry_type IN ('purchase', 'opening_balance', 'adjustment')
    ),

  quantity_received INTEGER NOT NULL
    CHECK (quantity_received BETWEEN 1 AND 9999999),

  quantity_remaining INTEGER NOT NULL
    CHECK (
      quantity_remaining >= 0
      AND quantity_remaining <= quantity_received
    ),

  -- NULL means unknown. Zero means genuinely free stock.
  unit_cost_cents BIGINT
    CHECK (
      unit_cost_cents >= 0
      AND unit_cost_cents <= 999999999
    ),

  received_on DATE NOT NULL,

  supplier VARCHAR(180) NOT NULL DEFAULT '',
  invoice_reference VARCHAR(120) NOT NULL DEFAULT '',
  note VARCHAR(500) NOT NULL DEFAULT '',

  is_demo BOOLEAN NOT NULL,

  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent a repeated receipt submission from adding stock twice.
  submission_key UUID NOT NULL UNIQUE,

  CHECK (
    entry_type <> 'purchase'
    OR unit_cost_cents IS NOT NULL
  ),

  UNIQUE (id, variant_id)
);

CREATE INDEX stock_cost_batches_variant_idx
  ON stock_cost_batches (variant_id, id);

-- Only one initial opening balance per option.
CREATE UNIQUE INDEX stock_cost_batches_opening_idx
  ON stock_cost_batches (variant_id)
  WHERE entry_type = 'opening_balance';


-- A record of stock corrections, distinct from purchases and sales.
CREATE TABLE stock_cost_adjustments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  variant_id INTEGER NOT NULL
    REFERENCES product_variants(id),

  previous_quantity INTEGER NOT NULL
    CHECK (previous_quantity BETWEEN 0 AND 9999999),

  new_quantity INTEGER NOT NULL
    CHECK (new_quantity BETWEEN 0 AND 9999999),

  reason VARCHAR(500) NOT NULL
    CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),

  is_demo BOOLEAN NOT NULL,

  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  submission_key UUID NOT NULL UNIQUE,

  CHECK (previous_quantity <> new_quantity),

  UNIQUE (id, variant_id)
);


-- Records which batch supplied units sold or removed by correction.
-- Costs are copied here so later changes cannot rewrite consumption.
CREATE TABLE stock_cost_allocations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  variant_id INTEGER NOT NULL
    REFERENCES product_variants(id),

  batch_id INTEGER NOT NULL,

  order_item_id INTEGER REFERENCES order_items(id),
  adjustment_id INTEGER,

  quantity INTEGER NOT NULL
    CHECK (quantity BETWEEN 1 AND 9999999),

  unit_cost_cents BIGINT
    CHECK (
      unit_cost_cents >= 0
      AND unit_cost_cents <= 999999999
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  FOREIGN KEY (batch_id, variant_id)
    REFERENCES stock_cost_batches(id, variant_id),

  FOREIGN KEY (adjustment_id, variant_id)
    REFERENCES stock_cost_adjustments(id, variant_id),

  -- Each allocation belongs to a sale OR a stock correction.
  CHECK (
    (order_item_id IS NOT NULL AND adjustment_id IS NULL)
    OR
    (order_item_id IS NULL AND adjustment_id IS NOT NULL)
  ),

  UNIQUE (order_item_id, batch_id),
  UNIQUE (adjustment_id, batch_id)
);

CREATE INDEX stock_cost_allocations_variant_idx
  ON stock_cost_allocations (variant_id);


-- NULL on existing orders deliberately means cost not recorded.
ALTER TABLE order_items
  ADD COLUMN cost_total_cents BIGINT
    CHECK (cost_total_cents >= 0),

  ADD COLUMN cost_recorded_at TIMESTAMPTZ,

  ADD CONSTRAINT order_items_cost_recorded_check
    CHECK (
      cost_total_cents IS NULL
      OR cost_recorded_at IS NOT NULL
    );


-- Marks options whose current physical stock has been reconciled
-- with the new batch records.
ALTER TABLE inventory
  ADD COLUMN cost_tracking_started_at TIMESTAMPTZ;

COMMIT;