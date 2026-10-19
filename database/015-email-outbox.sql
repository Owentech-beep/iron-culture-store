BEGIN;

CREATE TABLE email_outbox (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  order_id INTEGER NOT NULL REFERENCES orders(id),

  event_type VARCHAR(40) NOT NULL
    CHECK (
      event_type IN (
        'order_received',
        'payment_confirmed'
      )
    ),

  -- One email per order/event, including across notification retries.
  UNIQUE (order_id, event_type),

  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  text_body TEXT NOT NULL,

  is_demo BOOLEAN NOT NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'sending',
        'sent',
        'failed',
        'review_required'
      )
    ),

  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),

  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  claim_token UUID,
  claimed_at TIMESTAMPTZ,
  first_attempt_at TIMESTAMPTZ,

  provider_email_id VARCHAR(255),
  last_error VARCHAR(500),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,

  CHECK (CHAR_LENGTH(TRIM(recipient)) > 0),
  CHECK (CHAR_LENGTH(TRIM(subject)) > 0),
  CHECK (CHAR_LENGTH(TRIM(text_body)) > 0),

  CHECK (
    (
      status = 'sending'
      AND claim_token IS NOT NULL
      AND claimed_at IS NOT NULL
    )
    OR
    (
      status <> 'sending'
      AND claim_token IS NULL
      AND claimed_at IS NULL
    )
  ),

  CHECK (
    (status = 'sent' AND sent_at IS NOT NULL)
    OR
    (status <> 'sent' AND sent_at IS NULL)
  )
);

CREATE INDEX email_outbox_pending_idx
  ON email_outbox(available_at, id)
  WHERE status = 'pending';

COMMIT;