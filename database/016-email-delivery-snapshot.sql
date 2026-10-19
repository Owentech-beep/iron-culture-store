BEGIN;

ALTER TABLE email_outbox
  ADD COLUMN delivery_key UUID,
  ADD COLUMN delivery_payload JSONB;

CREATE UNIQUE INDEX email_outbox_delivery_key_idx
  ON email_outbox(delivery_key)
  WHERE delivery_key IS NOT NULL;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_delivery_snapshot_valid
    CHECK (
      (
        delivery_key IS NULL
        AND delivery_payload IS NULL
      )
      OR
      (
        delivery_key IS NOT NULL
        AND delivery_payload IS NOT NULL
        AND jsonb_typeof(delivery_payload) = 'object'
      )
    );

COMMIT;