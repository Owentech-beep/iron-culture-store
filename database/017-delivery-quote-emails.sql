BEGIN;

ALTER TABLE email_outbox
  ADD COLUMN event_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE email_outbox
  DROP CONSTRAINT email_outbox_event_type_check,
  DROP CONSTRAINT email_outbox_order_id_event_type_key;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_event_type_check
    CHECK (
      event_type IN (
        'order_received',
        'payment_confirmed',
        'delivery_quote_ready'
      )
    ),

  ADD CONSTRAINT email_outbox_event_version_check
    CHECK (
      (
        event_type = 'delivery_quote_ready'
        AND event_version > 0
      )
      OR
      (
        event_type IN ('order_received', 'payment_confirmed')
        AND event_version = 0
      )
    ),

  ADD CONSTRAINT email_outbox_order_event_version_key
    UNIQUE (order_id, event_type, event_version);

COMMIT;