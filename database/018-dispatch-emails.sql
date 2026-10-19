BEGIN;

ALTER TABLE email_outbox
  DROP CONSTRAINT email_outbox_event_type_check,
  DROP CONSTRAINT email_outbox_event_version_check;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_event_type_check
    CHECK (
      event_type IN (
        'order_received',
        'payment_confirmed',
        'delivery_quote_ready',
        'order_shipped'
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
        event_type IN (
          'order_received',
          'payment_confirmed',
          'order_shipped'
        )
        AND event_version = 0
      )
    );

COMMIT;