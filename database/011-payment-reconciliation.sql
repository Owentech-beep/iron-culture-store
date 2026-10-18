BEGIN;

CREATE TABLE payment_reconciliation_alerts (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  payment_id INTEGER NOT NULL REFERENCES payments(id),

  provider_payment_id VARCHAR(255) NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),

  reason VARCHAR(500) NOT NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  occurrence_count INTEGER NOT NULL DEFAULT 1
    CHECK (occurrence_count > 0),

  UNIQUE (payment_id, provider_payment_id)
);

COMMIT;